const crypto = require('crypto');
const chamadoRepo = require('../repositories/chamado-repository');
const consultorRepo = require('../repositories/consultor-repository');
const clienteRepo = require('../repositories/cliente-repository');
const platformStore = require('../../../IAHUB/backend/platform-store');
const armazenamento = require('./armazenamento-anexos');
const retornoRepo = require('../repositories/retorno-softexpert-repository');
const configService = require('./retorno-softexpert-config');
const { criarExecutor, resultado } = require('./retorno-softexpert-executor');
const source = require('./retorno-softexpert-source');
const { normalizarHoras } = require('./retorno-softexpert-horas');
const executor = criarExecutor({ resolverResponsavel: (args) => source.resolverResponsavel(args), resolverOid: source.resolverOid, sincronizar: source.sincronizar });

const CAMPOS = configService.ALIASES;
const MOTIVO = 'O registro aguarda a configuração validada dos campos, relacionamentos, regras e credenciais do SoftExpert. Seu rascunho pode ser preparado, mas nenhum dado será enviado.';

function erro(status, message) { return Object.assign(new Error(message), { status }); }

function autorizar({ empresaId, chamadoId, consultorId, usuarioId }) {
  if (!empresaId || (!consultorId && !usuarioId)) throw erro(401, 'Sessão autenticada obrigatória.');
  const chamado = chamadoRepo.getChamado(empresaId, chamadoId);
  if (!chamado) throw erro(404, 'Chamado não encontrado nesta empresa.');
  if (chamado.sistemaOrigem !== 'softexpert') throw erro(400, 'O chamado não pertence ao SoftExpert.');
  if (/encerrado/i.test(chamado.statusEncerramento || '')) throw erro(409, 'Chamado encerrado: retorno indisponível.');
  const consultor = consultorId
    ? consultorRepo.getConsultor(empresaId, consultorId)
    : consultorRepo.getConsultorPorUsuario(empresaId, usuarioId);
  if (!consultor?.ativo || !consultor.idSoftexpert || !consultor.telefone) throw erro(403, 'Analista sem vínculo ativo para registrar retorno.');
  const vinculos = platformStore.listarIaServicePorTelefone(consultor.telefone);
  if (!vinculos.some((v) => Number(v.empresaId) === Number(empresaId) && v.ativo && String(v.idSoftexpert) === String(consultor.idSoftexpert))) {
    throw erro(403, 'Permissão atual do analista não encontrada na empresa.');
  }
  const tecnico = clienteRepo.getTecnicoPorOrigem(empresaId, 'softexpert', consultor.idSoftexpert);
  // Acesso coletivo para escrita depende de uma política explícita do processo.
  if (!tecnico?.ativo || String(tecnico.id) !== String(chamado.tecnicoResponsavelId)) throw erro(403, 'Somente o analista responsável pode preparar este retorno.');
  return { chamado, consultor };
}

function obterFormulario(contexto) {
  const { chamado, consultor } = autorizar(contexto);
  const config = configService.resolver({ empresaId: contexto.empresaId, fonteId: chamado.fonteId, consultor });
  const provaValida = !contexto.consultorId || !!contexto.otpVerificadoEm;
  const regrasCampos = config.disponivel ? Object.fromEntries(Object.entries(config.contrato.campos).map(([alias, c]) => [alias, { tipo: c.tipo, obrigatorio: !!c.obrigatorio, calculado: !!c.calculado, maxLength: c.maxLength, opcoes: c.opcoes }])) : null;
  return {
    chamadoId: chamado.id, numero: chamado.numero, analista: consultor.id,
    disponivel: config.disponivel && provaValida,
    motivo: !provaValida ? 'Entre novamente pelo código de acesso para autorizar gravações.' : config.motivo || 'Revise o conteúdo antes de confirmar o envio.',
    limites: { arquivos: 1, arquivoBytes: armazenamento.TAMANHO_MAXIMO_BYTES, totalBytes: armazenamento.TAMANHO_MAXIMO_BYTES },
    campos: CAMPOS, regrasCampos, mapeamentoValidado: !!config.disponivel,
    anexosDisponiveis: !!config.contrato?.anexos?.habilitado,
    historico: config.contrato?.historico?.modo || 'desabilitado',
  };
}

