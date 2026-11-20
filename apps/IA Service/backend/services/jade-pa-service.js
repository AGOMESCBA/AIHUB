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
const { AsyncLocalStorage } = require('async_hooks');
const repo = require('../repositories/jade-pa-repository');
const agenteRepo = require('../repositories/agente-local-repository');
const agenteLocalService = require('./agente-local-service');
const historicalImportService = require('./import/historical-import-service');
const chamadoRepo = require('../repositories/chamado-repository');
const radarService = require('./radar-service');
const anexosSoftExpertService = require('./anexos-softexpert-service');
const anexoRepo = require('../repositories/anexo-repository');
const turnoLockService = require('./turno-lock-service');
const aiConfigService = require('./ai-config-service');
const aiProviderClient = require('./ai-provider-client');
const retornoConfig = require('./retorno-softexpert-config');
const soapClient = require('./softexpert-soap-client');
const clienteRepo = require('../repositories/cliente-repository');
const investigacaoExecucaoRepo = require('../repositories/investigacao-execucao-repository');
const avisoService = require('./jade-pa-aviso-service');

// Curto para a leitura começar perto da hora do contador da tela (a consulta é só ao banco local).
const TICK_MS = 15 * 1000;
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
    (SELECT TOP 1 D.DP FROM DYNITSM D WHERE D.IDPROCESS = W.IDPROCESS) AS CAB_EMPRESA,
    (SELECT TOP 1 D.NMSOLICITANTE FROM DYNITSM D WHERE D.IDPROCESS = W.IDPROCESS) AS CAB_COLABORADOR,
    (SELECT TOP 1 D.TEXTO31 FROM DYNITSM D WHERE D.IDPROCESS = W.IDPROCESS) AS CAB_ASSUNTO,
    S.IDSTRUCT AS ATIVA
  FROM WFPROCESS W
  LEFT JOIN WFSTRUCT S ON S.IDPROCESS = W.IDOBJECT AND S.FGSTATUS = 2
  WHERE W.IDPROCESS = @numero
`;

const SQL_USUARIO_JADE = 'SELECT CDUSER, NMUSER, IDUSER, FGUSERENABLED FROM ADUSER WHERE CDUSER = @cdUser';

const MARCA_JADE = 'IA SERVICE';
const ATIVIDADE_CLIENTE = 'ATV-06';

const TEXTO_ANALISE_PA = 'Este chamado acabou de ser aberto pelo cliente e está no Primeiro Atendimento (triagem), sem nenhum posicionamento ainda. Faça uma pré-análise inicial com base no texto do chamado e nos anexos sincronizados, quando existirem: identifique o problema relatado, hipóteses prováveis de causa, possíveis soluções que o próprio cliente consiga testar e quais informações ou evidências ainda faltam para avançar. Deixe claro no nível de confiança que esta é uma análise preliminar, sem confirmação humana.';

const SYSTEM_PROMPT_CLIENTE = `Você é a Jade, atendente de IA do suporte. Você escreve o PRIMEIRO retorno ao CLIENTE que abriu o chamado, como um analista experiente orientando o cliente a RESOLVER o problema: resposta simples, com conteúdo técnico. O texto vai para o portal do cliente: fale COM ele ("você", "sua equipe", "nos envie", "verifique"), nunca SOBRE ele ("peça ao cliente", "o cliente informou", "do lado do cliente").

Responda SOMENTE com um JSON válido, sem nada antes ou depois:
{"decisao": "responder" | "devolver", "motivo": "frase curta, uso interno, explicando a decisão", "texto": "texto ao cliente"}

Como decidir:
- "responder": há informação suficiente para orientar. Se faltar algo que ajudaria, peça no mesmo texto.
- "devolver": SOMENTE quando realmente não há o que pesquisar — sem anexo ou evidência E descrição vaga, sem rotina/tela identificada e sem mensagem de erro. Na dúvida, escolha "responder".

