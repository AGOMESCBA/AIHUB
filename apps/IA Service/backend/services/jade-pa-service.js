// Jade no Primeiro Atendimento (pedido do usuário, 2026-11-19).
//
// A cada intervalo configurado, lê no SoftExpert os chamados parados no
// Primeiro Atendimento (ATV-02) que ainda não tiveram triagem — sem
// responsável (DYNITSM.RESPONSAVEL) e sem nenhum posicionamento na grade — e,
// para cada um, uma única vez:
//   1. importa o chamado e copia os anexos (mesmo caminho do Radar);
//   2. faz a análise técnica no chat da J2iA (fica para o consultor);
//   3. escreve o texto ao cliente a partir dela e decide entre responder ou
//      devolver ao cliente (só quando não há o que pesquisar).
// Fase 1: nada é enviado ao SoftExpert — o resultado fica em "simulado".
const repo = require('../repositories/jade-pa-repository');
const agenteRepo = require('../repositories/agente-local-repository');
const agenteLocalService = require('./agente-local-service');
const historicalImportService = require('./import/historical-import-service');
const chamadoRepo = require('../repositories/chamado-repository');
const radarService = require('./radar-service');
const anexosSoftExpertService = require('./anexos-softexpert-service');
const anexoRepo = require('../repositories/anexo-repository');
const mensagemRepo = require('../repositories/mensagem-repository');
const turnoLockService = require('./turno-lock-service');
const aiConfigService = require('./ai-config-service');
const aiProviderClient = require('./ai-provider-client');
const retornoConfig = require('./retorno-softexpert-config');
const soapClient = require('./softexpert-soap-client');
const clienteRepo = require('../repositories/cliente-repository');

const TICK_MS = 60 * 1000;
const PRIMEIRA_EXECUCAO_MS = 90 * 1000;
// O ciclo trata todos os elegíveis (pedido do usuário, 2026-11-19) e renova a
// trava a cada chamado; trava vencida (sem renovação há 20 min) é de um processo
// que caiu e é retomada.
const TRAVA_MS = 20 * 60 * 1000;
// Teto de segurança da consulta de elegíveis no SoftExpert, não um limite de vazão.
const MAX_ELEGIVEIS = 500;
const MAX_TENTATIVAS = 3;
const MAX_TEXTO_CLIENTE = 6000;
// Texto gerado há mais tempo que o SLA do Primeiro Atendimento não é mais
// enviado (ex.: ficou "pronto" com o modo em Simulação e só depois foi ligado).
const MAX_IDADE_ENVIO_MS = 4 * 60 * 60 * 1000;
// Nomes de cliente que também são palavras comuns no texto ("clique na seta"):
// não entram na verificação de vazamento, para não recusar texto bom.
const NOMES_GENERICOS = new Set(['seta', 'bom jesus', 'porto seco', 'caieira', 'abaco']);

// Mesma regra de status da view ITSM_CHAMADOS: RESPONSAVEL IS NULL = "Pendente".
const SQL_ELEGIVEIS = `
  SELECT TOP ${MAX_ELEGIVEIS} W.IDPROCESS AS NUM, MIN(S.DHENABLED) AS ENTROU_PA
  FROM WFPROCESS W
  INNER JOIN WFSTRUCT S ON S.IDPROCESS = W.IDOBJECT AND S.IDSTRUCT = 'ATV-02' AND S.FGSTATUS = 2
  WHERE W.FGSTATUS = 1
    AND EXISTS (SELECT 1 FROM DYNITSM D WHERE D.IDPROCESS = W.IDPROCESS AND D.RESPONSAVEL IS NULL)
    AND NOT EXISTS (SELECT 1 FROM DYNITSM D2 WHERE D2.IDPROCESS = W.IDPROCESS AND D2.RESPONSAVEL IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM DYNITSMGRIDREGISTR G WHERE G.CHAMADO = W.IDPROCESS
      OR G.OIDABCA7HP6S55J0LV IN (SELECT D3.OID FROM DYNITSM D3 WHERE D3.IDPROCESS = W.IDPROCESS))
    {{FILTRO}}
  GROUP BY W.IDPROCESS
  ORDER BY MIN(S.DHENABLED)
`;

// Situação atual do chamado na origem: atividades ativas, responsável e
// posicionamentos (os da Jade são marcados com TEXTO4 = 'IA SERVICE').
// Posicionamento pelo vínculo com o chamado (FK) ou pela coluna CHAMADO —
// não está comprovado que a inclusão pela API preenche CHAMADO.
const DO_CHAMADO = `(G.CHAMADO = W.IDPROCESS OR G.OIDABCA7HP6S55J0LV IN (SELECT D3.OID FROM DYNITSM D3 WHERE D3.IDPROCESS = W.IDPROCESS))`;
const SQL_SITUACAO = `
  SELECT W.FGSTATUS AS PROC_STATUS,
    (SELECT COUNT(*) FROM DYNITSM D WHERE D.IDPROCESS = W.IDPROCESS AND D.RESPONSAVEL IS NOT NULL) AS COM_RESP,
    (SELECT COUNT(*) FROM DYNITSMGRIDREGISTR G WHERE ${DO_CHAMADO} AND G.TEXTO4 = 'IA SERVICE') AS POS_JADE,
    (SELECT COUNT(*) FROM DYNITSMGRIDREGISTR G WHERE ${DO_CHAMADO} AND (G.TEXTO4 IS NULL OR G.TEXTO4 <> 'IA SERVICE')) AS POS_OUTROS,
    S.IDSTRUCT AS ATIVA
  FROM WFPROCESS W
  LEFT JOIN WFSTRUCT S ON S.IDPROCESS = W.IDOBJECT AND S.FGSTATUS = 2
  WHERE W.IDPROCESS = @numero
`;

