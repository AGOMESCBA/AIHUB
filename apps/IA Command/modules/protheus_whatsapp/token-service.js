// Emissao e validacao de token curto de sessao para o canal Protheus WhatsApp.
//
// Segue o mesmo padrao ja usado no projeto para autenticacao servidor-a-servidor
// (agente local, worker do WhatsApp): token opaco (nao JWT), guardado em tabela
// com expiracao, comparado por lookup direto. O projeto nao usa jsonwebtoken em
// nenhum outro lugar — nao ha motivo para introduzir essa dependencia aqui.

const crypto = require('crypto');
const { getDB } = require('../database');

// Validade por inatividade. O chat pode ficar aberto dentro do Protheus por uma
// manha inteira; por isso a expiracao e renovada a cada chamada valida, evitando
// derrubar a sessao no meio de consultas longas ou alternancia entre conversas.
const TTL_MS = Number(process.env.IAC_PROTHEUS_CHAT_TTL_MS || 8 * 60 * 60 * 1000);

// Mesma normalizacao usada pelo canal WhatsApp real (_normalizarNumeroWa em
// modules/whatsapp/service.js): so digitos. Aplicada aqui, na entrada do celular
// no sistema, para que qualquer formato digitado no cadastro Protheus (com
// tracos, parenteses, espacos) chegue normalizado ao resto do pipeline — sem
// depender de disciplina manual de quem cadastra — e ja case corretamente
// contra whatsapp_allowed_numbers.
function normalizarCelular(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function normalizarEmpresasPermitidas(empresasPermitidas, empresaIdAtual) {
  const vistas = new Set();
  const lista = [];

  const add = (item = {}) => {
    const id = Number(item.empresaId || item.empresa_id || item.id || 0);
    if (!id || vistas.has(id)) return;
    vistas.add(id);
    lista.push({
      empresaId: id,
      codigoProtheus: String(item.codigoProtheus || item.codigo_protheus || '').trim(),
      nomeProtheus: String(item.nomeProtheus || item.nome_protheus || item.nome || '').trim(),
    });
  };

  if (Array.isArray(empresasPermitidas)) {
    for (const item of empresasPermitidas) add(item);
  }

  add({ empresaId: empresaIdAtual, codigoProtheus: '', nomeProtheus: '' });
  return lista;
}

// Normaliza a lista de filiais que o usuario Protheus efetivamente acessa,
// por codigo de empresa — enviada pelo .prw (IACFilJs/IACCHAT.prw), resolvida
// la via FWUsrEmp()+LoadFils() (com RpcSetEnv por empresa). Formato de
// entrada: [{ codigoProtheus, filiais: [filialChave, ...] }, ...]. Ausente ou
// vazio e um estado VALIDO (compatibilidade com .prw anterior a esta mudanca,
// ou falha ao coletar LoadFils para alguma empresa) — nesse caso o chamador
// deve tratar como "sem filtro adicional de filial", nunca bloquear.
function normalizarFiliaisPermitidas(filiaisPermitidas) {
  if (!Array.isArray(filiaisPermitidas)) return [];
  const porCodigo = new Map();
  for (const item of filiaisPermitidas) {
    const codigo = String(item?.codigoProtheus || item?.codigo_protheus || '').trim();
    if (!codigo) continue;
    const filiais = Array.isArray(item?.filiais)
      ? [...new Set(item.filiais.map(f => String(f || '').trim()).filter(Boolean))]
      : [];
    porCodigo.set(codigo, filiais);
  }
  return [...porCodigo.entries()].map(([codigoProtheus, filiais]) => ({ codigoProtheus, filiais }));
}

function emitir({ empresaId, celular, filial = null, empresasPermitidas = [], filiaisPermitidas = [] }) {
  if (!empresaId) throw new Error('empresaId obrigatorio.');
  const celularNormalizado = normalizarCelular(celular);
  if (!celularNormalizado) throw new Error('celular obrigatorio.');

  const token = crypto.randomBytes(32).toString('hex');
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + TTL_MS);
  const empresas = normalizarEmpresasPermitidas(empresasPermitidas, empresaId);
  const filiais = normalizarFiliaisPermitidas(filiaisPermitidas);

  getDB().prepare(`
    INSERT INTO protheus_chat_tokens (token, empresa_id, celular, filial, expira_em, criado_em, empresas_permitidas_json, filiais_permitidas_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(token, empresaId, celularNormalizado, filial, expiraEm.toISOString(), agora.toISOString(), JSON.stringify(empresas), JSON.stringify(filiais));

  return { token, expiraEm: expiraEm.toISOString() };
}

function validar(token) {
  if (!token) return null;

  const row = getDB().prepare(`
    SELECT token, empresa_id, celular, filial, expira_em, empresas_permitidas_json, filiais_permitidas_json
    FROM protheus_chat_tokens
    WHERE token = ?
  `).get(token);

  if (!row) return null;
  if (new Date(row.expira_em).getTime() < Date.now()) return null;

  const usadoEm = new Date();
  const novoExpiraEm = new Date(usadoEm.getTime() + TTL_MS);
  getDB().prepare(`UPDATE protheus_chat_tokens SET usado_em = ?, expira_em = ? WHERE token = ?`)
    .run(usadoEm.toISOString(), novoExpiraEm.toISOString(), token);

  let empresasPermitidas = [];
  try {
    empresasPermitidas = JSON.parse(row.empresas_permitidas_json || '[]');
  } catch (_) {
    empresasPermitidas = [];
  }
  empresasPermitidas = normalizarEmpresasPermitidas(empresasPermitidas, row.empresa_id);

  let filiaisPermitidas = [];
  try {
    filiaisPermitidas = JSON.parse(row.filiais_permitidas_json || '[]');
  } catch (_) {
    filiaisPermitidas = [];
  }
  filiaisPermitidas = normalizarFiliaisPermitidas(filiaisPermitidas);

  return {
    empresaId: row.empresa_id,
    celular: row.celular,
    filial: row.filial,
    empresasPermitidas,
    filiaisPermitidas,
  };
}

// Devolve a lista de filialChave que a sessao autoriza para um codigo de
// empresa Protheus especifico, ou null se a sessao nao tem essa informacao
// para essa empresa (token emitido por .prw anterior a esta mudanca, ou
// LoadFils falhou para essa empresa no momento da abertura do chat) — null
// e distinto de array vazio: null significa "sem informacao, nao filtrar
// adicionalmente"; array vazio significa "usuario nao acessa filial nenhuma
// nesta empresa" (bloqueio real).
function filiaisPermitidasDaEmpresa(sessao, codigoProtheusEmpresa) {
  const codigo = String(codigoProtheusEmpresa || '').trim();
  if (!codigo) return null;
  const lista = Array.isArray(sessao?.filiaisPermitidas) ? sessao.filiaisPermitidas : [];
  const item = lista.find(i => i.codigoProtheus === codigo);
  return item ? item.filiais : null;
}

function limparExpirados() {
  getDB().prepare(`DELETE FROM protheus_chat_tokens WHERE expira_em < ?`)
    .run(new Date().toISOString());
}

function empresaPermitida(sessao, empresaId) {
  const id = Number(empresaId || 0);
  if (!id) return false;
  return normalizarEmpresasPermitidas(sessao?.empresasPermitidas, sessao?.empresaId)
    .some(e => Number(e.empresaId) === id);
}

module.exports = {
  emitir,
  validar,
  limparExpirados,
  normalizarCelular,
  normalizarEmpresasPermitidas,
  normalizarFiliaisPermitidas,
  empresaPermitida,
  filiaisPermitidasDaEmpresa,
  TTL_MS,
};