Como escrever — o campo do SoftExpert é TEXTO PURO: nada de markdown (#, **, crases, tabelas):
1. Comece exatamente com: "Olá! Em breve seu chamado será direcionado a um atendente. Enquanto isso, segue abaixo uma análise preliminar feita pela atendente de IA Jade."
2. Diagnóstico curto (2 a 4 frases): o que a mensagem, o relato e os anexos indicam e a causa mais provável, citando os fatos concretos do chamado (rotina, mensagem, valores, datas).
3. O centro do texto é COMO RESOLVER: o passo a passo técnico que um analista passaria para o cliente corrigir ou contornar sozinho — rotina e caminho de menu, parâmetro, campo, cadastro ou configuração a conferir, o que ajustar e como confirmar que resolveu. Se houver mais de uma causa possível, uma verificação objetiva para cada, da mais provável para a menos provável. Itens numerados ("1.", "2.") em linhas próprias.
4. Só depois, e só se realmente faltar algo, peça o mínimo necessário para avançar caso os passos não resolvam, específico para ESTE chamado (prefira um recorte pequeno e comparável a "envie tudo"). Pode fazer uma pergunta direta quando ela acelerar a análise.
5. Ao devolver, explique de forma cordial por que ainda não dá para analisar e liste o que ele precisa enviar.
6. Títulos em MAIÚSCULAS numa linha própria são opcionais: use só se ajudarem a organizar um texto mais longo.
7. Termine com "Ficamos no aguardo do seu retorno." e, na última linha, "Jade, atendente de IA".

Regras:
- Português do Brasil; tom de analista: cordial, seguro e direto, frases curtas, sem rodeios, sem repetir a mesma ideia e sem jargão interno do suporte.
- Quem lê costuma ser usuário de negócio (financeiro, fiscal, compras), não programador: explique em palavras simples o que for técnico (ex.: "ponto de entrada, que é uma customização feita no sistema"); ao pedir algo técnico (fonte, log, arquivo de integração), diga o que é e quem na equipe dele costuma ter (a TI ou a consultoria responsável pela customização). Mantenha a precisão: nomes de rotinas, campos e mensagens ficam como estão.
- Não invente: use só o que está no chamado, nos anexos e na análise técnica. Não prometa prazo nem solução garantida.
- NUNCA cite números de outros chamados, nomes de outros clientes, empresas, pessoas ou dados internos; não mencione "base histórica", fontes internas, nível de confiança, a análise técnica em si nem a classificação interna do chamado (tipo, nível, categoria).
- Links: quando a entrada trouxer documentação oficial lida pela pesquisa que ajude a resolver (artigo da Central TOTVS, TDN, atualização ou pacote a aplicar), cite o link completo numa linha própria logo após o passo a que se refere. Use SOMENTE os links dessa lista, copiados exatamente; nunca escreva outro endereço. Se a documentação indicar atualização (patch, pacote, expedição) que corrige o problema, oriente a aplicação e recomende aplicar primeiro em ambiente de homologação.
- Nunca peça senha, token, chave de acesso ou credencial; ao pedir log, requisição ou cabeçalhos de API, peça para ocultar esses dados antes de enviar.
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

// Sempre uma análise nova, com pesquisa na documentação oficial, gravada no
// chat da J2iA. Não reaproveita a que já estiver no chat: ela pode ser antiga
// e sem pesquisa, e o retorno ao cliente sairia sem os links oficiais (caso
// real #037059, 2026-11-20).
async function _obterAnaliseTecnica(empresaId, atendimentoId, anexos) {
  if (!turnoLockService.tentarAdquirir(empresaId, atendimentoId)) {
    throw Object.assign(new Error('O chat deste chamado está em uso; a Jade tenta de novo no próximo ciclo.'), { adiar: true });
  }
  try {
    const mensagem = await _investigacao().processarTurno(empresaId, atendimentoId, {
      texto: TEXTO_ANALISE_PA, usuarioId: null, anexoIds: anexos.map(a => a.id).filter(Boolean), automatico: true,
      // Pesquisa na documentação oficial sempre: o retorno ao cliente só cita
      // links que a pesquisa realmente leu (pedido do usuário, 2026-11-20).
      forcarPesquisa: true,
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

const MAX_FONTES = 8;

/** Páginas oficiais (Central TOTVS, TDN…) que a pesquisa da análise realmente leu — as únicas que podem ir ao cliente. */
function fontesDaAnalise(empresaId, atendimentoId, mensagemId) {
  const fontes = new Map();
  try {
    for (const ex of investigacaoExecucaoRepo.listarPorAtendimento(empresaId, atendimentoId, { limite: 20 })) {
      if (mensagemId && ex.mensagemId !== mensagemId) continue;
      for (const p of ex.pesquisa?.paginasLidas || []) {
        if (p?.oficial && p.status === 'lida' && /^https:\/\/\S+$/.test(p.url || '') && !fontes.has(p.url)) {
          fontes.set(p.url, { titulo: _limitar(p.titulo, 160), url: p.url });
        }
      }
    }
  } catch (err) {
    console.error('[IA Service] Jade PA: fontes da pesquisa indisponíveis:', err.message);
  }
  return [...fontes.values()].slice(0, MAX_FONTES);
}

function _montarEntrada({ chamado, anexos, analise, fontes = [] }) {
  const partes = [`Chamado nº ${chamado.numero}`];
  for (const [rotulo, valor] of [['Título', chamado.titulo], ['Assunto', chamado.assunto], ['Breve descrição', chamado.breveDescricao],
    ['Descrição do cliente', chamado.descricao], ['Informações adicionais', chamado.informacoesAdicionais]]) {
    if (valor && String(valor).trim()) partes.push(`${rotulo}: ${_limitar(valor, 4000)}`);
  }
  partes.push(anexos.length
    ? `Anexos enviados pelo cliente (${anexos.length}): ${anexos.map(a => a.nomeOriginal || a.nome || 'arquivo').join(', ')}`
    : 'Anexos enviados pelo cliente: nenhum.');
  partes.push(`Análise técnica interna (NÃO copie referências, números de chamados ou nomes daqui):\n${_limitar(analise?.conteudo, 8000) || '(indisponível)'}`);
  partes.push(fontes.length
    ? `Documentação oficial lida pela pesquisa (os ÚNICOS links que podem ir ao cliente, copiados exatamente):\n${fontes.map(x => `- ${x.titulo} — ${x.url}`).join('\n')}`
    : 'Documentação oficial lida pela pesquisa: nenhuma. Não cite links.');
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
function verificarVazamento(texto, numeroProprio, outrosClientes = [], linksPermitidos = []) {
  const problemas = [];
  const permitidos = new Set(linksPermitidos);
  for (const m of String(texto).matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, '');
    if (!permitidos.has(url)) problemas.push(`cita link que não veio da pesquisa (${url})`);
  }
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
  if (/\b(pe[cç]a|pergunte|solicite|oriente|confirme)\s+(ao|com o)\s+cliente\b|\b(do|pelo) lado do cliente\b|\bo cliente (informou|relatou|enviou|anexou|disse)\b/i.test(texto)) {
    problemas.push('fala do cliente em terceira pessoa (texto escrito para o analista, não para o cliente)');
  }
  return [...new Set(problemas)];
}

async function gerarTextoCliente(empresaId, dados) {
  const { keys, cfg } = aiConfigService.resolverKeysEOrdem(empresaId);
  let entrada = _montarEntrada(dados);
  const outrosClientes = nomesDeOutrosClientes(empresaId, dados.chamado.clienteId);
  let ultimoProblema = 'resposta da IA sem o formato esperado';
  // Versões recusadas vão para a auditoria (motivo de cada uma).
  const recusas = [];
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const resultado = await aiProviderClient.chamarIA(keys, cfg, SYSTEM_PROMPT_CLIENTE, entrada, [], { maxTokens: 2000, timeoutMs: 90000 });
    const json = resultado.truncado ? null : _extrairJson(resultado.texto);
    const texto = normalizarTextoSoftExpert(json?.texto);
    if (!json || !['responder', 'devolver'].includes(json.decisao) || !texto) {
      ultimoProblema = resultado.truncado ? 'resposta da IA cortada' : 'resposta da IA sem o formato esperado';
      recusas.push(`Versão ${tentativa}: ${ultimoProblema}`);
      continue;
    }
    if (texto.length > MAX_TEXTO_CLIENTE) {
      ultimoProblema = 'texto ao cliente longo demais';
      recusas.push(`Versão ${tentativa}: ${ultimoProblema}`);
      continue;
    }
    const problemas = verificarVazamento(texto, dados.chamado.numero, outrosClientes, (dados.fontes || []).map(x => x.url));
    if (problemas.length) {
      ultimoProblema = `texto ao cliente ${problemas.join(', ')}`;
      recusas.push(`Versão ${tentativa}: ${ultimoProblema}`);
      entrada = `${_montarEntrada(dados)}\n\nATENÇÃO: a versão anterior foi recusada porque ${problemas.join(', ')}. Reescreva sem isso.`;
      continue;
    }
    return { decisao: json.decisao, motivo: _limitar(json.motivo, 500), texto, provider: resultado.provider, model: resultado.model, recusas };
  }
  throw Object.assign(new Error(`Texto ao cliente recusado: ${ultimoProblema}.`), { recusas });
}

// Trilha de auditoria (tela "fluxo" do chamado). Falha ao registrar nunca
// interrompe o trabalho da Jade.
// Lote da leitura em curso: chega a cada registro sem passar por todas as funções.
const _loteAtual = new AsyncLocalStorage();

function _evento(exec, etapa, situacao, resumo, detalhes = null) {
  try {
    repo.registrarEvento(exec.id, exec.empresaId, { etapa, situacao, resumo, detalhes, loteId: _loteAtual.getStore()?.loteId ?? null });
  } catch (err) {
    console.error(`[IA Service] Jade PA: auditoria do chamado ${exec.numeroChamado || exec.id}:`, err.message);
  }
}

// Erro como veio, para o ajuste técnico pela tela (mensagem, códigos e o
// início da pilha). Não carrega credencial: os erros do transporte SOAP não
// incluem cabeçalhos nem envelope.
function _erroTecnico(err, extra = {}) {
  if (!err) return undefined;
  const t = { mensagem: err.message, tipo: err.name !== 'Error' ? err.name : undefined, ...extra };
  for (const k of ['code', 'status', 'httpStatus', 'codigoTransporte', 'resultadoIndeterminado']) if (err[k] !== undefined) t[k] = err[k];
  if (err.stack) t.pilha = String(err.stack).split('\n').slice(1, 6).map(l => l.trim()).join('\n');
  return t;
}

// Só o que interessa da resposta do SoftExpert (nunca o envelope).
function _respostaSe(resposta) {
  const r = {};
  for (const k of ['Status', 'Code', 'Detail', 'RecordID', 'RecordKey', 'httpStatus']) if (resposta?.[k] !== undefined && resposta[k] !== '') r[k] = resposta[k];
  return r;
}

async function processarExecucao(cfg, fonte, exec) {
  const { empresaId } = cfg;
  if (!repo.marcarGerando(exec.id, exec.estado, exec.atualizadoEm)) return null;
  const tentativa = exec.tentativasGeracao + 1;
  const rotuloTentativa = `Tentativa ${tentativa}/${MAX_TENTATIVAS}`;
  // Etapa em curso: o erro vai para a atividade do fluxo onde aconteceu.
  let etapa = 'deteccao';
  const descartar = () => {
    _evento(exec, etapa, 'aviso', 'Descartado: a triagem atuou no chamado antes da Jade (responsável definido ou posicionamento registrado).');
    return repo.atualizar(exec.id, {
      estado: 'descartado', motivo: 'A triagem atuou no chamado antes da Jade (responsável definido ou posicionamento registrado).',
      motivoCodigo: 'triagem_atuou',
    });
  };
  try {
    if (!(await _aindaElegivel(empresaId, fonte.id, exec.numeroChamado))) return descartar();
    _evento(exec, 'deteccao', 'info', `${rotuloTentativa}: conferido no SoftExpert — segue no Primeiro Atendimento, sem responsável e sem posicionamento.`);
    etapa = 'importacao';
    const chamado = await _importarChamado(empresaId, fonte.id, exec.numeroChamado);
    const { atendimento } = radarService.iniciarAnalise(empresaId, chamado.id, { preAnaliseAutomatica: false });
    repo.atualizar(exec.id, { chamadoId: chamado.id, atendimentoId: atendimento.id });
    _evento(exec, 'importacao', 'ok', `Chamado importado do SoftExpert: ${chamado.titulo || chamado.assunto || 'sem título'}`, {
      titulo: chamado.titulo, assunto: chamado.assunto, modulo: chamado.modulo, tipo: chamado.tipoChamadoFinal || chamado.tipoChamado,
      descricao: _limitar(chamado.descricao, 4000),
    });
    etapa = 'anexos';
    let falhaAnexos = null;
    await anexosSoftExpertService.sincronizarAnexosParaAtendimento(empresaId, chamado.id, atendimento.id).catch((err) => {
      falhaAnexos = err.message;
      console.error(`[IA Service] Jade PA: cópia de anexos falhou (chamado ${chamado.numero}):`, err.message);
    });
    const anexos = anexoRepo.listarAnexos(empresaId, atendimento.id);
    const arquivos = anexos.map(a => a.nomeOriginal || a.nome || 'arquivo');
    _evento(exec, 'anexos', falhaAnexos ? 'aviso' : 'ok',
      falhaAnexos ? `A cópia dos anexos falhou; a análise segue com ${anexos.length} arquivo(s): ${falhaAnexos}`
        : anexos.length ? `${anexos.length} anexo(s) entregue(s) à IA` : 'O chamado não tem anexos',
      arquivos.length ? { arquivos } : null);
    etapa = 'analise';
    const inicioAnalise = Date.now();
    const analise = await _obterAnaliseTecnica(empresaId, atendimento.id, anexos);
    const fontes = fontesDaAnalise(empresaId, atendimento.id, analise.id);
    _evento(exec, 'analise', 'ok',
      `Análise técnica com pesquisa feita em ${Math.round((Date.now() - inicioAnalise) / 1000)} s e gravada no chat da J2iA — ${fontes.length ? `${fontes.length} página(s) oficial(is) lida(s)` : 'nenhuma página oficial lida'}`,
    { analise: _limitar(analise.conteudo, 8000), fontesOficiais: fontes.length ? fontes.map(x => `${x.titulo} — ${x.url}`) : undefined });
    etapa = 'retorno';
    const gerado = await gerarTextoCliente(empresaId, { chamado, anexos, analise, fontes });
    // Devolução desligada: o pedido de informação vai como resposta (o chamado fica no PA).
    const devolver = gerado.decisao === 'devolver' && cfg.devolucaoAtiva;
    const motivo = gerado.decisao === 'devolver' && !cfg.devolucaoAtiva ? `${gerado.motivo} (devolução desligada: fica como resposta)` : gerado.motivo;
    _evento(exec, 'retorno', gerado.recusas.length ? 'aviso' : 'ok',
      `Retorno ao cliente escrito — decisão: ${devolver ? 'devolver ao cliente' : 'responder'}${gerado.recusas.length ? ` (${gerado.recusas.length} versão(ões) recusada(s) antes)` : ''}`,
      { decisao: devolver ? 'Devolver ao cliente' : 'Responder', motivo, modelo: [gerado.provider, gerado.model].filter(Boolean).join(' · '),
        recusas: gerado.recusas.length ? gerado.recusas : undefined, texto: gerado.texto });
    if (!(await _aindaElegivel(empresaId, fonte.id, exec.numeroChamado))) return descartar();
    if (cfg.modo !== 'publicar') _evento(exec, 'envio', 'info', 'Modo Simulação: o retorno não foi enviado ao SoftExpert.');
    return repo.atualizar(exec.id, {
      estado: cfg.modo === 'publicar' ? 'pronto' : 'simulado', decisao: devolver ? 'devolver' : 'responder', motivo,
      textoCliente: gerado.texto, mensagemAnaliseId: analise?.id ?? null, geradoEm: new Date().toISOString(), ultimoErro: null, alerta: false,
    });
  } catch (err) {
    if (err.adiar) {
      _evento(exec, etapa, 'aviso', `Adiado para o próximo ciclo: ${err.message}`);
      repo.devolverTentativaGeracao(exec.id);
      return repo.atualizar(exec.id, { estado: 'detectado', ultimoErro: err.message });
    }
    const esgotou = tentativa >= MAX_TENTATIVAS;
    _evento(exec, etapa, 'erro', `${rotuloTentativa} falhou: ${err.message}${esgotou ? ' — tentativas esgotadas, chamado deixado para a triagem.' : ' — nova tentativa no próximo ciclo.'}`,
      { recusas: err.recusas?.length ? err.recusas : undefined, erroTecnico: _erroTecnico(err, { etapa }) });
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
    // Cabeçalho do chamado (DYNITSM) que o formulário copia para a grade.
    cabecalho: { empresa: r.CAB_EMPRESA ?? null, colaborador: r.CAB_COLABORADOR ?? null, assunto: r.CAB_ASSUNTO ?? null },
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
function montarAtributosPosicionamento({ contrato, chamado, jade, texto, cabecalho = {}, instante = new Date() }) {
  const hora = _horaMeiaHora(instante);
  const desejados = {
    DESCRICAO: texto,
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
  const PREENCHIDOS = ['cduserana', 'analistaj2a', 'texto4', 'chamado', 'dataatual', 'horaatual', 'empresa', 'colabcliente', 'assunto'];
  for (const id of Object.keys(atributos)) if (PREENCHIDOS.includes(id.toLowerCase())) delete atributos[id];
  atributos.cduserana = jade.codigo;
  atributos.analistaj2a = jade.nome;
  atributos.texto4 = MARCA_JADE;
  // Campos que o formulário preenche sozinho quando o registro é feito pela tela
  // (vinham vazios pela API, chamado 037058; conferido contra registros do Edson):
  // CHAMADO = IDPROCESS; Data e Hora = momento da integração, no fuso do
  // servidor como HORAINI (API wf_ws: data YYYY-MM-DD, hora HH:MM); Empresa,
  // Colaborador e Assunto = cabeçalho do chamado (DYNITSM DP, NMSOLICITANTE, TEXTO31).
  const p2 = (n) => String(n).padStart(2, '0');
  atributos.chamado = String(chamado.numero);
  atributos.dataatual = `${instante.getFullYear()}-${p2(instante.getMonth() + 1)}-${p2(instante.getDate())}`;
  atributos.horaatual = `${p2(instante.getHours())}:${p2(instante.getMinutes())}`;
  for (const [id, valor] of [['empresa', cabecalho.empresa], ['colabcliente', cabecalho.colaborador], ['assunto', cabecalho.assunto]]) {
    if (String(valor ?? '').trim()) atributos[id] = String(valor).trim();
  }
  return atributos;
}

function _falhaDefinitiva(exec, motivo, etapa) {
  _evento(exec, etapa, 'erro', `${motivo} Chamado deixado para a triagem.`);
  return repo.atualizar(exec.id, { estado: 'falha', ultimoErro: `${motivo} Chamado deixado para a triagem.`, alerta: true });
}

async function _publicar(cfg, fonte, exec) {
  const { empresaId } = cfg;
  const s = await situacaoNaOrigem(empresaId, fonte.id, exec.numeroChamado);
  if (s?.posicionamentosJade > 0) {
    // Envio anterior confirmado na origem (inclusive um "não confirmado" que tinha entrado).
    _evento(exec, 'envio', 'ok', 'Conferido no SoftExpert: o posicionamento da Jade está na grade do chamado.');
    const publicado = repo.atualizar(exec.id, { estado: 'publicado', publicadoEm: exec.publicadoEm || new Date().toISOString(), ultimoErro: null, alerta: false });
    return exec.decisao === 'devolver' ? repo.atualizar(publicado.id, { estado: 'devolvendo' }) : publicado;
  }
  if (exec.tentativasPublicacao >= MAX_TENTATIVAS) return _falhaDefinitiva(exec, 'O SoftExpert não confirmou o posicionamento após 3 tentativas.', 'envio');
  if (_triagemAtuou(s)) {
    _evento(exec, 'envio', 'aviso', 'Descartado: a triagem atuou no chamado antes do envio da Jade. Nada foi gravado.');
    return repo.atualizar(exec.id, { estado: 'descartado', motivo: 'A triagem atuou no chamado antes do envio da Jade.', motivoCodigo: 'triagem_atuou', alerta: false });
  }
  if (exec.estado === 'pronto' && Date.now() - Date.parse(exec.geradoEm || 0) > MAX_IDADE_ENVIO_MS) {
    _evento(exec, 'envio', 'aviso', 'Descartado: texto gerado há mais de 4 horas, não enviado para não chegar desatualizado ao cliente.');
    return repo.atualizar(exec.id, { estado: 'descartado', motivo: 'Texto gerado há mais de 4 horas; não foi enviado para não chegar desatualizado ao cliente.', motivoCodigo: 'texto_vencido', alerta: false });
  }
  const tentativaEnvio = `Tentativa ${exec.tentativasPublicacao + 1}/${MAX_TENTATIVAS}`;
  const chamado = chamadoRepo.getChamadoPorNumero(empresaId, exec.numeroChamado, 'softexpert');
  if (!chamado) throw new Error('Chamado não encontrado na base local.');
  const jade = await _usuarioJade(empresaId, fonte.id, cfg.usuarioSoftexpert);
  const config = _contratoEscrita(empresaId, fonte.id, jade.codigo);
  const atributos = montarAtributosPosicionamento({ contrato: config.contrato, chamado, jade, texto: exec.textoCliente, cabecalho: s?.cabecalho });
  const xml = soapClient.montarInclusaoGrid({ workflowId: exec.numeroChamado, mainEntityId: config.contrato.mainEntityId, childRelationshipId: config.contrato.childRelationshipId, campos: atributos });
  if (!repo.contarTentativa(exec.id, 'publicacao', 'publicando', { estadoAnterior: exec.estado, tentativasAnteriores: exec.tentativasPublicacao })) return null;
  const gravado = { usuario: `${jade.nome} (CDUSER ${jade.codigo}, matrícula ${jade.matricula})`, campos: atributos };
  let resposta;
  try {
    resposta = await soapClient.enviarOperacao({ ...config.transporte, xml, operacao: 'newChildEntityRecord' });
  } catch (err) {
    _evento(exec, 'envio', 'erro', `${tentativaEnvio}: o SoftExpert não confirmou a gravação (${err.message}). Será conferido no próximo ciclo antes de qualquer reenvio.`,
      { ...gravado, resposta: _respostaSe({ httpStatus: err.httpStatus, Detail: err.codigoTransporte }), erroTecnico: _erroTecnico(err, { operacao: 'newChildEntityRecord' }) });
    return repo.atualizar(exec.id, { ultimoErro: 'Envio do posicionamento não confirmado; será conferido no próximo ciclo antes de qualquer reenvio.' });
  }
  if (resposta.Status !== 'SUCCESS' || resposta.Code !== '1') {
    _evento(exec, 'envio', 'erro', `${tentativaEnvio}: o SoftExpert recusou o posicionamento — ${resposta.Detail || resposta.Code}`,
      { ...gravado, resposta: _respostaSe(resposta), erroTecnico: { mensagem: resposta.Detail || 'Recusa sem detalhe', operacao: 'newChildEntityRecord', status: resposta.Status, code: resposta.Code } });
    return repo.atualizar(exec.id, { ultimoErro: `O SoftExpert recusou o posicionamento: ${resposta.Detail || resposta.Code}` });
  }
  _evento(exec, 'envio', 'ok', 'Posicionamento gravado na grade do chamado no SoftExpert', { ...gravado, resposta: _respostaSe(resposta) });
  const publicado = repo.atualizar(exec.id, { estado: 'publicado', publicadoEm: new Date().toISOString(), ultimoErro: null, alerta: false });
  return exec.decisao === 'devolver' ? repo.atualizar(publicado.id, { estado: 'devolvendo' }) : publicado;
}

async function _devolver(cfg, fonte, exec) {
  const { empresaId } = cfg;
  const s = await situacaoNaOrigem(empresaId, fonte.id, exec.numeroChamado);
  if (s && !s.ativas.has('ATV-02')) {
    if (s.ativas.has(ATIVIDADE_CLIENTE)) {
      _evento(exec, 'devolucao', 'ok', 'Conferido no SoftExpert: o chamado está com o cliente (Retorno do Usuário).');
      return repo.atualizar(exec.id, { estado: 'devolvido', devolvidoEm: new Date().toISOString(), ultimoErro: null, alerta: false });
    }
    // Saiu do PA para outro lugar: se a Jade tentou devolver, alguém precisa olhar.
    const ultimoErro = `O chamado saiu do Primeiro Atendimento para ${[...s.ativas].join(', ') || 'outra etapa'}, não para o cliente.`;
    _evento(exec, 'devolucao', exec.tentativasDevolucao > 0 ? 'erro' : 'aviso', ultimoErro);
    return repo.atualizar(exec.id, { estado: 'publicado', alerta: exec.tentativasDevolucao > 0, ultimoErro });
  }
  const cancelar = (motivo) => {
    _evento(exec, 'devolucao', 'aviso', `Devolução não feita: ${motivo}.`);
    return repo.atualizar(exec.id, { estado: 'publicado', motivo: `${exec.motivo || ''} (${motivo})`.trim(), alerta: false });
  };
  if (!cfg.devolucaoAtiva) return cancelar('devolução desligada antes do envio; o pedido ficou como resposta');
  if (!s || !s.aberto || s.comResponsavel || s.posicionamentosOutros > 0) return cancelar('devolução cancelada: a triagem atuou no chamado');
  if (exec.tentativasDevolucao >= MAX_TENTATIVAS) return _falhaDefinitiva(exec, 'O SoftExpert não confirmou a devolução ao cliente após 3 tentativas; o pedido de informação já está na grade.', 'devolucao');
  const tentativaDev = `Tentativa ${exec.tentativasDevolucao + 1}/${MAX_TENTATIVAS}`;
  const jade = await _usuarioJade(empresaId, fonte.id, cfg.usuarioSoftexpert);
  const config = _contratoEscrita(empresaId, fonte.id, jade.codigo);
  const xml = soapClient.montarDevolucaoPrimeiroAtendimento({ workflowId: exec.numeroChamado, userId: jade.matricula });
  if (!repo.contarTentativa(exec.id, 'devolucao', 'devolvendo', { estadoAnterior: exec.estado, tentativasAnteriores: exec.tentativasDevolucao })) return null;
  const movimento = { usuario: `${jade.nome} (matrícula ${jade.matricula})`, atividade: 'ATV-02 Primeiro Atendimento', acao: '1 — Retornar para cliente', destino: `${ATIVIDADE_CLIENTE} Retorno do Usuário` };
  let resposta;
  try {
    resposta = await soapClient.enviarOperacao({ ...config.transporte, xml, operacao: 'executeActivity' });
  } catch (err) {
    _evento(exec, 'devolucao', 'erro', `${tentativaDev}: o SoftExpert não confirmou a devolução (${err.message}). Será conferida no próximo ciclo.`,
      { ...movimento, resposta: _respostaSe({ httpStatus: err.httpStatus, Detail: err.codigoTransporte }), erroTecnico: _erroTecnico(err, { operacao: 'executeActivity' }) });
    return repo.atualizar(exec.id, { ultimoErro: 'Devolução não confirmada; será conferida no próximo ciclo antes de qualquer nova tentativa.' });
  }
  if (resposta.Status !== 'SUCCESS' || resposta.Code !== '1') {
    _evento(exec, 'devolucao', 'erro', `${tentativaDev}: o SoftExpert recusou a devolução — ${resposta.Detail || resposta.Code}`,
      { ...movimento, resposta: _respostaSe(resposta), erroTecnico: { mensagem: resposta.Detail || 'Recusa sem detalhe', operacao: 'executeActivity', status: resposta.Status, code: resposta.Code } });
    return repo.atualizar(exec.id, { ultimoErro: `O SoftExpert recusou a devolução: ${resposta.Detail || resposta.Code}` });
  }
  const depois = await situacaoNaOrigem(empresaId, fonte.id, exec.numeroChamado);
  if (depois?.ativas.has(ATIVIDADE_CLIENTE)) {
    _evento(exec, 'devolucao', 'ok', 'Chamado devolvido ao cliente — agora em Retorno do Usuário', { ...movimento, resposta: _respostaSe(resposta) });
    return repo.atualizar(exec.id, { estado: 'devolvido', devolvidoEm: new Date().toISOString(), ultimoErro: null, alerta: false });
  }
  const ultimoErro = `A devolução foi aceita, mas o chamado está em ${[...(depois?.ativas || [])].join(', ') || 'etapa desconhecida'}, não em ${ATIVIDADE_CLIENTE}.`;
  _evento(exec, 'devolucao', 'erro', ultimoErro, { ...movimento, resposta: _respostaSe(resposta) });
  return repo.atualizar(exec.id, { estado: 'publicado', alerta: true, ultimoErro });
}

const NOMES_ATIVIDADE = { 'ATV-02': 'Primeiro Atendimento', [ATIVIDADE_CLIENTE]: 'Retorno do Usuário' };

/**
 * Última atividade do fluxo de auditoria: onde o chamado ficou no SoftExpert
 * depois da Jade. Respondido = segue no Primeiro Atendimento para a triagem;
 * devolvido = avançou para o Retorno do Usuário. Só registra, nunca falha.
 */
async function _registrarSituacaoFinal(cfg, fonte, exec) {
  try {
    const s = await situacaoNaOrigem(cfg.empresaId, fonte.id, exec.numeroChamado);
    if (!s) return _evento(exec, 'situacao', 'erro', 'O chamado não foi encontrado no SoftExpert na conferência final.');
    const ativas = [...s.ativas];
    const esperada = exec.estado === 'devolvido' ? ATIVIDADE_CLIENTE : 'ATV-02';
    const nome = (id) => `${id}${NOMES_ATIVIDADE[id] ? ` ${NOMES_ATIVIDADE[id]}` : ''}`;
    const onde = ativas.length ? ativas.map(nome).join(', ') : (s.aberto ? 'nenhuma atividade ativa' : 'chamado encerrado');
    const chegou = s.ativas.has(esperada);
    _evento(exec, 'situacao', chegou ? 'ok' : exec.estado === 'devolvido' ? 'erro' : 'aviso',
      chegou
        ? (exec.estado === 'devolvido' ? `Avançou no SoftExpert: chamado em ${nome(esperada)}, aguardando o cliente.` : `Chamado segue em ${nome(esperada)}, aguardando a triagem.`)
        : `Chamado está em ${onde}; o esperado era ${nome(esperada)}.`,
      {
        atividadeAtual: onde, atividadeEsperada: nome(esperada),
        posicionamentoJade: s.posicionamentosJade > 0 ? `encontrado na grade (${s.posicionamentosJade})` : 'não encontrado na grade',
        responsavel: s.comResponsavel ? 'definido' : 'sem responsável',
      });
  } catch (err) {
    _evento(exec, 'situacao', 'erro', `Não foi possível conferir a atividade atual no SoftExpert: ${err.message}`, { erroTecnico: _erroTecnico(err, { operacao: 'consulta SQL (Agente Local)' }) });
  }
}

async function enviarExecucao(cfg, fonte, exec) {
  try {
    const atual = exec.estado === 'devolvendo' ? exec : await _publicar(cfg, fonte, exec);
    const final = atual?.estado === 'devolvendo' ? await _devolver(cfg, fonte, repo.getExecucao(exec.id)) : atual;
    if (final && ['publicado', 'devolvido'].includes(final.estado)) await _registrarSituacaoFinal(cfg, fonte, final);
    return final;
  } catch (err) {
    // Falha antes de falar com o SoftExpert (consulta, usuário, contrato): não conta tentativa, mas avisa.
    console.error(`[IA Service] Jade PA: envio do chamado ${exec.numeroChamado}:`, err.message);
    _evento(exec, repo.getExecucao(exec.id)?.estado === 'devolvendo' ? 'devolucao' : 'envio', 'erro',
      `Não foi possível falar com o SoftExpert: ${err.message} (não conta como tentativa).`, { erroTecnico: _erroTecnico(err) });
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

async function _rodarCiclo(empresaId, fonteId, origem = 'agendado') {
  let loteId = null;
  try { loteId = repo.criarLote(empresaId, fonteId, origem); } catch (err) { console.error('[IA Service] Jade PA: lote não criado:', err.message); }
  return _loteAtual.run({ loteId }, () => _executarLote(empresaId, fonteId, loteId, origem));
}

async function _executarLote(empresaId, fonteId, loteId, origem) {
  const resumo = { loteId, origem, inicio: new Date().toISOString(), elegiveis: 0, novos: 0, limiteAtingido: false, processados: [], erros: [] };
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
      const id = repo.registrarDetectado(empresaId, fonteId, numero);
      if (id) {
        resumo.novos++;
        usadosHoje++;
        _evento({ id, empresaId, numeroChamado: numero }, 'deteccao', 'ok',
          'Detectado no SoftExpert: Primeiro Atendimento, sem responsável e sem posicionamento.');
      }
    }
    // Desligado no meio do ciclo: para antes do próximo chamado.
    // Na leitura avulsa (Executar agora) o job pode estar parado de propósito.
    const aindaLigada = () => origem === 'manual' || repo.getConfig(empresaId, fonteId).ativo;
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
    if (loteId) {
      try { resumo.loteGravado = repo.finalizarLote(loteId, resumo, { manter: origem === 'manual' }); } catch (err) { console.error('[IA Service] Jade PA: lote não finalizado:', err.message); }
    }
    repo.liberarCiclo(empresaId, fonteId, resumo, { avulsa: origem === 'manual' });
  }
  // Aviso por WhatsApp depois de fechar a leitura: nunca atrasa nem derruba o lote.
  resumo.avisos = await avisoService.avisarLote(empresaId, fonteId, { loteId: resumo.loteGravado ? loteId : null });
  try {
    repo.anexarAvisosAoResumo(empresaId, fonteId, resumo.loteGravado ? loteId : null, resumo.avisos);
  } catch (err) {
    console.error('[IA Service] Jade PA: resultado do aviso não gravado no lote:', err.message);
  }
  return resumo;
}

/** Leitura do job (agendador). `forcar` ignora a contagem; a leitura avulsa do botão é executarAgora. */
async function executarCiclo(empresaId, fonteId, { forcar = false } = {}) {
  if (!repo.tentarTravarCiclo(empresaId, fonteId, { travaMs: TRAVA_MS, forcar })) return null;
  return _rodarCiclo(empresaId, fonteId, 'agendado');
}

/**
 * Botão "Executar agora": UMA leitura imediata, com o job iniciado ou parado,
 * sem mexer na contagem do job. Não espera terminar; devolve o lote para a
 * tela acompanhar.
 */
function executarAgora(empresaId, fonteId) {
  const cfg = repo.getConfig(empresaId, fonteId);
  if (!cfg.atualizadoEm) throw _erro(409, 'Salve a configuração da Jade antes de executar.');
  if (!repo.tentarTravarCiclo(empresaId, fonteId, { travaMs: TRAVA_MS, avulsa: true })) throw _erro(409, 'Já existe uma leitura da Jade em execução.');
  _rodarCiclo(empresaId, fonteId, 'manual').catch(() => {});
  return { iniciado: true, loteId: repo.loteEmAndamento(empresaId, fonteId)?.id ?? null };
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

/** Tela: grupos de WhatsApp do IA Command que podem receber os avisos. */
function listarGruposAviso(empresaId, fonteId) {
  _fonteSoftExpert(empresaId, fonteId);
  return avisoService.listarGrupos(empresaId).catch((err) => { throw _erro(502, `Não foi possível ler os grupos do IA Command: ${err.message}`); });
}

function listarExecucoes(empresaId, opts) {
  return repo.listarExecucoes(empresaId, opts);
}

/** Tela: configuração, contador (horário do servidor), lote em andamento e lotes com seus chamados. */
function getPainel(empresaId, fonteId) {
  _fonteSoftExpert(empresaId, fonteId);
  return {
    config: repo.getConfig(empresaId, fonteId),
    agora: new Date().toISOString(),
    loteEmAndamento: repo.loteEmAndamento(empresaId, fonteId),
    lotes: repo.listarLotes(empresaId, fonteId),
    semLote: repo.listarExecucoesSemLote(empresaId, fonteId),
  };
}

/**
 * Botão "Limpar logs": apaga lotes e auditoria do IA Service (período ou tudo).
 * Nunca toca no SoftExpert e nunca apaga o registro que impede a Jade de agir
 * de novo no mesmo chamado. Bloqueado durante uma leitura.
 */
function limparLogs(empresaId, fonteId, { de = null, ate = null, tudo = false } = {}) {
  _fonteSoftExpert(empresaId, fonteId);
  if (repo.loteEmAndamento(empresaId, fonteId)) throw _erro(409, 'Há uma leitura da Jade em execução. Aguarde terminar para limpar os logs.');
  if (tudo) return repo.limparLogs(empresaId, fonteId);
  const deMs = Date.parse(de);
  const ateMs = Date.parse(ate);
  if (!Number.isFinite(deMs) || !Number.isFinite(ateMs)) throw _erro(400, 'Período inválido: informe a data inicial e a final.');
  if (deMs > ateMs) throw _erro(400, 'Período inválido: a data inicial é maior que a final.');
  return repo.limparLogs(empresaId, fonteId, { deIso: new Date(deMs).toISOString(), ateIso: new Date(ateMs).toISOString() });
}

/** Execução + trilha de auditoria (fluxo do chamado na tela). */
function getAuditoria(empresaId, fonteId, execucaoId) {
  _fonteSoftExpert(empresaId, fonteId);
  const execucao = repo.getExecucao(execucaoId);
  if (!execucao || execucao.empresaId !== Number(empresaId) || execucao.fonteId !== fonteId) throw _erro(404, 'Registro da Jade não encontrado.');
  return { execucao, eventos: repo.listarEventos(empresaId, execucaoId) };
}

// Sistema multiempresa (~20 empresas ao mesmo tempo, pedido do usuário,
// 2026-11-20): cada empresa roda no seu tempo, sem esperar o lote (nem o aviso
// por WhatsApp) da outra. O conjunto só evita disparar de novo a mesma fonte
// neste processo; entre processos quem garante é a trava no banco.
const _ciclosEmAndamento = new Set();
function _tick() {
  let configs;
  try {
    configs = repo.listarConfigsAtivas();
  } catch (err) {
    console.error('[IA Service] Jade PA: leitura do agendamento falhou:', err.message);
    return [];
  }
  const disparados = [];
  for (const cfg of configs) {
    const chave = `${cfg.empresaId}:${cfg.fonteId}`;
    if (_ciclosEmAndamento.has(chave)) continue;
    _ciclosEmAndamento.add(chave);
    disparados.push(Promise.resolve()
      .then(() => executarCiclo(cfg.empresaId, cfg.fonteId))
      .catch(err => console.error(`[IA Service] Jade PA: falha no agendamento (empresa ${cfg.empresaId}):`, err.message))
      .finally(() => _ciclosEmAndamento.delete(chave)));
  }
  return disparados;
}

function iniciarAgendamento() {
  setTimeout(() => {
    _tick();
    setInterval(_tick, TICK_MS).unref?.();
  }, PRIMEIRA_EXECUCAO_MS).unref?.();
}

module.exports = {
  iniciarAgendamento, executarCiclo, executarAgora, processarExecucao, gerarTextoCliente, verificarVazamento,
  normalizarTextoSoftExpert, montarAtributosPosicionamento, fontesDaAnalise, enviarExecucao, situacaoNaOrigem, nomesDeOutrosClientes,
  listarElegiveisNaOrigem, getConfig, salvarConfig, listarGruposAviso, listarExecucoes, getAuditoria, getPainel, limparLogs, SQL_ELEGIVEIS, MAX_TENTATIVAS,
  _test: { tick: _tick },
};
