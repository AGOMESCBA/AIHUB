// Jaade no Primeiro Atendimento (pedido do usuário, 2026-11-19).
//
// A cada intervalo configurado, lê no SoftExpert os chamados parados na etapa
// "Aguardar Retorno JAADE" (antes do Primeiro Atendimento) que ainda não tiveram triagem — sem
// responsável (DYNITSM.RESPONSAVEL) e sem nenhum posicionamento na grade — e,
// para cada um, uma única vez:
//   1. importa o chamado e copia os anexos (mesmo caminho do Radar);
//   2. faz a análise técnica no chat da J2iA (fica para o consultor);
//   3. escreve o texto ao cliente a partir dela: orientação (responder →
//      IA-RESPONDIDO) ou pedido de evidências (devolver → IA-INFORMACAO).
// Fase 1: nada é enviado ao SoftExpert — o resultado fica em "simulado".
const { AsyncLocalStorage } = require('async_hooks');
const { randomUUID } = require('crypto');
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
const { _trechoValido } = require('./base-conhecimento-avaliacao-service');
const { redigirTexto } = require('./redaction-service');
const avisoService = require('./jade-pa-aviso-service');
const jobsModo = require('../../../../modules/jobs/modo');
const jobsRepo = require('../../../../modules/jobs/repositorio');

// Curto para a leitura começar perto da hora do contador da tela (a consulta é só ao banco local).
const TICK_MS = 15 * 1000;
const PRIMEIRA_EXECUCAO_MS = 90 * 1000;
// O ciclo trata todos os elegíveis (pedido do usuário, 2026-11-19) e renova a
// trava a cada chamado; trava vencida (sem renovação há 20 min) é de um processo
// que caiu e é retomada.
const TRAVA_MS = 20 * 60 * 1000;
// Teto de uma leitura (igual ao timeoutMs do job no serviço de jobs).
const MAX_LEITURA_MS = 2 * 60 * 60 * 1000;
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

// Etapa do ITSM-02 onde o chamado espera a Jaade, antes do Primeiro Atendimento
// (ajuste do processo no SoftExpert, 2026-11-24; antes era a ATV-02). O código
// da etapa no WFSTRUCT é o próprio nome.
const ATIVIDADE_JADE = 'Aguardar Retorno JAADE';

// Mesma regra de status da view ITSM_CHAMADOS: RESPONSAVEL IS NULL = "Pendente".
const SQL_ELEGIVEIS = `
  SELECT TOP ${MAX_ELEGIVEIS} W.IDPROCESS AS NUM, MIN(S.DHENABLED) AS ENTROU_PA
  FROM WFPROCESS W
  INNER JOIN WFSTRUCT S ON S.IDPROCESS = W.IDOBJECT AND S.IDSTRUCT = '${ATIVIDADE_JADE}' AND S.FGSTATUS = 2
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
// posicionamentos (os da Jaade são marcados no TEXTO4: o status da decisão,
// IA-RESPONDIDO/IA-INFORMACAO, ou 'IA SERVICE' dos registros anteriores a ele).
// Posicionamento pelo vínculo com o chamado (FK) ou pela coluna CHAMADO —
// não está comprovado que a inclusão pela API preenche CHAMADO.
const DO_CHAMADO = `(G.CHAMADO = W.IDPROCESS OR G.OIDABCA7HP6S55J0LV IN (SELECT D3.OID FROM DYNITSM D3 WHERE D3.IDPROCESS = W.IDPROCESS))`;
const MARCAS_JADE_SQL = `('IA SERVICE', 'IA-RESPONDIDO', 'IA-INFORMACAO')`;
const SQL_SITUACAO = `
  SELECT W.FGSTATUS AS PROC_STATUS,
    (SELECT COUNT(*) FROM DYNITSM D WHERE D.IDPROCESS = W.IDPROCESS AND D.RESPONSAVEL IS NOT NULL) AS COM_RESP,
    (SELECT COUNT(*) FROM DYNITSMGRIDREGISTR G WHERE ${DO_CHAMADO} AND G.TEXTO4 IN ${MARCAS_JADE_SQL}) AS POS_JADE,
    (SELECT COUNT(*) FROM DYNITSMGRIDREGISTR G WHERE ${DO_CHAMADO} AND (G.TEXTO4 IS NULL OR G.TEXTO4 NOT IN ${MARCAS_JADE_SQL})) AS POS_OUTROS,
    (SELECT TOP 1 D.DP FROM DYNITSM D WHERE D.IDPROCESS = W.IDPROCESS) AS CAB_EMPRESA,
    (SELECT TOP 1 D.NMSOLICITANTE FROM DYNITSM D WHERE D.IDPROCESS = W.IDPROCESS) AS CAB_COLABORADOR,
    (SELECT TOP 1 D.TEXTO31 FROM DYNITSM D WHERE D.IDPROCESS = W.IDPROCESS) AS CAB_ASSUNTO,
    (SELECT TOP 1 D.EMAIL FROM DYNITSM D WHERE D.IDPROCESS = W.IDPROCESS) AS CAB_EMAIL,
    (SELECT TOP 1 D.TEXTO32 FROM DYNITSM D WHERE D.IDPROCESS = W.IDPROCESS) AS CAB_EMAIL_COPIA,
    S.IDSTRUCT AS ATIVA
  FROM WFPROCESS W
  LEFT JOIN WFSTRUCT S ON S.IDPROCESS = W.IDOBJECT AND S.FGSTATUS = 2
  WHERE W.IDPROCESS = @numero
`;

const SQL_USUARIO_JADE = 'SELECT CDUSER, NMUSER, IDUSER, FGUSERENABLED FROM ADUSER WHERE CDUSER = @cdUser';

// Instância do workflow da Jaade (ITSM-02-I.A-P.A) já aberta para o chamado,
// achada pelo título — é o que impede abrir duas (e mandar dois e-mails) quando
// a resposta do SoftExpert se perde. Apenas status 3 comprova execução.
const SQL_WORKFLOW_JADE = `
  SELECT TOP 1 W.IDPROCESS,
    (SELECT COUNT(*) FROM WFSTRUCT S WHERE S.IDPROCESS = W.IDOBJECT AND S.IDSTRUCT = @atividade AND S.FGSTATUS = 2) AS ATV01_ATIVA,
    (SELECT COUNT(*) FROM WFSTRUCT S WHERE S.IDPROCESS = W.IDOBJECT AND S.IDSTRUCT = @atividade AND S.FGSTATUS = 3) AS ATV01_EXECUTADA
  FROM WFPROCESS W
  INNER JOIN PMACTIVITY P ON P.CDACTIVITY = W.CDPROCESSMODEL AND P.IDACTIVITY = @processo
  WHERE W.NMPROCESS = @titulo
  ORDER BY W.DTSTART DESC, W.TMSTART DESC
`;

// TEXTO4 da grade = decisor do workflow da Jaade no SoftExpert (pedido do usuário, 2026-11-23).
const STATUS_DECISAO = { responder: 'IA-RESPONDIDO', devolver: 'IA-INFORMACAO' };
// O momento da gravação na grade (fixo por execução) no título separa os
// workflows de processamentos diferentes do mesmo chamado (ex.: reprocessado
// depois de "Limpar log"): sem ele, a busca achava o workflow antigo já
// executado e o cliente ficava sem o e-mail novo (teste real 037068, 2026-11-23).
function tituloWorkflowJade(exec) {
  const d = new Date(exec.publicadoEm);
  const p2 = (n) => String(n).padStart(2, '0');
  const quando = Number.isNaN(d.getTime()) ? `ref. ${String(exec.id).slice(0, 8)}`
    : `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  return `Jaade - PA do chamado ${exec.numeroChamado} - ${quando}`;
}

const TEXTO_ANALISE_PA = 'Este chamado acabou de ser aberto pelo cliente e está no Primeiro Atendimento (triagem), sem nenhum posicionamento ainda. Faça uma pré-análise inicial com base no texto do chamado e nos anexos sincronizados, quando existirem: identifique o problema relatado, hipóteses prováveis de causa, possíveis soluções que o próprio cliente consiga testar e quais informações ou evidências ainda faltam para avançar. Deixe claro no nível de confiança que esta é uma análise preliminar, sem confirmação humana.';