const SQL_USUARIO_JADE = 'SELECT CDUSER, NMUSER, IDUSER, FGUSERENABLED FROM ADUSER WHERE CDUSER = @cdUser';

const MARCA_JADE = 'IA SERVICE';
const ATIVIDADE_CLIENTE = 'ATV-06';

const TEXTO_ANALISE_PA = 'Este chamado acabou de ser aberto pelo cliente e está no Primeiro Atendimento (triagem), sem nenhum posicionamento ainda. Faça uma pré-análise inicial com base no texto do chamado e nos anexos sincronizados, quando existirem: identifique o problema relatado, hipóteses prováveis de causa, possíveis soluções que o próprio cliente consiga testar e quais informações ou evidências ainda faltam para avançar. Deixe claro no nível de confiança que esta é uma análise preliminar, sem confirmação humana.';

const SYSTEM_PROMPT_CLIENTE = `Você é a Jade, atendente de IA do suporte. Você escreve o PRIMEIRO retorno ao CLIENTE que abriu o chamado. O texto vai para o portal do cliente: escreva para ele, não para o analista.

Responda SOMENTE com um JSON válido, sem nada antes ou depois:
{"decisao": "responder" | "devolver", "motivo": "frase curta, uso interno, explicando a decisão", "texto": "texto ao cliente"}

Como decidir:
- "responder": há informação suficiente para orientar. Traga as possíveis causas e soluções que o cliente pode testar, de forma objetiva, em passos simples. Se faltar algo que ajudaria, peça no mesmo texto.
- "devolver": SOMENTE quando realmente não há o que pesquisar — sem anexo ou evidência E descrição vaga, sem rotina/tela identificada e sem mensagem de erro. Na dúvida, escolha "responder".
- Ao pedir informação, seja específico para ESTE chamado (ex.: qual rotina ou tela, passo a passo até o erro, texto exato da mensagem, print da tela, arquivo error.log, data e hora da ocorrência, ambiente). Nunca use uma lista genérica.

Como escrever o texto — o campo do SoftExpert é TEXTO PURO: nada de markdown (#, **, crases, tabelas). Organize como nas respostas do chat, com seções separadas por uma linha em branco, título da seção em MAIÚSCULAS numa linha própria e itens numerados ("1.", "2.") em linhas próprias. Modelo:

Olá! Em breve seu chamado será direcionado a um atendente. Enquanto isso, segue abaixo uma análise preliminar feita pela atendente de IA Jade.

ANÁLISE PRELIMINAR
Uma a três frases sobre o que o relato e os anexos indicam.

POSSÍVEIS CAUSAS
1. ...
2. ...

O QUE VOCÊ PODE TESTAR
1. ...
2. ...

O QUE NOS AJUDA A AVANÇAR
1. ...

Ficamos no aguardo do seu retorno.

Jade, atendente de IA

Regras do texto:
- Use só as seções que fizerem sentido; ao devolver, use "PARA ANALISARMOS SEU CHAMADO" com os itens que faltam, no lugar de causas e testes.
- No máximo 5 itens por seção, cada item com uma ou duas frases.
- Português do Brasil, tom amigável e profissional.
- Não invente: use só o que está no chamado, nos anexos e na análise técnica. Não prometa prazo.
- NUNCA cite números de outros chamados, nomes de outros clientes, empresas, pessoas ou dados internos; não mencione "base histórica", fontes internas, nível de confiança nem a análise técnica em si.
- No máximo 3000 caracteres.`;

function _investigacao() {
  // Carregado sob demanda: investigacao-service é pesado e tem dependências cruzadas.
  return require('./investigacao-service');
}

function _erro(status, message) { return Object.assign(new Error(message), { status }); }

async function listarElegiveisNaOrigem(empresaId, fonteId, { numero } = {}) {
  const sql = SQL_ELEGIVEIS.replace('{{FILTRO}}', numero ? 'AND W.IDPROCESS = @numero' : '');
  const rows = await agenteLocalService.executarSelectNaFonte(empresaId, fonteId, {
    sql, params: numero ? { numero: String(numero) } : {}, limit: MAX_ELEGIVEIS,
  });
  return rows.map(r => String(r.NUM));
}