function validarEntrada(dados, arquivos = []) {
  if (!dados || dados.confirmado !== true) throw erro(400, 'Confirme explicitamente o registro do retorno.');
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(dados.idempotencyKey || '')) throw erro(400, 'Identificador de envio inválido.');
  if (!dados.campos || typeof dados.campos !== 'object' || Array.isArray(dados.campos)) throw erro(400, 'Campos do retorno inválidos.');
  if (Object.keys(dados.campos).some((k) => !CAMPOS.includes(k))) throw erro(400, 'Campo não permitido no retorno.');
  const campos = {};
  for (const campo of CAMPOS) {
    const value = dados.campos[campo] ?? '';
    const limite = campo === 'DESCRICAO' ? 100000 : ['ASSUNTO', 'RESULTADO'].includes(campo) ? 500 : 40;
    if (typeof value !== 'string' || value.length > limite || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw erro(400, 'Valor inválido no formulário de retorno.');
    campos[campo] = value;
  }
  if (!campos.DESCRICAO.trim()) throw erro(400, 'Informe a descrição do retorno.');
  if (arquivos.length > 1) throw erro(400, 'É permitido apenas um anexo por posicionamento.');
  for (const file of arquivos) {
    const validacao = armazenamento.validarAnexo({ nomeOriginal: file.originalname, mimeType: file.mimetype, tamanho: file.size });
    if (!validacao.ok) throw erro(400, validacao.erro);
    if (!Buffer.isBuffer(file.buffer) || file.size !== file.buffer.length) throw erro(400, 'Conteúdo do anexo inválido.');
  }
  return normalizarHoras(campos);
}

function registrar(contexto, dados, arquivos = []) {
  const { chamado, consultor } = autorizar(contexto);
  const campos = validarEntrada(dados, arquivos);
  const config = configService.resolver({ empresaId: contexto.empresaId, fonteId: chamado.fonteId, consultor });
  if (config.disponivel) {
    if (contexto.consultorId && !contexto.otpVerificadoEm) throw erro(401, 'Entre novamente pelo código de acesso antes de registrar retorno.');
    if (arquivos.length && !config.contrato.anexos?.habilitado) throw erro(400, 'O envio de anexos ainda não foi validado para esta fonte.');
    configService.mapearCampos(campos, config.contrato, { chamado, consultor, instante: new Date().toISOString() });
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify({ campos, arquivos: arquivos.map((f) => ({ nome: f.originalname, mime: f.mimetype, hash: crypto.createHash('sha256').update(f.buffer).digest('hex') })) })).digest('hex');
  const tentativa = retornoRepo.registrarTentativa({
    empresaId: contexto.empresaId, chamadoId: chamado.id, consultorId: consultor.id,
    origemIdentidade: contexto.consultorId ? 'consultor_externo' : 'iahub', usuarioId: contexto.consultorId || contexto.usuarioId,
    chave: dados.idempotencyKey, hash, quantidadeAnexos: arquivos.length,
  });
  if (config.disponivel) return executor.executar({ tentativaId: tentativa, config, chamado, consultor, campos, arquivos, validarAutorizacao: () => autorizar(contexto) });
  // Nenhuma tentativa pode chegar ao transporte sem contrato e autoria validados.
  return { status: 'bloqueado_configuracao', tentativaId: tentativa, posicionamento: 'nao_enviado', anexos: 'nao_enviados', error: MOTIVO };
}

function consultar(contexto, tentativaId) {
  const { consultor } = autorizar(contexto);
  const row = retornoRepo.obter(tentativaId);
  if (!row || Number(row.empresa_id) !== Number(contexto.empresaId) || row.chamado_id !== contexto.chamadoId || row.consultor_id !== consultor.id) throw erro(404, 'Tentativa não encontrada neste contexto.');
  return resultado(row);
}
function consultarPorChave(contexto, chave) {
  const { consultor } = autorizar(contexto);
  const row = retornoRepo.obterPorChave(contexto.empresaId, consultor.id, contexto.chamadoId, chave);
  if (!row) throw erro(404, 'Tentativa não encontrada neste contexto.');
  return resultado(row);
}

module.exports = { autorizar, obterFormulario, registrar, validarEntrada, consultar, consultarPorChave };