const SYSTEM_PROMPT_CLIENTE = `Você é a Jaade, atendente de IA do suporte. Você escreve o PRIMEIRO retorno ao CLIENTE que abriu o chamado, como um analista experiente orientando o cliente a RESOLVER o problema: resposta simples, com conteúdo técnico. O texto vai para o portal do cliente: fale COM ele ("você", "sua equipe", "nos envie", "verifique"), nunca SOBRE ele ("peça ao cliente", "o cliente informou", "do lado do cliente").

Responda SOMENTE com um JSON válido, sem nada antes ou depois:
{"decisao": "responder" | "devolver", "motivo": "frase curta, uso interno, explicando a decisão", "texto": "texto ao cliente"}

Como decidir — a decisão é o tipo de conteúdo do texto e vai ao SoftExpert como status:
- "responder": o texto é uma ORIENTAÇÃO PRELIMINAR (há evidência suficiente para indicar solução ou verificação concreta). Se faltar algo que ajudaria, peça no mesmo texto.
- "devolver": o texto é um PEDIDO DE EVIDÊNCIAS (sem base para indicar solução ou verificação concreta, o centro do texto é pedir ao cliente o que falta).
Seja coerente: decisão e conteúdo nunca divergem.

Escolha pela análise um dos dois tipos de conteúdo:
- ORIENTAÇÃO PRELIMINAR: se existem evidências suficientes para orientar, apresente a possível solução ou verificação, as condições relevantes e como conferir o resultado. Se ainda houver dúvida, apresente-a como hipótese; não prometa que resolverá. Peça somente o que faltar caso os passos não resolvam.
- PEDIDO DE EVIDÊNCIAS: se não há informações suficientes para indicar uma solução ou verificação concreta com segurança, não invente uma causa ou procedimento. Explique brevemente o que falta para avançar e solicite as evidências mínimas e específicas deste chamado, considerando sua descrição, rotina, erro, anexos e o que já foi informado. Explique para que cada pedido servirá. Não peça novamente informação já disponível nem use uma lista genérica igual para todos os casos.
Escolha o conteúdo de acordo com a análise, sem confundir ausência de histórico relacionado com ausência de evidências. Em ambos os casos use a abertura e o encerramento abaixo.

Como escrever — o campo do SoftExpert é TEXTO PURO: nada de markdown (#, **, crases, tabelas):
1. Comece exatamente com: "Olá! Em breve seu chamado será direcionado a um atendente. Enquanto isso, segue abaixo uma análise preliminar feita pela atendente de IA Jaade."
2. Resuma o que o relato e os anexos disponíveis indicam, citando fatos concretos sem afirmar uma causa que não esteja demonstrada.
3. Quando houver base para orientar, priorize passos específicos para resolver ou contornar e explique como verificar o resultado. Quando não houver, priorize o pedido de evidências específico, sem instruções técnicas inventadas.
4. Peça somente o mínimo necessário para avançar; prefira um recorte pequeno e comparável a "envie tudo". Pode fazer uma pergunta direta quando ela acelerar a análise.
5. Ao pedir evidências, explique de forma cordial por que elas são necessárias para este caso.
6. Títulos em MAIÚSCULAS numa linha própria são opcionais: use só se ajudarem a organizar um texto mais longo.
7. Termine com "Ficamos no aguardo do seu retorno." e, na última linha, "Jaade, atendente de IA".

Regras:
- Português do Brasil; tom de analista: cordial, seguro e direto, frases curtas, sem rodeios, sem repetir a mesma ideia e sem jargão interno do suporte.
- Quem lê costuma ser usuário de negócio (financeiro, fiscal, compras), não programador: explique em palavras simples o que for técnico (ex.: "ponto de entrada, que é uma customização feita no sistema"); ao pedir algo técnico (fonte, log, arquivo de integração), diga o que é e quem na equipe dele costuma ter (a TI ou a consultoria responsável pela customização). Mantenha a precisão: nomes de rotinas, campos e mensagens ficam como estão.
- Não invente: use só o que está no chamado, nos anexos e na análise técnica. Não prometa prazo nem solução garantida.
- Não cite outros chamados, protocolos ou atendimentos, mesmo do próprio cliente. Não cite nomes de outros clientes, empresas, pessoas ou dados internos; não mencione "base histórica", fontes internas, nível de confiança, a análise técnica em si nem a classificação interna do chamado (tipo, nível, categoria).
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
  const chamado = chamadoRepo.getChamadoPorNumero(empresaId, String(numero), 'softexpert', { exigirUnico: true });
  if (chamado && chamado.fonteId !== fonteId) throw new Error('Chamado encontrado em outra fonte; não é possível confirmar o atendimento.');
  if (!chamado) throw new Error('Chamado não encontrado na base após a importação.');
  return chamado;
}

// Sempre uma análise nova, com pesquisa na documentação oficial, gravada no
// chat da J2iA. Não reaproveita a que já estiver no chat: ela pode ser antiga
// e sem pesquisa, e o retorno ao cliente sairia sem os links oficiais (caso
// real #037059, 2026-11-20).
async function _obterAnaliseTecnica(empresaId, atendimentoId, anexos, chamadoId) {
  if (!turnoLockService.tentarAdquirir(empresaId, atendimentoId)) {
    throw Object.assign(new Error('O chat deste chamado está em uso; a Jaade tenta de novo no próximo ciclo.'), { adiar: true });
  }
  try {
    const mensagem = await _investigacao().processarTurno(empresaId, atendimentoId, {
      texto: TEXTO_ANALISE_PA, usuarioId: null, anexoIds: anexos.map(a => a.id).filter(Boolean), automatico: true, escopoPrimeiroAtendimento: true, chamadoIdPa: chamadoId,
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
    console.error('[IA Service] Jaade PA: fontes da pesquisa indisponíveis:', err.message);
  }
  return [...fontes.values()].slice(0, MAX_FONTES);
}

// Apenas evidências que realmente entraram no prompt da análise, ainda
// rastreáveis e pertencentes ao cliente confirmado, podem autorizar números.
function referenciasDaAnalise(empresaId, atendimentoId, mensagemId, chamado) {
  try { return _referenciasDaAnalise(empresaId, atendimentoId, mensagemId, chamado); }
  catch (_) { return []; }
}

function _referenciasDaAnalise(empresaId, atendimentoId, mensagemId, chamado) {
  if (!mensagemId || !chamado?.id || !chamadoRepo.identidadeConfirmadaPa(empresaId, chamado.id)) return [];
  const execucao = investigacaoExecucaoRepo.listarPorAtendimento(empresaId, atendimentoId, { limite: 20 }).find(x => x.mensagemId === mensagemId);
  const selecionados = execucao?.manifesto?.pesquisaExterna?.baseConhecimento?.selecionados;
  if (!Array.isArray(selecionados)) return [];
  const candidatos = chamadoRepo.obterCandidatosPorIds(empresaId, chamado.id, selecionados.map(x => x.chamadoId), { escopo: 'cliente_pa' });
  const porId = new Map(candidatos.map(x => [x.chamado.id, x]));
  const referencias = [];
  for (const item of selecionados) {
    const candidato = porId.get(item.chamadoId), a = item.avaliacaoIa;
    if (!candidato || !a || a.relevancia !== 'mesmo_problema' || a.origemAtual?.tipo !== 'chamado') continue;
    const numero = String(candidato.chamado.numero || '');
    if (!/^0\d{5}$/.test(numero) || numero !== String(item.numero)) continue;
    let unico;
    try { unico = chamadoRepo.getChamadoPorNumero(empresaId, numero, 'softexpert', { exigirUnico: true }); } catch (_) { continue; }
    if (!unico || unico.id !== candidato.chamado.id) continue;
    const obterCampo = (origem) => {
      if (origem?.tipo === 'chamado') return candidato.chamado[origem.campo];
      if (origem?.tipo === 'posicionamento') return candidato.posicionamentos.find(p => p.id === origem.id)?.[origem.campo];
      return null;
    };
    if (!_trechoValido(a.trechoAtual, redigirTexto(chamado[a.origemAtual.campo])) || !_trechoValido(a.trechoCandidato, redigirTexto(obterCampo(a.origemCandidato)))) continue;
    referencias.push({ numero, trechoAtual: a.trechoAtual, trechoCandidato: a.trechoCandidato, diferencas: a.diferencas || null, lacunas: a.lacunas || null,
      trechoProcedimento: _trechoValido(a.trechoProcedimento, redigirTexto(obterCampo(a.origemProcedimento))) ? a.trechoProcedimento : null,
      trechoResultado: _trechoValido(a.trechoResultado, redigirTexto(obterCampo(a.origemResultado))) ? a.trechoResultado : null });
  }
  return referencias.slice(0, 5);
}

function _montarEntrada({ chamado, anexos, analise, fontes = [], referencias = [] }) {
  const partes = [`Chamado nº ${chamado.numero}`];
  for (const [rotulo, valor] of [['Título', chamado.titulo], ['Assunto', chamado.assunto], ['Breve descrição', chamado.breveDescricao],
    ['Descrição do cliente', chamado.descricao], ['Informações adicionais', chamado.informacoesAdicionais]]) {
    if (valor && String(valor).trim()) partes.push(`${rotulo}: ${_limitar(valor, 4000)}`);
  }
  partes.push(anexos.length
    ? `Anexos enviados pelo cliente (${anexos.length}): ${anexos.map(a => a.nomeOriginal || a.nome || 'arquivo').join(', ')}`
    : 'Anexos enviados pelo cliente: nenhum.');
  partes.push(`Análise técnica interna (NÃO copie referências, números de chamados ou nomes daqui):\n${_limitar(analise?.conteudo, 8000) || '(indisponível)'}`);
  partes.push(referencias.length ? `Referências autorizadas do próprio cliente (a semelhança é preliminar; apenas estes números podem ser citados):\n${referencias.map(r => `- Chamado ${r.numero}; trecho do problema atual: ${r.trechoAtual}; trecho do histórico: ${r.trechoCandidato}${r.diferencas ? `; possíveis diferenças: ${r.diferencas}` : ''}${r.lacunas ? `; lacunas a verificar: ${r.lacunas}` : ''}${r.trechoProcedimento ? `; possível procedimento: ${r.trechoProcedimento}` : ''}${r.trechoResultado ? `; resultado registrado: ${r.trechoResultado}` : ''}`).join('\n')}` : 'Referências autorizadas do próprio cliente: nenhuma; não cite outros chamados.');
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
function verificarVazamento(texto, numeroProprio, outrosClientes = [], linksPermitidos = [], numerosPermitidos = []) {
  const problemas = [];
  const permitidos = new Set(linksPermitidos);
  for (const m of String(texto).matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, '');
    if (!permitidos.has(url)) problemas.push(`cita link que não veio da pesquisa (${url})`);
  }
  const proprio = String(numeroProprio || '');
  const permitidosChamados = new Set([proprio, ...numerosPermitidos.map(String)]);
  // Normaliza algarismos de largura cheia e remove caracteres invisíveis;
  // também reconhece separadores dentro de números de seis dígitos.
  const verificavel = String(texto || '').normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/[٠-٩۰-۹]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c) >= 0 ? '٠١٢٣٤٥٦٧٨٩'.indexOf(c) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));
  const semUrls = verificavel.replace(/https?:\/\/[^\s<>"]+/gi, ' ');
  const semDatas = semUrls.replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, ' ');
  for (const m of semDatas.matchAll(/(?<![\w\d])0(?:[\s.\-_/]*\d){5}(?!\d)/g)) {
    const numero = m[0].replace(/\D/g, '');
    if (!permitidosChamados.has(numero)) problemas.push(`cita o chamado ${numero}`);
  }
  for (const m of semUrls.matchAll(/\b(?:chamado|ticket|protocolo|atendimento|ocorr[eê]ncia)s?\s*(?:n[º°o.]\s*)?[#:]?\s*(\d{1,10})(?!\d)/gi)) if (!permitidosChamados.has(m[1])) problemas.push(`cita o chamado ${m[1]}`);
  for (const m of semUrls.matchAll(/(?<![\w])#\s*(\d{1,10})(?!\d)/g)) if (!permitidosChamados.has(m[1])) problemas.push(`cita o chamado ${m[1]}`);
  const semAcentos = _semAcento(semUrls);
  if (/\b(?:chamado|ticket|protocolo|atendimento|ocorrencia)s?\s+(?:(?:numero|de numero|nro|num)\s+)?(?:zero|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos|oitocentos|novecentos|mil|milhao|milhoes)\b/i.test(semAcentos)) problemas.push('referência a chamado por extenso não verificável');
  if (/\b(?:outro|outros|outra|outras|anterior|anteriores)\s+(?:chamado|chamados|ticket|tickets|protocolo|protocolos|atendimento|atendimentos)\b|\b(?:chamado|ticket|protocolo|atendimento)\s+(?:anterior|anteriores|passado|passados)\b/i.test(semAcentos)) problemas.push('referência a outro atendimento não permitida');
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

// Ensaio isolado para a futura citação: a IA escolhe marcadores de uma lista
// já validada; só o servidor escreve os números. Não é ligado à publicação.
function simularMontagemReferencias(texto, numeroProprio, referencias, { outrosClientes = [], linksPermitidos = [] } = {}) {
  if (!Array.isArray(referencias) || referencias.length > 5) throw new Error('Lista de referências inválida.');
  const numeros = referencias.map(r => String(r?.numero || ''));
  if (numeros.some(n => !/^0\d{5}$/.test(n)) || new Set(numeros).size !== numeros.length) throw new Error('Referência inválida ou duplicada.');
  const original = String(texto || '');
  const problemas = verificarVazamento(original, numeroProprio, outrosClientes, linksPermitidos);
  if (problemas.length) throw new Error('Resposta contém referência fora dos marcadores autorizados.');
  let restantes = original;
  const saida = original.replace(/\[\[REF_(\d+)\]\]/g, (marcador, indice) => {
    const n = Number(indice);
    if (!Number.isInteger(n) || n < 1 || n > numeros.length || String(n) !== indice) throw new Error('Marcador de referência não autorizado.');
    restantes = restantes.replace(marcador, '');
    return `chamado ${numeros[n - 1]}`;
  });
  if (restantes.includes('[[') || restantes.includes(']]')) throw new Error('Marcador de referência inválido.');
  const errosSaida = verificarVazamento(saida, numeroProprio, outrosClientes, linksPermitidos, numeros);
  if (errosSaida.length) throw new Error('Resposta com referência não autorizada.');
  return normalizarTextoSoftExpert(saida);
}

// A seleção por índices vem da IA; a lista deve ser obtida por
// referenciasDaAnalise, não do modelo. Não ligado à publicação do PA.
const CABECALHO_REFERENCIAS = 'Encontramos outros chamados seus que podem tratar de situações semelhantes. Se quiser, você pode consultá-los pelos números abaixo:';

function simularReferenciasNoRodape(texto, numeroProprio, referencias, indicesSelecionados, { outrosClientes = [], linksPermitidos = [] } = {}) {
  if (!Array.isArray(referencias) || referencias.length > 5 || !Array.isArray(indicesSelecionados)) throw new Error('Seleção de referências inválida.');
  const numeros = referencias.map(r => String(r?.numero || ''));
  if (numeros.some(n => !/^0\d{5}$/.test(n)) || new Set(numeros).size !== numeros.length) throw new Error('Referência inválida ou duplicada.');
  if (indicesSelecionados.some(i => !Number.isInteger(i) || i < 0 || i >= numeros.length) || new Set(indicesSelecionados).size !== indicesSelecionados.length) throw new Error('Seleção de referência não autorizada.');
  const conteudo = String(texto || '').trim();
  if (!conteudo || verificarVazamento(conteudo, numeroProprio, outrosClientes, linksPermitidos).length) throw new Error('Texto contém referência fora da lista controlada.');
  const escolhidos = indicesSelecionados.map(i => numeros[i]);
  const saida = normalizarTextoSoftExpert([conteudo, escolhidos.length ? [CABECALHO_REFERENCIAS, ...escolhidos].join('\n\n') : ''].filter(Boolean).join('\n\n'));
  if (saida.length > MAX_TEXTO_CLIENTE) throw new Error('Retorno inválido após inclusão de referências.');
  return saida;
}

async function gerarTextoCliente(empresaId, dados, { simularReferencias = false, aviso = null } = {}) {
  const { keys, cfg } = aiConfigService.resolverKeysEOrdem(empresaId);
  // A IA seleciona índices; os números são inseridos pelo servidor.
  const numeroAtual = String(dados.chamado.numero || '');
  const analiseSemNumeros = String(dados.analise?.conteudo || '').replace(/(?<!\d)0\d{5}(?!\d)/g, n => n === numeroAtual ? n : '[referência omitida]');
  const dadosSemCitacoes = { ...dados, referencias: [], analise: { ...dados.analise, conteudo: analiseSemNumeros } };
  let entrada = _montarEntrada(dadosSemCitacoes);
  const candidatasSimuladas = simularReferencias && Array.isArray(dados.referencias) ? dados.referencias.slice(0, 5) : [];
  const instrucaoSelecao = candidatasSimuladas.length
    ? '\nInclua no JSON o campo indicesReferencias: lista de índices inteiros das pistas que você considerar úteis, ou [] se nenhuma ajudar. Use somente os índices fornecidos. Não escreva números de chamados no texto.' : '';
  const blocoSelecao = candidatasSimuladas.length
    ? `\n\nPistas para avaliar (relevância preliminar; selecione somente as úteis):\n${candidatasSimuladas.map((r, i) => `Índice ${i}: problema atual: ${r.trechoAtual}; histórico: ${r.trechoCandidato}${r.diferencas ? `; diferenças: ${r.diferencas}` : ''}${r.lacunas ? `; lacunas: ${r.lacunas}` : ''}${r.trechoProcedimento ? `; possível procedimento: ${r.trechoProcedimento}` : ''}${r.trechoResultado ? `; resultado registrado: ${r.trechoResultado}` : ''}`).join('\n')}` : '';
  // Versão anterior com decisão e texto divergentes (conferência de status).
  const blocoAviso = aviso ? `\n\nATENÇÃO: ${aviso}` : '';
  entrada += blocoSelecao + blocoAviso;
  const outrosClientes = nomesDeOutrosClientes(empresaId, dados.chamado.clienteId);
  let ultimoProblema = 'resposta da IA sem o formato esperado';
  // Versões recusadas vão para a auditoria (motivo de cada uma).
  const recusas = [];
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const resultado = await aiProviderClient.chamarIA(keys, cfg, SYSTEM_PROMPT_CLIENTE + instrucaoSelecao, entrada, [], { maxTokens: 2000, timeoutMs: 90000 });
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
    const problemas = [...new Set([...verificarVazamento(json.texto, dados.chamado.numero, outrosClientes, (dados.fontes || []).map(x => x.url)), ...verificarVazamento(texto, dados.chamado.numero, outrosClientes, (dados.fontes || []).map(x => x.url))])];
    if (problemas.length) {
      ultimoProblema = `texto ao cliente ${problemas.join(', ')}`;
      recusas.push(`Versão ${tentativa}: ${ultimoProblema}`);
      entrada = `${_montarEntrada(dadosSemCitacoes)}${blocoSelecao}${blocoAviso}\n\nATENÇÃO: a versão anterior foi recusada porque ${problemas.join(', ')}. Reescreva sem isso.`;
      continue;
    }
    let textoFinal = texto, referenciasSelecionadas = [];
    if (candidatasSimuladas.length) {
      const indices = json.indicesReferencias === undefined ? [] : json.indicesReferencias;
      try {
        textoFinal = simularReferenciasNoRodape(texto, dados.chamado.numero, candidatasSimuladas, indices, { outrosClientes, linksPermitidos: (dados.fontes || []).map(x => x.url) });
        referenciasSelecionadas = indices.map(i => candidatasSimuladas[i].numero);
      } catch (_) { ultimoProblema = 'seleção de referências inválida'; recusas.push(`Versão ${tentativa}: ${ultimoProblema}`); continue; }
    }
    return { decisao: json.decisao, motivo: _limitar(json.motivo, 500), texto: textoFinal, referenciasSelecionadas, provider: resultado.provider, model: resultado.model, recusas };
  }
  throw Object.assign(new Error(`Texto ao cliente recusado: ${ultimoProblema}.`), { recusas });
}

const SYSTEM_PROMPT_STATUS = `Você confere o tipo de um texto de suporte que será enviado a um cliente. Leia SOMENTE o texto e responda SOMENTE com um JSON válido:
{"tipo": "orientacao" | "pedido_evidencias", "motivo": "frase curta citando o trecho que decidiu"}