async function _aindaElegivel(empresaId, fonteId, numero) {
  return (await listarElegiveisNaOrigem(empresaId, fonteId, { numero })).includes(String(numero));
}

async function _importarChamado(empresaId, fonteId, numero) {
  const saida = await historicalImportService.atualizarChamadosPorIds(empresaId, fonteId, [String(numero)]);
  if (saida.erros.length) throw new Error(`Falha ao importar o chamado: ${saida.erros[0].erro}`);
  const chamado = chamadoRepo.getChamadoPorNumero(empresaId, String(numero), 'softexpert');
  if (!chamado) throw new Error('Chamado não encontrado na base após a importação.');
  return chamado;
}

// Reaproveita a análise que já estiver no chat (ex.: consultor abriu antes);
// senão roda a análise completa, que fica gravada no chat da J2iA.
async function _obterAnaliseTecnica(empresaId, atendimentoId, anexos) {
  const mensagens = mensagemRepo.listarMensagens(empresaId, atendimentoId, { limite: 500 });
  const existente = [...mensagens].reverse().find(m => m.papel === 'assistant' && !m.diagnostico?.erroInfraestrutura);
  if (existente) return existente;
  if (!turnoLockService.tentarAdquirir(empresaId, atendimentoId)) {
    throw Object.assign(new Error('O chat deste chamado está em uso; a Jade tenta de novo no próximo ciclo.'), { adiar: true });
  }
  try {
    const mensagem = await _investigacao().processarTurno(empresaId, atendimentoId, {
      texto: TEXTO_ANALISE_PA, usuarioId: null, anexoIds: anexos.map(a => a.id).filter(Boolean), automatico: true,
    });
    if (!mensagem || mensagem.diagnostico?.erroInfraestrutura) throw new Error('A análise técnica da IA falhou (provedor indisponível).');
    return mensagem;
  } finally {
    turnoLockService.liberar(empresaId, atendimentoId);
  }
}

function _limitar(texto, max) {
  const t = String(texto || '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function _montarEntrada({ chamado, anexos, analise }) {
  const partes = [`Chamado nº ${chamado.numero}`];
  for (const [rotulo, valor] of [['Título', chamado.titulo], ['Assunto', chamado.assunto], ['Breve descrição', chamado.breveDescricao],
    ['Descrição do cliente', chamado.descricao], ['Informações adicionais', chamado.informacoesAdicionais]]) {
    if (valor && String(valor).trim()) partes.push(`${rotulo}: ${_limitar(valor, 4000)}`);
  }
  partes.push(anexos.length
    ? `Anexos enviados pelo cliente (${anexos.length}): ${anexos.map(a => a.nomeOriginal || a.nome || 'arquivo').join(', ')}`
    : 'Anexos enviados pelo cliente: nenhum.');
  partes.push(`Análise técnica interna (NÃO copie referências, números de chamados ou nomes daqui):\n${_limitar(analise?.conteudo, 8000) || '(indisponível)'}`);
  return partes.join('\n\n');
}

function _extrairJson(texto) {
  const bruto = String(texto || '');
  const inicio = bruto.indexOf('{');
  const fim = bruto.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) return null;
  try { return JSON.parse(bruto.slice(inicio, fim + 1)); } catch (_) { return null; }
}

