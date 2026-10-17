const fs = require('fs');
const crypto = require('crypto');
const { normalizarHoras } = require('./retorno-softexpert-horas');

const ALIASES = ['DESCRICAO', 'ASSUNTO', 'RESULTADO', 'HORAINI', 'HORAFIM', 'HORAINT', 'HORATOTALNUM', 'HORAINICONV', 'HORAINTCONV', 'HORAFIMCONV', 'DTAGEND', 'HRAGEND', 'SITUACAOCHAMADO', 'TIPOPOSICIONAME', 'MOTIVOAPONTAMEN', 'AGUARDANRETORNO'];
const TIPOS = ['texto', 'inteiro', 'decimal', 'data', 'hora'];
const ORIGENS = ['numero_chamado', 'oid_chamado', 'analista_softexpert', 'data_iso', 'instante_unix', 'valor_fixo'];
const texto = (v) => typeof v === 'string' && v.trim().length > 0;

function validarContrato(c) {
  if (!c || c.contratoValidado !== true || c.envioHabilitado !== true) throw new Error('Contrato não validado ou envio desabilitado.');
  const url = new URL(c.origem);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Origem HTTPS inválida.');
  if (!['jwt', 'bearer'].includes(c.authorizationMode) || !['utf8', 'latin1'].includes(c.encoding)) throw new Error('Autenticação e codificação precisam ser validadas.');
  if (!texto(c.mainEntityId) || !texto(c.childRelationshipId) || !texto(c.campos?.DESCRICAO?.id)) throw new Error('Mapeamento lógico do posicionamento incompleto.');
  if (!texto(c.evidenciaContrato)) throw new Error('Informe a referência da validação do contrato.');
  const ids = new Set();
  for (const [alias, campo] of Object.entries(c.campos)) {
    if (!ALIASES.includes(alias) || !texto(campo.id) || !TIPOS.includes(campo.tipo) || ids.has(campo.id)) throw new Error('Campo inválido ou duplicado no contrato.');
    ids.add(campo.id);
    if (campo.opcoes && (!Array.isArray(campo.opcoes) || !campo.opcoes.length || campo.opcoes.some((o) => !texto(o.valor) || !texto(o.rotulo)))) throw new Error('Lista de opções inválida.');
    if (['SITUACAOCHAMADO', 'TIPOPOSICIONAME', 'MOTIVOAPONTAMEN', 'AGUARDANRETORNO'].includes(alias) && !campo.calculado && !campo.opcoes?.length) throw new Error('Lista de seleção ainda não validada.');
    if (campo.maxLength !== undefined && (!Number.isInteger(campo.maxLength) || campo.maxLength < 1 || campo.maxLength > 100000)) throw new Error('Limite de campo inválido.');
  }
  for (const campo of c.automaticos || []) {
    if (!texto(campo.id) || ids.has(campo.id) || !ORIGENS.includes(campo.origem) || (campo.origem === 'valor_fixo' && typeof campo.valor !== 'string')) throw new Error('Campo automático inválido.');
    ids.add(campo.id);
  }
  if (!c.autoria?.validada || !['credencial_analista', 'conta_integracao'].includes(c.autoria.modo)) throw new Error('Autoria não validada.');
  if (c.anexos?.habilitado && (!c.anexos.contratoValidado || !c.anexos.armazenamentoValidado || c.anexos.destino !== 'campo_grid' || c.anexos.transporte !== 'base64_inline' || c.anexos.campoArquivoId !== 'arquivo2')) throw new Error('O contrato exige anexo único no campo arquivo2 da grid, com transporte e armazenamento validados.');
  if (!['desabilitado', 'automatico_validado', 'comentario_validado'].includes(c.historico?.modo || 'desabilitado')) throw new Error('Modo de histórico inválido.');
  if ((c.historico?.modo || 'desabilitado') !== 'desabilitado' && (!c.historico?.equivalenciaValidada || !texto(c.historico.evidencia))) throw new Error('Equivalência do histórico não validada.');
  if (c.historico?.modo === 'comentario_validado' && (c.historico.envioAutomatico !== true || typeof c.historico.privado !== 'boolean')) throw new Error('Envio e visibilidade do comentário precisam de configuração explícita.');
  return c;
}