- "orientacao": o texto indica ao cliente uma solução, um contorno ou uma verificação técnica concreta para resolver ou diagnosticar o problema (rotina, parâmetro, cadastro, configuração, permissão ou passo específico a conferir ou ajustar), mesmo que também peça alguma informação adicional.
- "pedido_evidencias": o texto não traz solução, contorno nem verificação técnica concreta; seu objetivo principal é pedir ao cliente informações, evidências, mensagem de erro, prints, logs, exemplos ou detalhes para o atendimento poder avançar.

Pedir para o cliente observar ou informar algo ("verifique se aparece mensagem de erro", "nos envie o log", "informe se houve alteração recente") é pedido de evidências, não orientação. Hipóteses genéricas sem um passo concreto ("pode ser permissão ou configuração") também não são orientação.`;

/**
 * Conferência independente do status: classifica só o texto final, sem ver a
 * decisão de quem escreveu. Usada para não gravar IA-RESPONDIDO/IA-INFORMACAO
 * errado no SoftExpert.
 */
async function conferirStatus(empresaId, texto) {
  const { keys, cfg } = aiConfigService.resolverKeysEOrdem(empresaId);
  const resultado = await aiProviderClient.chamarIA(keys, cfg, SYSTEM_PROMPT_STATUS, `Texto que será enviado ao cliente:\n"""\n${texto}\n"""`, [], { maxTokens: 300, timeoutMs: 60000 });
  const json = resultado.truncado ? null : _extrairJson(resultado.texto);
  const decisao = { orientacao: 'responder', pedido_evidencias: 'devolver' }[json?.tipo];
  if (!decisao) throw new Error('A conferência do status não respondeu no formato esperado. Nada foi gravado.');
  return { decisao, tipo: json.tipo, motivo: _limitar(json.motivo, 300), modelo: [resultado.provider, resultado.model].filter(Boolean).join(' · ') };
}

// Trilha de auditoria (tela "fluxo" do chamado). Falha ao registrar nunca
// interrompe o trabalho da Jaade.
// Lote da leitura em curso: chega a cada registro sem passar por todas as funções.
const _loteAtual = new AsyncLocalStorage();

// Perda da trava não é falha do SoftExpert: nada foi enviado, não conta
// tentativa e o chamado fica para a leitura que tem a trava. Os catch das
// chamadas SOAP repassam este erro em vez de tratá-lo como envio incerto.
class ErroPosse extends Error {}

function _verificarPosse() {
  const c = _loteAtual.getStore();
  if (c && !repo.renovarTrava(c.empresaId, c.fonteId, TRAVA_MS, c.dono)) {
    throw new ErroPosse('A leitura perdeu a posse da trava da Jaade; outra leitura segue com este chamado.');
  }
}

function _evento(exec, etapa, situacao, resumo, detalhes = null) {
  try {
    repo.registrarEvento(exec.id, exec.empresaId, { etapa, situacao, resumo, detalhes, loteId: _loteAtual.getStore()?.loteId ?? null });
  } catch (err) {
    console.error(`[IA Service] Jaade PA: auditoria do chamado ${exec.numeroChamado || exec.id}:`, err.message);
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
    _evento(exec, etapa, 'aviso', 'Descartado: a triagem atuou no chamado antes da Jaade (responsável definido ou posicionamento registrado).');
    return repo.atualizar(exec.id, {
      estado: 'descartado', motivo: 'A triagem atuou no chamado antes da Jaade (responsável definido ou posicionamento registrado).',
      motivoCodigo: 'triagem_atuou',
    });
  };
  try {
    if (!(await _aindaElegivel(empresaId, fonte.id, exec.numeroChamado))) return descartar();
    _evento(exec, 'deteccao', 'info', `${rotuloTentativa}: conferido no SoftExpert — segue em "${ATIVIDADE_JADE}", sem responsável e sem posicionamento.`);
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
      console.error(`[IA Service] Jaade PA: cópia de anexos falhou (chamado ${chamado.numero}):`, err.message);
    });
    const anexos = anexoRepo.listarAnexos(empresaId, atendimento.id);
    const arquivos = anexos.map(a => a.nomeOriginal || a.nome || 'arquivo');
    _evento(exec, 'anexos', falhaAnexos ? 'aviso' : 'ok',
      falhaAnexos ? `A cópia dos anexos falhou; a análise segue com ${anexos.length} arquivo(s): ${falhaAnexos}`
        : anexos.length ? `${anexos.length} anexo(s) entregue(s) à IA` : 'O chamado não tem anexos',
      arquivos.length ? { arquivos } : null);
    etapa = 'analise';
    const inicioAnalise = Date.now();
    const analise = await _obterAnaliseTecnica(empresaId, atendimento.id, anexos, chamado.id);
    const fontes = fontesDaAnalise(empresaId, atendimento.id, analise.id);
    _evento(exec, 'analise', 'ok',
      `Análise técnica com pesquisa feita em ${Math.round((Date.now() - inicioAnalise) / 1000)} s e gravada no chat da J2iA — ${fontes.length ? `${fontes.length} página(s) oficial(is) lida(s)` : 'nenhuma página oficial lida'}`,
    { analise: _limitar(analise.conteudo, 8000), fontesOficiais: fontes.length ? fontes.map(x => `${x.titulo} — ${x.url}`) : undefined });
    etapa = 'retorno';
    // Suspensão deliberada em todos os modos, inclusive na simulação do ciclo.
    // Ensaios da montagem usam somente dados fictícios e não passam por aqui.
    const referencias = [];
    // O status (IA-RESPONDIDO/IA-INFORMACAO) decide o caminho no SoftExpert e não
    // pode sair errado: uma segunda leitura, independente, classifica só o texto
    // final. Divergiu: reescreve só o texto uma vez (a análise é mantida); divergiu
    // de novo, nada é gravado e a tentativa conta (3 = alerta para a triagem).
    const nome = (d) => (d === 'devolver' ? 'pedido de evidências' : 'orientação');
    let gerado, conferencia, aviso = null;
    const divergencias = [];
    for (let versao = 1; versao <= 2; versao++) {
      gerado = await gerarTextoCliente(empresaId, { chamado, anexos, analise, fontes, referencias }, { aviso });
      conferencia = await conferirStatus(empresaId, gerado.texto);
      if (conferencia.decisao === gerado.decisao) break;
      divergencias.push(`Versão ${versao}: escrita como ${nome(gerado.decisao)}, lida como ${nome(conferencia.decisao)} (${conferencia.motivo})`);
      aviso = `a versão anterior foi marcada como "${gerado.decisao}", mas o texto foi lido como ${nome(conferencia.decisao)}. Escolha o tipo de conteúdo pela análise e mantenha decisão e texto coerentes.`;
    }
    if (conferencia.decisao !== gerado.decisao) {
      throw Object.assign(new Error(`Status não confirmado: decisão e texto divergiram nas 2 versões (${divergencias.at(-1)}). Nada foi gravado.`),
        { recusas: [...gerado.recusas, ...divergencias] });
    }
    const recusas = [...gerado.recusas, ...divergencias];
    // "Pedido de informação" desligado na tela: o pedido vai com o status IA-RESPONDIDO.
    const devolver = gerado.decisao === 'devolver' && cfg.devolucaoAtiva;
    const motivo = gerado.decisao === 'devolver' && !cfg.devolucaoAtiva ? `${gerado.motivo} (pedido de informação desligado: vai como IA-RESPONDIDO)` : gerado.motivo;
    _evento(exec, 'retorno', recusas.length ? 'aviso' : 'ok',
      `Retorno ao cliente escrito — status: ${devolver ? 'pedido de informação (IA-INFORMACAO)' : 'respondido (IA-RESPONDIDO)'}, conferido${recusas.length ? ` (${recusas.length} versão(ões) recusada(s) antes)` : ''}`,
      { decisao: devolver ? 'Pedido de informação (IA-INFORMACAO)' : 'Respondido (IA-RESPONDIDO)', motivo, conferenciaStatus: `${conferencia.tipo} — ${conferencia.motivo} (${conferencia.modelo})`, referenciasAutorizadas: referencias.map(r => r.numero), referenciasSelecionadas: gerado.referenciasSelecionadas, modelo: [gerado.provider, gerado.model].filter(Boolean).join(' · '),
        recusas: recusas.length ? recusas : undefined, texto: gerado.texto });
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
    console.error(`[IA Service] Jaade PA: chamado ${exec.numeroChamado}, tentativa ${tentativa}:`, err.message);
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
    cabecalho: { empresa: r.CAB_EMPRESA ?? null, colaborador: r.CAB_COLABORADOR ?? null, assunto: r.CAB_ASSUNTO ?? null, email: r.CAB_EMAIL ?? null, emailCopia: r.CAB_EMAIL_COPIA ?? null },
  };
}

function _triagemAtuou(s) {
  return !s || !s.aberto || !s.ativas.has(ATIVIDADE_JADE) || s.comResponsavel || s.posicionamentosOutros > 0;
}

async function _usuarioJade(empresaId, fonteId, cdUser) {
  if (!cdUser) throw new Error('Informe o código do usuário da Jaade no SoftExpert.');
  const [u] = await agenteLocalService.executarSelectNaFonte(empresaId, fonteId, { sql: SQL_USUARIO_JADE, params: { cdUser: String(cdUser) }, limit: 2 });
  if (!u) throw new Error(`Usuário ${cdUser} não encontrado no SoftExpert.`);
  if (String(u.FGUSERENABLED) !== '1') throw new Error(`Usuário ${cdUser} está desabilitado no SoftExpert.`);
  if (!String(u.NMUSER || '').trim() || !String(u.IDUSER || '').trim()) throw new Error(`Usuário ${cdUser} sem nome ou matrícula no SoftExpert.`);
  return { codigo: String(u.CDUSER), nome: String(u.NMUSER).trim(), matricula: String(u.IDUSER).trim() };
}

// Mesmo contrato de escrita dos analistas: a Jaade precisa estar autorizada
// em autoria.analistas do arquivo SVC_SOFTEXPERT_RETORNO_CONFIG.
function _contratoEscrita(empresaId, fonteId, cdUser) {
  const config = retornoConfig.resolver({ empresaId, fonteId, consultor: { idSoftexpert: String(cdUser) } });
  if (!config.disponivel) throw new Error(`Escrita no SoftExpert indisponível para a Jaade (usuário ${cdUser}): ${config.motivo}`);
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

/**
 * Atributos da grade: os campos fechados com o usuário (2026-11-19) e zero horas
 * apontadas. Os mesmos vão ao formulário do workflow da Jaade (DYNITSM02IAPA).
 */
function montarAtributosPosicionamento({ contrato, chamado, jade, texto, decisao, cabecalho = {}, instante = new Date() }) {
  if (!STATUS_DECISAO[decisao]) throw new Error('Decisão da Jaade ausente: sem ela o SoftExpert não sabe o caminho do chamado.');
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
  atributos.texto4 = STATUS_DECISAO[decisao];
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
    _evento(exec, 'envio', 'ok', 'Conferido no SoftExpert: o posicionamento da Jaade está na grade do chamado.');
    // Próximo passo: o workflow da Jaade (abre ou continua de onde parou).
    return repo.atualizar(exec.id, { estado: 'devolvendo', publicadoEm: exec.publicadoEm || new Date().toISOString(), ultimoErro: null, alerta: false });
  }
  if (exec.tentativasPublicacao >= MAX_TENTATIVAS) return _falhaDefinitiva(exec, 'O SoftExpert não confirmou o posicionamento após 3 tentativas.', 'envio');
  if (_triagemAtuou(s)) {
    _evento(exec, 'envio', 'aviso', 'Descartado: a triagem atuou no chamado antes do envio da Jaade. Nada foi gravado.');
    return repo.atualizar(exec.id, { estado: 'descartado', motivo: 'A triagem atuou no chamado antes do envio da Jaade.', motivoCodigo: 'triagem_atuou', alerta: false });
  }
  if (exec.estado === 'pronto' && Date.now() - Date.parse(exec.geradoEm || 0) > MAX_IDADE_ENVIO_MS) {
    _evento(exec, 'envio', 'aviso', 'Descartado: texto gerado há mais de 4 horas, não enviado para não chegar desatualizado ao cliente.');
    return repo.atualizar(exec.id, { estado: 'descartado', motivo: 'Texto gerado há mais de 4 horas; não foi enviado para não chegar desatualizado ao cliente.', motivoCodigo: 'texto_vencido', alerta: false });
  }
  const tentativaEnvio = `Tentativa ${exec.tentativasPublicacao + 1}/${MAX_TENTATIVAS}`;
  const chamado = chamadoRepo.getChamadoPorNumero(empresaId, exec.numeroChamado, 'softexpert', { exigirUnico: true });
  if (!chamado) throw new Error('Chamado não encontrado na base local.');
  if (chamado.fonteId !== fonte.id || (exec.chamadoId && chamado.id !== exec.chamadoId)) return _falhaDefinitiva(exec, 'A identidade do chamado mudou antes do envio.', 'envio');
  const fontes = fontesDaAnalise(empresaId, exec.atendimentoId, exec.mensagemAnaliseId);
  const textoCliente = String(exec.textoCliente || '');
  // Retornos anteriormente enfileirados com qualquer bloco de referências
  // devem ser bloqueados também quando o número antes estava autorizado.
  if (textoCliente.includes(CABECALHO_REFERENCIAS) || /referências para consulta:/i.test(textoCliente)) return _falhaDefinitiva(exec, 'Citação automática de histórico suspensa.', 'envio');
  const problemas = verificarVazamento(textoCliente, chamado.numero, nomesDeOutrosClientes(empresaId, chamado.clienteId), fontes.map(f => f.url));
  if (problemas.length) return _falhaDefinitiva(exec, 'O retorno contém referência não autorizada ou não verificável.', 'envio');
  const jade = await _usuarioJade(empresaId, fonte.id, cfg.usuarioSoftexpert);
  const config = _contratoEscrita(empresaId, fonte.id, jade.codigo);
  const atributos = montarAtributosPosicionamento({ contrato: config.contrato, chamado, jade, texto: exec.textoCliente, decisao: exec.decisao, cabecalho: s?.cabecalho });
  const xml = soapClient.montarInclusaoGrid({ workflowId: exec.numeroChamado, mainEntityId: config.contrato.mainEntityId, childRelationshipId: config.contrato.childRelationshipId, campos: atributos });
  _verificarPosse();
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
  return repo.atualizar(exec.id, { estado: 'devolvendo', publicadoEm: new Date().toISOString(), ultimoErro: null, alerta: false });
}

/**
 * Workflow da Jaade (2026-11-23): o ITSM-02 recusa executeActivity pela API
 * (regra "Antes de salvar" do formulário, erro -20). Depois da grade, a Jaade
 * abre uma instância do ITSM-02-I.A-P.A com o mesmo registro (TEXTO4 = decisão)
 * e executa a ATV-01; o SoftExpert lê o TEXTO4, move o chamado original
 * (atendimento ou cliente) e manda os e-mails. Retomável: a instância é achada
 * pelo título antes de abrir outra e a ATV-01 só é executada se ainda estiver
 * ativa — repetir abriria outro workflow e mandaria o e-mail duas vezes.
 */
async function _encaminhar(cfg, fonte, exec) {
  const { empresaId } = cfg;
  const { processId, activityId, actionSequence } = soapClient.WORKFLOW_JADE;
  const titulo = tituloWorkflowJade(exec);
  const concluir = (workflowId, resumo, detalhes = {}) => {
    _evento(exec, 'workflow', 'ok', resumo, { workflow: workflowId, ...detalhes });
    return repo.atualizar(exec.id, { estado: 'devolvido', devolvidoEm: new Date().toISOString(), ultimoErro: null, alerta: false });
  };
  const [existente] = await agenteLocalService.executarSelectNaFonte(empresaId, fonte.id, {
    sql: SQL_WORKFLOW_JADE, params: { processo: processId, atividade: activityId, titulo }, limit: 1,
  });
  let workflowId = existente ? String(existente.IDPROCESS) : null;
  if (existente && Number(existente.ATV01_EXECUTADA) > 0 && Number(existente.ATV01_ATIVA) === 0) {
    return concluir(workflowId, `Conferido no SoftExpert: o workflow da Jaade ${workflowId} já foi executado.`);
  }
  // Sem o SoftExpert confirmar em 4 h da gravação na grade, não aciona mais: o
  // cliente receberia um retorno desatualizado (vale também para as execuções
  // que ficaram em "devolvendo" no fluxo antigo da ação 1).
  if (exec.publicadoEm && Date.now() - Date.parse(exec.publicadoEm) > MAX_IDADE_ENVIO_MS) {
    return _falhaDefinitiva(exec, `O workflow da Jaade não foi confirmado em até 4 horas da gravação na grade${workflowId ? ` (instância ${workflowId})` : ''}; não é mais acionado, para o cliente não receber retorno desatualizado.`, 'workflow');
  }
  if (existente && Number(existente.ATV01_ATIVA) < 1) {
    const espera = `Workflow da Jaade ${workflowId} aberto, mas a ${activityId} ainda não está ativa nem executada; conferido de novo no próximo ciclo (até 4 horas da gravação).`;
    // Registra uma vez só, não a cada ciclo de espera.
    if (exec.ultimoErro !== espera) _evento(exec, 'workflow', 'aviso', espera);
    return repo.atualizar(exec.id, { ultimoErro: espera, alerta: true });
  }
  let s = null;
  if (!workflowId) {
    s = await situacaoNaOrigem(empresaId, fonte.id, exec.numeroChamado);
    if (!s || !s.aberto || s.comResponsavel || s.posicionamentosOutros > 0) {
      _evento(exec, 'workflow', 'aviso', 'Workflow da Jaade não aberto: a triagem atuou no chamado depois da gravação na grade. O retorno fica na grade.');
      return repo.atualizar(exec.id, { estado: 'publicado', alerta: false });
    }
  }
  if (exec.tentativasDevolucao >= MAX_TENTATIVAS) {
    return _falhaDefinitiva(exec, 'O SoftExpert não confirmou o workflow da Jaade após 3 tentativas; o retorno está na grade, mas o SoftExpert não foi acionado (sem e-mail ao cliente).', 'workflow');
  }
  const tentativa = `Tentativa ${exec.tentativasDevolucao + 1}/${MAX_TENTATIVAS}`;
  const jade = await _usuarioJade(empresaId, fonte.id, cfg.usuarioSoftexpert);
  const config = _contratoEscrita(empresaId, fonte.id, jade.codigo);
  let xmlAbertura = null;
  let campos = null;
  if (!workflowId) {
    const chamado = chamadoRepo.getChamadoPorNumero(empresaId, exec.numeroChamado, 'softexpert', { exigirUnico: true });
    if (!chamado) throw new Error('Chamado não encontrado na base local.');
    campos = montarAtributosPosicionamento({ contrato: config.contrato, chamado, jade, texto: exec.textoCliente, decisao: exec.decisao, cabecalho: s?.cabecalho });
    // E-mails do chamado (DYNITSM EMAIL e TEXTO32): só o workflow tem esses campos —
    // é por eles que o SoftExpert manda o retorno ao cliente (pedido do usuário, 2026-11-23).
    for (const [id, valor] of [['email', s?.cabecalho?.email], ['texto32', s?.cabecalho?.emailCopia]]) {
      if (String(valor ?? '').trim()) campos[id] = String(valor).trim();
    }
    xmlAbertura = soapClient.montarAberturaWorkflowJade({ titulo, userId: jade.matricula, campos });
  }
  _verificarPosse();
  if (!repo.contarTentativa(exec.id, 'devolucao', 'devolvendo', { estadoAnterior: exec.estado, tentativasAnteriores: exec.tentativasDevolucao })) return null;
  const usuario = `${jade.nome} (matrícula ${jade.matricula})`;
  const falhou = (resumo, detalhes, ultimoErro) => {
    _evento(exec, 'workflow', 'erro', `${tentativa}: ${resumo}`, detalhes);
    return repo.atualizar(exec.id, { ultimoErro });
  };
  let resposta;
  if (!workflowId) {
    const abertura = { usuario, processo: processId, titulo, status: STATUS_DECISAO[exec.decisao], campos };
    try {
      resposta = await soapClient.enviarOperacao({ ...config.transporte, xml: xmlAbertura, operacao: 'newWorkflowEditData' });
    } catch (err) {
      return falhou(`o SoftExpert não confirmou a abertura do workflow da Jaade (${err.message}). Será conferido no próximo ciclo antes de abrir outro.`,
        { ...abertura, resposta: _respostaSe({ httpStatus: err.httpStatus, Detail: err.codigoTransporte }), erroTecnico: _erroTecnico(err, { operacao: 'newWorkflowEditData' }) },
        'Abertura do workflow da Jaade não confirmada; será conferida no próximo ciclo.');
    }
    if (resposta.Status !== 'SUCCESS' || resposta.Code !== '1' || !String(resposta.RecordID || '').trim()) {
      return falhou(`o SoftExpert recusou a abertura do workflow da Jaade — ${resposta.Detail || resposta.Code}`,
        { ...abertura, resposta: _respostaSe(resposta), erroTecnico: { mensagem: resposta.Detail || 'Recusa sem detalhe', operacao: 'newWorkflowEditData', status: resposta.Status, code: resposta.Code } },
        `O SoftExpert recusou a abertura do workflow da Jaade: ${resposta.Detail || resposta.Code}`);
    }
    workflowId = String(resposta.RecordID).trim();
    _evento(exec, 'workflow', 'info', `Workflow da Jaade ${workflowId} aberto no SoftExpert (${processId}) com o status ${STATUS_DECISAO[exec.decisao]}.`,
      { ...abertura, workflow: workflowId, resposta: _respostaSe(resposta) });
  }
  const movimento = { usuario, workflow: workflowId, atividade: activityId, acao: actionSequence };
  try {
    // Entre abrir o workflow e executá-lo: se a trava mudou de dono, quem a
    // tem acha este workflow pelo título e executa a ATV-01 (nunca abre outro).
    _verificarPosse();
    resposta = await soapClient.enviarOperacao({ ...config.transporte, xml: soapClient.montarExecucaoWorkflowJade({ workflowId, userId: jade.matricula }), operacao: 'executeActivity' });
  } catch (err) {
    if (err instanceof ErroPosse) throw err;
    return falhou(`o SoftExpert não confirmou a execução da ${activityId} no workflow da Jaade ${workflowId} (${err.message}). Será conferida no próximo ciclo.`,
      { ...movimento, resposta: _respostaSe({ httpStatus: err.httpStatus, Detail: err.codigoTransporte }), erroTecnico: _erroTecnico(err, { operacao: 'executeActivity' }) },
      'Execução do workflow da Jaade não confirmada; será conferida no próximo ciclo.');
  }
  if (resposta.Status !== 'SUCCESS' || resposta.Code !== '1') {
    return falhou(`o SoftExpert recusou a execução da ${activityId} no workflow da Jaade ${workflowId} — ${resposta.Detail || resposta.Code}`,
      { ...movimento, resposta: _respostaSe(resposta), erroTecnico: { mensagem: resposta.Detail || 'Recusa sem detalhe', operacao: 'executeActivity', status: resposta.Status, code: resposta.Code } },
      `O SoftExpert recusou a execução do workflow da Jaade: ${resposta.Detail || resposta.Code}`);
  }
  return concluir(workflowId, `Workflow da Jaade ${workflowId} executado: o SoftExpert segue pelo status ${STATUS_DECISAO[exec.decisao]} e envia os e-mails.`,
    { ...movimento, resposta: _respostaSe(resposta) });
}

const NOMES_ATIVIDADE = { 'ATV-02': 'Primeiro Atendimento', 'ATV-06': 'Retorno do Usuário' };

/**
 * Última atividade do fluxo de auditoria: onde o chamado original ficou no
 * SoftExpert depois da Jaade. Quem move o chamado é o workflow da Jaade (pelo
 * TEXTO4), então aqui só registra onde ele está. Nunca falha.
 */
async function _registrarSituacaoFinal(cfg, fonte, exec) {
  try {
    const s = await situacaoNaOrigem(cfg.empresaId, fonte.id, exec.numeroChamado);
    if (!s) return _evento(exec, 'situacao', 'erro', 'O chamado não foi encontrado no SoftExpert na conferência final.');
    const nome = (id) => (id === ATIVIDADE_JADE ? `"${id}"` : `${id}${NOMES_ATIVIDADE[id] ? ` ${NOMES_ATIVIDADE[id]}` : ''}`);
    const onde = s.ativas.size ? [...s.ativas].map(nome).join(', ') : (s.aberto ? 'nenhuma atividade ativa' : 'chamado encerrado');
    _evento(exec, 'situacao', 'ok',
      exec.estado === 'devolvido' ? `Chamado em ${onde} (o workflow da Jaade segue pelo status ${STATUS_DECISAO[exec.decisao]}).` : `Chamado em ${onde}, com a triagem.`,
      {
        atividadeAtual: onde,
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
    const final = atual?.estado === 'devolvendo' ? await _encaminhar(cfg, fonte, repo.getExecucao(exec.id)) : atual;
    if (final && ['publicado', 'devolvido'].includes(final.estado)) await _registrarSituacaoFinal(cfg, fonte, final);
    return final;
  } catch (err) {
    const etapa = repo.getExecucao(exec.id)?.estado === 'devolvendo' ? 'workflow' : 'envio';
    if (err instanceof ErroPosse) {
      _evento(exec, etapa, 'aviso', `Envio interrompido (nada novo foi enviado ao SoftExpert nesta etapa): ${err.message}`);
      return repo.atualizar(exec.id, { ultimoErro: err.message });
    }
    // Falha antes de falar com o SoftExpert (consulta, usuário, contrato): não conta tentativa, mas avisa.
    console.error(`[IA Service] Jaade PA: envio do chamado ${exec.numeroChamado}:`, err.message);
    _evento(exec, etapa, 'erro',
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

async function _rodarCiclo(empresaId, fonteId, origem = 'agendado', dono) {
  let loteId = null;
  try { loteId = repo.criarLote(empresaId, fonteId, origem, dono); } catch (err) { console.error('[IA Service] Jaade PA: lote não criado:', err.message); }
  // Renova enquanto a leitura vive, mas só até MAX_LEITURA_MS (mesmo teto do
  // serviço de jobs): leitura presa no site não pode segurar a fonte para sempre.
  const inicio = Date.now();
  let avisouTeto = false;
  const timer = setInterval(() => {
    if (Date.now() - inicio > MAX_LEITURA_MS) {
      if (!avisouTeto) console.error(`[IA Service] Jaade PA: leitura da empresa ${empresaId} passou de ${MAX_LEITURA_MS / 3600000} h; a trava deixa de ser renovada e vence sozinha.`);
      avisouTeto = true;
      return;
    }
    try { if (!repo.renovarTrava(empresaId, fonteId, TRAVA_MS, dono)) console.error('[IA Service] Jaade PA: posse da trava perdida.'); }
    catch (err) { console.error('[IA Service] Jaade PA: renovação da trava falhou:', err.message); }
  }, 60000);
  timer.unref?.();
  try { return await _loteAtual.run({ loteId, empresaId, fonteId, dono }, () => _executarLote(empresaId, fonteId, loteId, origem, dono)); }
  finally { clearInterval(timer); }
}

async function _executarLote(empresaId, fonteId, loteId, origem, dono) {
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
          `Detectado no SoftExpert: em "${ATIVIDADE_JADE}", sem responsável e sem posicionamento.`);
      }
    }
    // Desligado no meio do ciclo: para antes do próximo chamado.
    // Na leitura avulsa (Executar agora) o job pode estar parado de propósito.
    const aindaLigada = () => origem === 'manual' || repo.getConfig(empresaId, fonteId).ativo;
    // Envio ao SoftExpert só no modo Publicar; em Simulação, "pronto" espera.
    const publicar = cfg.modo === 'publicar';
    if (publicar) resumo.enviados = [];
    const enviar = async (exec) => {
      _verificarPosse();
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
      _verificarPosse();
      const r = await processarExecucao(cfg, fonte, exec);
      if (r) resumo.processados.push({ numero: exec.numeroChamado, estado: r.estado });
      if (publicar && r?.estado === 'pronto' && aindaLigada()) await enviar(r);
    }));
  } catch (err) {
    resumo.erros.push(err.message);
    console.error(`[IA Service] Jaade PA: ciclo da empresa ${empresaId} falhou:`, err.message);
  } finally {
    resumo.fim = new Date().toISOString();
    resumo.duracaoMs = Date.parse(resumo.fim) - Date.parse(resumo.inicio);
    // Leitura mais longa que o intervalo: a próxima já está atrasada (aviso na tela).
    try { resumo.encavalou = resumo.duracaoMs > repo.getConfig(empresaId, fonteId).intervaloMinutos * 60000; } catch { /* aviso apenas */ }
    if (loteId) {
      try { resumo.loteGravado = repo.finalizarLote(loteId, resumo, { manter: origem === 'manual' }); } catch (err) { console.error('[IA Service] Jaade PA: lote não finalizado:', err.message); }
    }
    repo.liberarCiclo(empresaId, fonteId, resumo, { avulsa: origem === 'manual', dono });
  }
  // Aviso por WhatsApp depois de fechar a leitura: nunca atrasa nem derruba o lote.
  resumo.avisos = await avisoService.avisarLote(empresaId, fonteId, { loteId: resumo.loteGravado ? loteId : null });
  try {
    repo.anexarAvisosAoResumo(empresaId, fonteId, resumo.loteGravado ? loteId : null, resumo.avisos);
  } catch (err) {
    console.error('[IA Service] Jaade PA: resultado do aviso não gravado no lote:', err.message);
  }
  return resumo;
}

/** Leitura do job (agendador). `forcar` ignora a contagem; a leitura avulsa do botão é executarAgora. */
async function executarCiclo(empresaId, fonteId, { forcar = false, dono = `site:${randomUUID()}` } = {}) {
  if (!repo.tentarTravarCiclo(empresaId, fonteId, { travaMs: TRAVA_MS, forcar, dono })) return null;
  return _rodarCiclo(empresaId, fonteId, 'agendado', dono);
}

/**
 * Botão "Executar agora": UMA leitura imediata, com o job iniciado ou parado,
 * sem mexer na contagem do job. Não espera terminar; devolve o lote para a
 * tela acompanhar.
 */
function executarAgora(empresaId, fonteId) {
  const cfg = repo.getConfig(empresaId, fonteId);
  if (!cfg.atualizadoEm) throw _erro(409, 'Salve a configuração da Jaade antes de executar.');
  // Serviço de jobs no comando e dando sinal agora: o site só registra o
  // pedido e o serviço roda em segundos. Serviço sem sinal recente: o site
  // roda, para o botão nunca ficar esperando quem não vai atender.
  if (jobsModo.servicoNoComando() && jobsRepo.estadoServico().ativo) {
    if (repo.loteEmAndamento(empresaId, fonteId)) throw _erro(409, 'Já existe uma leitura da Jaade em execução.');
    jobsRepo.criarPedido(JOB_ID_SERVICO, instanciaServico(empresaId, fonteId), { solicitadoPor: 'tela da Jaade' });
    return { iniciado: true, loteId: null, aguardandoServico: true };
  }
  const dono = `site:${randomUUID()}`;
  if (!repo.tentarTravarCiclo(empresaId, fonteId, { travaMs: TRAVA_MS, avulsa: true, dono })) throw _erro(409, 'Já existe uma leitura da Jaade em execução.');
  _rodarCiclo(empresaId, fonteId, 'manual', dono).catch(err => console.error('[IA Service] Jaade PA: leitura avulsa falhou:', err.message));
  return { iniciado: true, loteId: repo.loteEmAndamento(empresaId, fonteId)?.id ?? null };
}

/** "Executar agora" no serviço de jobs: a mesma leitura avulsa, aguardando o fim. null = já havia leitura. */
async function executarAvulsa(empresaId, fonteId, { dono = `site:${randomUUID()}` } = {}) {
  if (!repo.tentarTravarCiclo(empresaId, fonteId, { travaMs: TRAVA_MS, avulsa: true, dono })) return null;
  return _rodarCiclo(empresaId, fonteId, 'manual', dono);
}

// Identificação da Jaade no serviço de jobs: um job, uma instância por empresa+fonte.
const JOB_ID_SERVICO = 'ia-service.jade-pa';
function instanciaServico(empresaId, fonteId) {
  return `${Number(empresaId)}:${fonteId}`;
}

/** Pausa da tela Jobs (job inteiro ou esta empresa+fonte); vale no site e no serviço. */
function _pausaJobs(empresaId, fonteId) {
  try {
    return jobsRepo.pausa(JOB_ID_SERVICO, instanciaServico(empresaId, fonteId));
  } catch (_) {
    return null;
  }
}

/**
 * Situação na tela Jobs para a tela da Jaade: onde está rodando (modo,
 * serviço no comando ou site reassumiu) e pausa. modo 'site' = como antes.
 */
function _servicoJobs(empresaId, fonteId) {
  try {
    const modo = jobsModo.modoConfigurado();
    const pausa = _pausaJobs(empresaId, fonteId);
    if (modo !== 'servico') return pausa ? { modo, pausa } : null;
    const instancia = instanciaServico(empresaId, fonteId);
    const ultima = jobsRepo.ultimaExecucao(JOB_ID_SERVICO, instancia);
    return {
      modo,
      ...jobsRepo.estadoServico(),
      noComando: jobsModo.servicoNoComando(),
      pausa,
      pedidoPendente: !!jobsRepo.pedidoAberto(JOB_ID_SERVICO, instancia),
      ultimaExecucao: ultima && { origem: ultima.origem, inicio: ultima.inicio, fim: ultima.fim, resultado: ultima.resultado, erro: ultima.erro },
    };
  } catch (err) {
    return { modo: 'servico', ativo: false, erro: `Banco do serviço de jobs indisponível: ${err.message}` };
  }
}

function _fonteSoftExpert(empresaId, fonteId) {
  const fonte = agenteRepo.getFonte(empresaId, fonteId);
  if (!fonte) throw _erro(404, 'Fonte não encontrada.');
  if (fonte.sistemaOrigem !== 'softexpert') throw _erro(400, 'A Jaade no Primeiro Atendimento só funciona com fonte do SoftExpert.');
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
  // Publicar só com o usuário da Jaade ativo no SoftExpert e autorizado no contrato de escrita.
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
  const servicoJobs = _servicoJobs(empresaId, fonteId);
  // Pedido do "Executar agora" ainda não atendido, ou execução do serviço que
  // ainda não travou a leitura (processo subindo), conta como em andamento: a
  // tela segue acompanhando até o lote começar e terminar.
  const execAberta = servicoJobs?.ultimaExecucao && !servicoJobs.ultimaExecucao.fim;
  const aguardando = servicoJobs?.noComando && servicoJobs.ativo && (servicoJobs.pedidoPendente || execAberta)
    ? { id: null, inicio: null, origem: servicoJobs.pedidoPendente ? 'manual' : servicoJobs.ultimaExecucao.origem, aguardandoServico: true } : null;
  return {
    config: repo.getConfig(empresaId, fonteId),
    agora: new Date().toISOString(),
    servicoJobs,
    loteEmAndamento: repo.loteEmAndamento(empresaId, fonteId) || aguardando,
    lotes: repo.listarLotes(empresaId, fonteId),
    semLote: repo.listarExecucoesSemLote(empresaId, fonteId),
  };
}

/**
 * Botão "Limpar logs": apaga lotes e auditoria do IA Service (período ou tudo).
 * Nunca toca no SoftExpert e nunca apaga o registro que impede a Jaade de agir
 * de novo no mesmo chamado. Bloqueado durante uma leitura.
 */
function limparLogs(empresaId, fonteId, { de = null, ate = null, tudo = false } = {}) {
  _fonteSoftExpert(empresaId, fonteId);
  if (repo.loteEmAndamento(empresaId, fonteId)) throw _erro(409, 'Há uma leitura da Jaade em execução. Aguarde terminar para limpar os logs.');
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
  if (!execucao || execucao.empresaId !== Number(empresaId) || execucao.fonteId !== fonteId) throw _erro(404, 'Registro da Jaade não encontrado.');
  return { execucao, eventos: repo.listarEventos(empresaId, execucaoId) };
}

// Sistema multiempresa (~20 empresas ao mesmo tempo, pedido do usuário,
// 2026-11-20): cada empresa roda no seu tempo, sem esperar o lote (nem o aviso
// por WhatsApp) da outra. O conjunto só evita disparar de novo a mesma fonte
// neste processo; entre processos quem garante é a trava no banco.
const _ciclosEmAndamento = new Set();
let _servicoNoComandoAntes = null;
function _tick() {
  // Tela Jobs escolheu o serviço IAHub-Jobs e ele dá sinal: o site não agenda.
  // Sem sinal (ou modo site), o site agenda — inclusive reassumindo sozinho.
  const noComando = jobsModo.servicoNoComando();
  if (noComando !== _servicoNoComandoAntes) {
    if (_servicoNoComandoAntes !== null || noComando) {
      console.log(noComando
        ? '[IA Service] Jaade PA: agendada pelo serviço IAHub-Jobs (tela Jobs).'
        : '[IA Service] Jaade PA: agendada pelo site.');
    }
    _servicoNoComandoAntes = noComando;
  }
  if (noComando) return [];
  let configs;
  try {
    configs = repo.listarConfigsAtivas();
  } catch (err) {
    console.error('[IA Service] Jaade PA: leitura do agendamento falhou:', err.message);
    return [];
  }
  const disparados = [];
  for (const cfg of configs) {
    const chave = `${cfg.empresaId}:${cfg.fonteId}`;
    if (_ciclosEmAndamento.has(chave)) continue;
    if (_pausaJobs(cfg.empresaId, cfg.fonteId)) continue;
    _ciclosEmAndamento.add(chave);
    disparados.push(Promise.resolve()
      .then(() => executarCiclo(cfg.empresaId, cfg.fonteId))
      .catch(err => console.error(`[IA Service] Jaade PA: falha no agendamento (empresa ${cfg.empresaId}):`, err.message))
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
  iniciarAgendamento, executarCiclo, executarAgora, executarAvulsa, JOB_ID_SERVICO, instanciaServico, processarExecucao, gerarTextoCliente, conferirStatus, verificarVazamento,
  normalizarTextoSoftExpert, montarAtributosPosicionamento, fontesDaAnalise, referenciasDaAnalise, simularMontagemReferencias, simularReferenciasNoRodape, enviarExecucao, situacaoNaOrigem, nomesDeOutrosClientes,
  listarElegiveisNaOrigem, getConfig, salvarConfig, listarGruposAviso, listarExecucoes, getAuditoria, getPainel, limparLogs, SQL_ELEGIVEIS, MAX_TENTATIVAS,
  _test: { tick: _tick },
};