// O SoftExpert grava em ISO-8859-1: aspas e travessões tipográficos, reticências
// e marcadores viram equivalentes simples; o que não existir em latin1 sai.
function normalizarTextoSoftExpert(texto) {
  return String(texto || '')
    // Restos de markdown: o campo é texto puro.
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/`+/g, '')
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, '')
    .replace(/^[ \t]*[*•][ \t]+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[•●▪◦]/g, '-')
    .replace(/[   ]/g, ' ')
    .replace(/[^\u0000-ÿ]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

function _semAcento(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Nomes de OUTROS clientes da empresa que não podem aparecer no texto (o do próprio chamado pode). */
function nomesDeOutrosClientes(empresaId, clienteIdProprio) {
  const nomes = new Set();
  for (const c of clienteRepo.listarClientes(empresaId, { limite: 1000 })) {
    if (clienteIdProprio && String(c.id) === String(clienteIdProprio)) continue;
    for (const bruto of [c.nome, c.nomeFantasia]) {
      if (!bruto) continue;
      const base = _semAcento(bruto);
      // "BIPAR (BIMETAL)" vale como "bipar" e "bimetal"; sufixos societários saem.
      const partes = [base.replace(/\(.*?\)/g, ' '), ...[...base.matchAll(/\(([^)]+)\)/g)].map(m => m[1])];
      for (const parte of partes) {
        const nome = parte.replace(/\b(ltda|s\/?a|me|eireli|epp)\b\.?/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        if (nome.length >= 3 && !NOMES_GENERICOS.has(nome) && !nome.includes('j2a')) nomes.add(nome);
      }
    }
  }
  return [...nomes];
}

/** Trechos que não podem ir ao cliente: número de outro chamado, nome de outro cliente e menções internas. */
function verificarVazamento(texto, numeroProprio, outrosClientes = []) {
  const problemas = [];
  const proprio = String(numeroProprio || '');
  for (const m of String(texto).matchAll(/(?<!\d)0\d{5}(?!\d)/g)) {
    if (m[0] !== proprio) problemas.push(`cita o chamado ${m[0]}`);
  }
  const normalizado = ` ${_semAcento(texto).replace(/[^a-z0-9]+/g, ' ')} `;
  for (const nome of outrosClientes) {
    if (normalizado.includes(` ${nome} `)) problemas.push(`cita outro cliente (${nome})`);
  }
  if (/base hist[oó]rica/i.test(texto)) problemas.push('menciona a base histórica');
  if (/n[ií]vel de confian[cç]a/i.test(texto)) problemas.push('menciona nível de confiança');
  return [...new Set(problemas)];
}

async function gerarTextoCliente(empresaId, dados) {
  const { keys, cfg } = aiConfigService.resolverKeysEOrdem(empresaId);
  let entrada = _montarEntrada(dados);
  const outrosClientes = nomesDeOutrosClientes(empresaId, dados.chamado.clienteId);
  let ultimoProblema = 'resposta da IA sem o formato esperado';
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const resultado = await aiProviderClient.chamarIA(keys, cfg, SYSTEM_PROMPT_CLIENTE, entrada, [], { maxTokens: 2000, timeoutMs: 90000 });
    const json = resultado.truncado ? null : _extrairJson(resultado.texto);
    const texto = normalizarTextoSoftExpert(json?.texto);
    if (!json || !['responder', 'devolver'].includes(json.decisao) || !texto) {
      ultimoProblema = 'resposta da IA sem o formato esperado';
      continue;
    }
    if (texto.length > MAX_TEXTO_CLIENTE) { ultimoProblema = 'texto ao cliente longo demais'; continue; }
    const problemas = verificarVazamento(texto, dados.chamado.numero, outrosClientes);
    if (problemas.length) {
      ultimoProblema = `texto ao cliente ${problemas.join(', ')}`;
      entrada = `${_montarEntrada(dados)}\n\nATENÇÃO: a versão anterior foi recusada porque ${problemas.join(', ')}. Reescreva sem isso.`;
      continue;
    }
    return { decisao: json.decisao, motivo: _limitar(json.motivo, 500), texto, provider: resultado.provider, model: resultado.model };
  }
  throw new Error(`Texto ao cliente recusado: ${ultimoProblema}.`);
}

async function processarExecucao(cfg, fonte, exec) {
  const { empresaId } = cfg;
  if (!repo.marcarGerando(exec.id, exec.estado, exec.atualizadoEm)) return null;
  const tentativa = exec.tentativasGeracao + 1;
  const descartar = () => repo.atualizar(exec.id, {
    estado: 'descartado', motivo: 'A triagem atuou no chamado antes da Jade (responsável definido ou posicionamento registrado).',
  });
  try {
    if (!(await _aindaElegivel(empresaId, fonte.id, exec.numeroChamado))) return descartar();
    const chamado = await _importarChamado(empresaId, fonte.id, exec.numeroChamado);
    const { atendimento } = radarService.iniciarAnalise(empresaId, chamado.id, { preAnaliseAutomatica: false });
    repo.atualizar(exec.id, { chamadoId: chamado.id, atendimentoId: atendimento.id });
    await anexosSoftExpertService.sincronizarAnexosParaAtendimento(empresaId, chamado.id, atendimento.id).catch((err) => {
      console.error(`[IA Service] Jade PA: cópia de anexos falhou (chamado ${chamado.numero}):`, err.message);
    });
    const anexos = anexoRepo.listarAnexos(empresaId, atendimento.id);
    const analise = await _obterAnaliseTecnica(empresaId, atendimento.id, anexos);
    const gerado = await gerarTextoCliente(empresaId, { chamado, anexos, analise });
    // Devolução desligada: o pedido de informação vai como resposta (o chamado fica no PA).
    const devolver = gerado.decisao === 'devolver' && cfg.devolucaoAtiva;
    const motivo = gerado.decisao === 'devolver' && !cfg.devolucaoAtiva ? `${gerado.motivo} (devolução desligada: fica como resposta)` : gerado.motivo;
    if (!(await _aindaElegivel(empresaId, fonte.id, exec.numeroChamado))) return descartar();
    return repo.atualizar(exec.id, {
      estado: cfg.modo === 'publicar' ? 'pronto' : 'simulado', decisao: devolver ? 'devolver' : 'responder', motivo,
      textoCliente: gerado.texto, mensagemAnaliseId: analise?.id ?? null, geradoEm: new Date().toISOString(), ultimoErro: null, alerta: false,
    });
  } catch (err) {
    if (err.adiar) {
      repo.devolverTentativaGeracao(exec.id);
      return repo.atualizar(exec.id, { estado: 'detectado', ultimoErro: err.message });
    }
    const esgotou = tentativa >= MAX_TENTATIVAS;
    console.error(`[IA Service] Jade PA: chamado ${exec.numeroChamado}, tentativa ${tentativa}:`, err.message);
    return repo.atualizar(exec.id, { estado: esgotou ? 'falha' : 'detectado', ultimoErro: err.message, alerta: esgotou });
  }
}

// ── Fases 2 e 3: envio ao SoftExpert ──────────────────────────────────────

async function situacaoNaOrigem(empresaId, fonteId, numero) {
  const rows = await agenteLocalService.executarSelectNaFonte(empresaId, fonteId, { sql: SQL_SITUACAO, params: { numero: String(numero) }, limit: 50 });
  if (!rows.length) return null;
  const r = rows[0];
  return {
    aberto: String(r.PROC_STATUS) === '1',
    comResponsavel: Number(r.COM_RESP) > 0,
    posicionamentosJade: Number(r.POS_JADE) || 0,
    posicionamentosOutros: Number(r.POS_OUTROS) || 0,
    ativas: new Set(rows.map(x => x.ATIVA).filter(Boolean).map(String)),
  };
}

function _triagemAtuou(s) {
  return !s || !s.aberto || !s.ativas.has('ATV-02') || s.comResponsavel || s.posicionamentosOutros > 0;
}

async function _usuarioJade(empresaId, fonteId, cdUser) {
  if (!cdUser) throw new Error('Informe o código do usuário da Jade no SoftExpert.');
  const [u] = await agenteLocalService.executarSelectNaFonte(empresaId, fonteId, { sql: SQL_USUARIO_JADE, params: { cdUser: String(cdUser) }, limit: 2 });
  if (!u) throw new Error(`Usuário ${cdUser} não encontrado no SoftExpert.`);
  if (String(u.FGUSERENABLED) !== '1') throw new Error(`Usuário ${cdUser} está desabilitado no SoftExpert.`);
  if (!String(u.NMUSER || '').trim() || !String(u.IDUSER || '').trim()) throw new Error(`Usuário ${cdUser} sem nome ou matrícula no SoftExpert.`);
  return { codigo: String(u.CDUSER), nome: String(u.NMUSER).trim(), matricula: String(u.IDUSER).trim() };
}

// Mesmo contrato de escrita dos analistas: a Jade precisa estar autorizada
// em autoria.analistas do arquivo SVC_SOFTEXPERT_RETORNO_CONFIG.
function _contratoEscrita(empresaId, fonteId, cdUser) {
  const config = retornoConfig.resolver({ empresaId, fonteId, consultor: { idSoftexpert: String(cdUser) } });
  if (!config.disponivel) throw new Error(`Escrita no SoftExpert indisponível para a Jade (usuário ${cdUser}): ${config.motivo}`);
  const { contrato } = config;
  if (contrato.mainEntityId.toLowerCase() !== 'itsm' || contrato.childRelationshipId.toLowerCase() !== 'relagridregistr') {
    throw new Error('O contrato de escrita não aponta para a grade de posicionamentos do ITSM.');
  }
  return config;
}

function _horaMeiaHora(data) {
  const minutos = data.getHours() * 60 + (data.getMinutes() >= 30 ? 30 : 0);
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

/** Atributos da grade: os campos fechados com o usuário (2026-11-19) e zero horas apontadas. */
function montarAtributosPosicionamento({ contrato, chamado, jade, texto, instante = new Date() }) {
  const hora = _horaMeiaHora(instante);
  const desejados = {
    DESCRICAO: texto,
    ASSUNTO: 'Análise preliminar - Jade',
    SITUACAOCHAMADO: 'Primeiro Atendimento',
    TIPOPOSICIONAME: 'N',
    AGUARDANRETORNO: 'RETORNO - ATENDENTE',
  };
  if (contrato.campos.HORAINI || contrato.campos.HORAFIM) Object.assign(desejados, { HORAINI: hora, HORAFIM: hora, HORAINT: '00:00' });
  const campos = {};
  for (const [alias, valor] of Object.entries(desejados)) {
    const campo = contrato.campos[alias];
    if ((campo && !campo.calculado) || ['HORAINI', 'HORAFIM', 'HORAINT'].includes(alias)) campos[alias] = valor;
  }
  const atributos = retornoConfig.mapearCampos(campos, contrato, {
    chamado: { numero: chamado.numero, oidOrigem: chamado.oidOrigem }, consultor: { idSoftexpert: jade.codigo }, instante: instante.toISOString(),
  });
  for (const id of Object.keys(atributos)) if (['cduserana', 'analistaj2a', 'texto4'].includes(id.toLowerCase())) delete atributos[id];
  atributos.cduserana = jade.codigo;
  atributos.analistaj2a = jade.nome;
  atributos.texto4 = MARCA_JADE;
  return atributos;
}

function _falhaDefinitiva(exec, motivo) {
  return repo.atualizar(exec.id, { estado: 'falha', ultimoErro: `${motivo} Chamado deixado para a triagem.`, alerta: true });
}

async function _publicar(cfg, fonte, exec) {
  const { empresaId } = cfg;
  const s = await situacaoNaOrigem(empresaId, fonte.id, exec.numeroChamado);
  if (s?.posicionamentosJade > 0) {
    // Envio anterior confirmado na origem (inclusive um "não confirmado" que tinha entrado).
    const publicado = repo.atualizar(exec.id, { estado: 'publicado', publicadoEm: exec.publicadoEm || new Date().toISOString(), ultimoErro: null, alerta: false });
    return exec.decisao === 'devolver' ? repo.atualizar(publicado.id, { estado: 'devolvendo' }) : publicado;
  }
  if (exec.tentativasPublicacao >= MAX_TENTATIVAS) return _falhaDefinitiva(exec, 'O SoftExpert não confirmou o posicionamento após 3 tentativas.');
  if (_triagemAtuou(s)) {
    return repo.atualizar(exec.id, { estado: 'descartado', motivo: 'A triagem atuou no chamado antes do envio da Jade.', alerta: false });
  }
  if (exec.estado === 'pronto' && Date.now() - Date.parse(exec.geradoEm || 0) > MAX_IDADE_ENVIO_MS) {
    return repo.atualizar(exec.id, { estado: 'descartado', motivo: 'Texto gerado há mais de 4 horas; não foi enviado para não chegar desatualizado ao cliente.', alerta: false });
  }
  const chamado = chamadoRepo.getChamadoPorNumero(empresaId, exec.numeroChamado, 'softexpert');
  if (!chamado) throw new Error('Chamado não encontrado na base local.');
  const jade = await _usuarioJade(empresaId, fonte.id, cfg.usuarioSoftexpert);
  const config = _contratoEscrita(empresaId, fonte.id, jade.codigo);
  const atributos = montarAtributosPosicionamento({ contrato: config.contrato, chamado, jade, texto: exec.textoCliente });
  const xml = soapClient.montarInclusaoGrid({ workflowId: exec.numeroChamado, mainEntityId: config.contrato.mainEntityId, childRelationshipId: config.contrato.childRelationshipId, campos: atributos });
  if (!repo.contarTentativa(exec.id, 'publicacao', 'publicando', { estadoAnterior: exec.estado, tentativasAnteriores: exec.tentativasPublicacao })) return null;
  let resposta;
  try {
    resposta = await soapClient.enviarOperacao({ ...config.transporte, xml, operacao: 'newChildEntityRecord' });
  } catch (_) {
    return repo.atualizar(exec.id, { ultimoErro: 'Envio do posicionamento não confirmado; será conferido no próximo ciclo antes de qualquer reenvio.' });
  }
  if (resposta.Status !== 'SUCCESS' || resposta.Code !== '1') {
    return repo.atualizar(exec.id, { ultimoErro: `O SoftExpert recusou o posicionamento: ${resposta.Detail || resposta.Code}` });
  }
  const publicado = repo.atualizar(exec.id, { estado: 'publicado', publicadoEm: new Date().toISOString(), ultimoErro: null, alerta: false });
  return exec.decisao === 'devolver' ? repo.atualizar(publicado.id, { estado: 'devolvendo' }) : publicado;
}

async function _devolver(cfg, fonte, exec) {
  const { empresaId } = cfg;
  const s = await situacaoNaOrigem(empresaId, fonte.id, exec.numeroChamado);
  if (s && !s.ativas.has('ATV-02')) {
    if (s.ativas.has(ATIVIDADE_CLIENTE)) return repo.atualizar(exec.id, { estado: 'devolvido', devolvidoEm: new Date().toISOString(), ultimoErro: null, alerta: false });
    // Saiu do PA para outro lugar: se a Jade tentou devolver, alguém precisa olhar.
    return repo.atualizar(exec.id, {
      estado: 'publicado', alerta: exec.tentativasDevolucao > 0,
      ultimoErro: `O chamado saiu do Primeiro Atendimento para ${[...s.ativas].join(', ') || 'outra etapa'}, não para o cliente.`,
    });
  }
  const cancelar = (motivo) => repo.atualizar(exec.id, { estado: 'publicado', motivo: `${exec.motivo || ''} (${motivo})`.trim(), alerta: false });
  if (!cfg.devolucaoAtiva) return cancelar('devolução desligada antes do envio; o pedido ficou como resposta');
  if (!s || !s.aberto || s.comResponsavel || s.posicionamentosOutros > 0) return cancelar('devolução cancelada: a triagem atuou no chamado');
  if (exec.tentativasDevolucao >= MAX_TENTATIVAS) return _falhaDefinitiva(exec, 'O SoftExpert não confirmou a devolução ao cliente após 3 tentativas; o pedido de informação já está na grade.');
  const jade = await _usuarioJade(empresaId, fonte.id, cfg.usuarioSoftexpert);
  const config = _contratoEscrita(empresaId, fonte.id, jade.codigo);
  const xml = soapClient.montarDevolucaoPrimeiroAtendimento({ workflowId: exec.numeroChamado, userId: jade.matricula });
  if (!repo.contarTentativa(exec.id, 'devolucao', 'devolvendo', { estadoAnterior: exec.estado, tentativasAnteriores: exec.tentativasDevolucao })) return null;
  let resposta;
  try {
    resposta = await soapClient.enviarOperacao({ ...config.transporte, xml, operacao: 'executeActivity' });
  } catch (_) {
    return repo.atualizar(exec.id, { ultimoErro: 'Devolução não confirmada; será conferida no próximo ciclo antes de qualquer nova tentativa.' });
  }
  if (resposta.Status !== 'SUCCESS' || resposta.Code !== '1') {
    return repo.atualizar(exec.id, { ultimoErro: `O SoftExpert recusou a devolução: ${resposta.Detail || resposta.Code}` });
  }
  const depois = await situacaoNaOrigem(empresaId, fonte.id, exec.numeroChamado);
  if (depois?.ativas.has(ATIVIDADE_CLIENTE)) return repo.atualizar(exec.id, { estado: 'devolvido', devolvidoEm: new Date().toISOString(), ultimoErro: null, alerta: false });
  return repo.atualizar(exec.id, {
    estado: 'publicado', alerta: true,
    ultimoErro: `A devolução foi aceita, mas o chamado está em ${[...(depois?.ativas || [])].join(', ') || 'etapa desconhecida'}, não em ${ATIVIDADE_CLIENTE}.`,
  });
}

async function enviarExecucao(cfg, fonte, exec) {
  try {
    const atual = exec.estado === 'devolvendo' ? exec : await _publicar(cfg, fonte, exec);
    return atual?.estado === 'devolvendo' ? await _devolver(cfg, fonte, repo.getExecucao(exec.id)) : atual;
  } catch (err) {
    // Falha antes de falar com o SoftExpert (consulta, usuário, contrato): não conta tentativa, mas avisa.
    console.error(`[IA Service] Jade PA: envio do chamado ${exec.numeroChamado}:`, err.message);
    return repo.atualizar(exec.id, { ultimoErro: err.message, alerta: true });
  }
}

/** Roda `fn` em cada item com no máximo `limite` ao mesmo tempo. */
async function _emParalelo(itens, limite, fn) {
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) await fn(itens[proximo++]);
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limite), itens.length) }, trabalhador));
}

async function _rodarCiclo(empresaId, fonteId) {
  const resumo = { inicio: new Date().toISOString(), elegiveis: 0, novos: 0, limiteAtingido: false, processados: [], erros: [] };
  try {
    const cfg = repo.getConfig(empresaId, fonteId);
    const fonte = agenteRepo.getFonte(empresaId, fonteId);
    if (!fonte?.ativo) throw new Error('Fonte inativa ou excluída.');
    // Lista de chamados permitidos preenchida (teste em produção): todo o resto é ignorado.
    const permitido = (numero) => !cfg.somenteChamados.length || cfg.somenteChamados.includes(String(numero));
    // Com lista, consulta cada chamado direto, sem depender da ordem da lista geral.
    const elegiveis = cfg.somenteChamados.length
      ? (await Promise.all(cfg.somenteChamados.map(n => listarElegiveisNaOrigem(empresaId, fonteId, { numero: n })))).flat()
      : await listarElegiveisNaOrigem(empresaId, fonteId);
    resumo.elegiveis = elegiveis.length;
    if (cfg.somenteChamados.length) resumo.somenteChamados = cfg.somenteChamados;
    const inicioDia = new Date();
    inicioDia.setHours(0, 0, 0, 0);
    let usadosHoje = repo.contarDetectadosDesde(empresaId, inicioDia.toISOString());
    for (const numero of elegiveis) {
      if (cfg.limiteDiario > 0 && usadosHoje >= cfg.limiteDiario) { resumo.limiteAtingido = true; break; }
      if (repo.registrarDetectado(empresaId, fonteId, numero)) { resumo.novos++; usadosHoje++; }
    }
    // Desligado no meio do ciclo: para antes do próximo chamado.
    const aindaLigada = () => repo.getConfig(empresaId, fonteId).ativo;
    // Envio ao SoftExpert só no modo Publicar; em Simulação, "pronto" espera.
    const publicar = cfg.modo === 'publicar';
    if (publicar) resumo.enviados = [];
    const enviar = async (exec) => {
      repo.renovarTrava(empresaId, fonteId, TRAVA_MS);
      const r = await enviarExecucao(cfg, fonte, exec);
      if (r) resumo.enviados.push({ numero: exec.numeroChamado, estado: r.estado });
    };
    // Falha de um chamado não derruba os outros que estão em paralelo.
    const isolado = (fn) => async (exec) => {
      if (!aindaLigada()) return;
      try { await fn(exec); } catch (err) { resumo.erros.push(`${exec.numeroChamado}: ${err.message}`); }
    };
    const paralelo = cfg.processamentosSimultaneos;
    // Primeiro o que ficou pendente de envio de ciclos anteriores.
    if (publicar) {
      await _emParalelo(repo.listarParaEnviar(empresaId, fonteId).filter(e => permitido(e.numeroChamado)), paralelo, isolado(enviar));
    }
    // Todos os chamados na fila; cada retorno vai ao SoftExpert assim que fica pronto.
    const fila = repo.listarParaGerar(empresaId, fonteId, { gerandoParadoMs: TRAVA_MS }).filter(e => permitido(e.numeroChamado));
    await _emParalelo(fila, paralelo, isolado(async (exec) => {
      repo.renovarTrava(empresaId, fonteId, TRAVA_MS);
      const r = await processarExecucao(cfg, fonte, exec);
      if (r) resumo.processados.push({ numero: exec.numeroChamado, estado: r.estado });
      if (publicar && r?.estado === 'pronto' && aindaLigada()) await enviar(r);
    }));
  } catch (err) {
    resumo.erros.push(err.message);
    console.error(`[IA Service] Jade PA: ciclo da empresa ${empresaId} falhou:`, err.message);
  } finally {
    resumo.fim = new Date().toISOString();
    resumo.duracaoMs = Date.parse(resumo.fim) - Date.parse(resumo.inicio);
    // Leitura mais longa que o intervalo: a próxima já está atrasada (aviso na tela).
    try { resumo.encavalou = resumo.duracaoMs > repo.getConfig(empresaId, fonteId).intervaloMinutos * 60000; } catch { /* aviso apenas */ }
    repo.liberarCiclo(empresaId, fonteId, resumo);
  }
  return resumo;
}

/** Roda o ciclo se o intervalo já passou e nenhum outro processo está rodando. */
async function executarCiclo(empresaId, fonteId, { forcar = false } = {}) {
  if (!repo.tentarTravarCiclo(empresaId, fonteId, { travaMs: TRAVA_MS, forcar })) return null;
  return _rodarCiclo(empresaId, fonteId);
}

/** Botão "Executar agora": não espera o ciclo terminar. */
function executarAgora(empresaId, fonteId) {
  const cfg = repo.getConfig(empresaId, fonteId);
  if (!cfg.ativo) throw _erro(409, 'Ligue a Jade no Primeiro Atendimento antes de executar.');
  if (!repo.tentarTravarCiclo(empresaId, fonteId, { travaMs: TRAVA_MS, forcar: true })) throw _erro(409, 'Já existe um ciclo em andamento.');
  _rodarCiclo(empresaId, fonteId).catch(() => {});
  return { iniciado: true };
}

function _fonteSoftExpert(empresaId, fonteId) {
  const fonte = agenteRepo.getFonte(empresaId, fonteId);
  if (!fonte) throw _erro(404, 'Fonte não encontrada.');
  if (fonte.sistemaOrigem !== 'softexpert') throw _erro(400, 'A Jade no Primeiro Atendimento só funciona com fonte do SoftExpert.');
  return fonte;
}

function getConfig(empresaId, fonteId) {
  _fonteSoftExpert(empresaId, fonteId);
  return repo.getConfig(empresaId, fonteId);
}

async function salvarConfig(empresaId, fonteId, dados = {}) {
  _fonteSoftExpert(empresaId, fonteId);
  const atual = repo.getConfig(empresaId, fonteId);
  const modo = dados.modo ?? atual.modo;
  const usuario = dados.usuarioSoftexpert === undefined ? atual.usuarioSoftexpert : (String(dados.usuarioSoftexpert ?? '').trim() || null);
  // Publicar só com o usuário da Jade ativo no SoftExpert e autorizado no contrato de escrita.
  if (modo === 'publicar') {
    try {
      const jade = await _usuarioJade(empresaId, fonteId, usuario);
      _contratoEscrita(empresaId, fonteId, jade.codigo);
    } catch (err) {
      throw _erro(400, `Não é possível ligar a publicação: ${err.message}`);
    }
  }
  return repo.salvarConfig(empresaId, fonteId, dados);
}

function listarExecucoes(empresaId, opts) {
  return repo.listarExecucoes(empresaId, opts);
}

let _tickEmAndamento = false;
async function _tick() {
  if (_tickEmAndamento) return;
  _tickEmAndamento = true;
  try {
    for (const cfg of repo.listarConfigsAtivas()) {
      try {
        await executarCiclo(cfg.empresaId, cfg.fonteId);
      } catch (err) {
        console.error(`[IA Service] Jade PA: falha no agendamento (empresa ${cfg.empresaId}):`, err.message);
      }
    }
  } finally {
    _tickEmAndamento = false;
  }
}

function iniciarAgendamento() {
  setTimeout(() => {
    _tick();
    setInterval(_tick, TICK_MS).unref?.();
  }, PRIMEIRA_EXECUCAO_MS).unref?.();
}

module.exports = {
  iniciarAgendamento, executarCiclo, executarAgora, processarExecucao, gerarTextoCliente, verificarVazamento,
  normalizarTextoSoftExpert, montarAtributosPosicionamento, enviarExecucao, situacaoNaOrigem, nomesDeOutrosClientes,
  listarElegiveisNaOrigem, getConfig, salvarConfig, listarExecucoes, SQL_ELEGIVEIS, MAX_TENTATIVAS,
};