function resolver({ empresaId, fonteId, consultor }) {
  const arquivo = process.env.SVC_SOFTEXPERT_RETORNO_CONFIG;
  if (!arquivo) return { disponivel: false, motivo: 'O registro aguarda a configuração validada do SoftExpert. O rascunho será preservado.' };
  try {
    const stat = fs.statSync(arquivo);
    if (stat.size > 1024 * 1024) throw new Error('Configuração excede o limite.');
    const doc = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    if (doc.versao !== 1 || !Array.isArray(doc.empresas)) throw new Error('Formato inválido.');
    const matches = doc.empresas.filter((c) => Number(c.empresaId) === Number(empresaId) && String(c.fonteId) === String(fonteId));
    if (matches.length !== 1) throw new Error('Configuração não é única para empresa e fonte.');
    const contrato = validarContrato(matches[0]);
    const identidade = contrato.autoria.analistas?.[String(consultor.idSoftexpert)];
    if (!identidade || !texto(identidade.apiKeyEnv) || !texto(identidade.userId)) throw new Error('Analista sem autorização explícita de escrita.');
    const apiKey = process.env[identidade.apiKeyEnv];
    if (!texto(apiKey) || /[\r\n]/.test(apiKey)) throw new Error('Credencial não configurada.');
    return {
      disponivel: true, contrato,
      contratoHash: crypto.createHash('sha256').update(JSON.stringify(contrato)).digest('hex'),
      transporte: { origem: contrato.origem, apiKey, authorizationMode: contrato.authorizationMode, encoding: contrato.encoding },
      userId: identidade.userId,
    };
  } catch (_) {
    return { disponivel: false, motivo: 'Configuração de escrita indisponível ou incompleta para esta empresa, fonte e analista. Solicite a validação ao administrador.' };
  }
}

function mapearCampos(campos, contrato, { chamado, consultor, instante }) {
  if (contrato.campos.HORAINI || contrato.campos.HORAFIM || campos.HORAINI || campos.HORAFIM || campos.HORAINT) campos = normalizarHoras(campos);
  const valores = {};
  for (const [alias, value] of Object.entries(campos)) {
    const campo = contrato.campos[alias];
    if (value !== '' && (!campo || campo.calculado)) throw Object.assign(new Error('Campo não configurado ou calculado pelo SoftExpert.'), { status: 400 });
  }
  for (const [alias, campo] of Object.entries(contrato.campos)) {
    if (campo.calculado) continue;
    const value = campos[alias] || '';
    if (campo.obrigatorio && !value.trim()) throw Object.assign(new Error(`Preencha o campo ${alias}.`), { status: 400 });
    if (!value) continue;
    if (value.length > (campo.maxLength || 100000) || (campo.opcoes && !campo.opcoes.some((o) => o.valor === value))) throw Object.assign(new Error(`Valor não permitido para ${alias}.`), { status: 400 });
    if ((campo.tipo === 'inteiro' && !/^-?\d+$/.test(value)) || (campo.tipo === 'decimal' && !/^-?\d+(\.\d+)?$/.test(value)) || (campo.tipo === 'hora' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))) throw Object.assign(new Error(`Formato inválido em ${alias}.`), { status: 400 });
    if (campo.tipo === 'data' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw Object.assign(new Error(`Data inválida em ${alias}.`), { status: 400 });
    valores[campo.id] = value;
  }
  const date = new Date(instante);
  const automaticos = { numero_chamado: chamado.numero, oid_chamado: chamado.oidOrigem, analista_softexpert: consultor.idSoftexpert, data_iso: date.toISOString().slice(0, 10), instante_unix: String(Math.floor(date.getTime() / 1000)) };
  for (const campo of contrato.automaticos || []) valores[campo.id] = campo.origem === 'valor_fixo' ? campo.valor : automaticos[campo.origem];
  return valores;
}

module.exports = { resolver, validarContrato, mapearCampos, ALIASES };

function leituraAnexosHabilitada(empresaId, fonteId) {
  try {
    const arquivo = process.env.SVC_SOFTEXPERT_RETORNO_CONFIG;
    if (!arquivo || fs.statSync(arquivo).size > 1024 * 1024) return false;
    const doc = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    const matches = doc.versao === 1 && Array.isArray(doc.empresas) ? doc.empresas.filter((c) => Number(c.empresaId) === Number(empresaId) && String(c.fonteId) === String(fonteId)) : [];
    return matches.length === 1 && matches[0].anexos?.armazenamentoValidado === true;
  } catch (_) { return false; }
}
module.exports.leituraAnexosHabilitada = leituraAnexosHabilitada;
