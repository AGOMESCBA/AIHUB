'use strict';

// Contratos congelados na C0 (fonte única: docs/contratos.md descreve, este
// arquivo é o que o código e os testes usam). Mudar aqui = mudar contrato:
// só com combinação entre Claude Code e Antigravity e registro em
// docs/andamento.md.

const congelar = (lista) => Object.freeze([...lista]);

const PAPEIS = congelar(['admin_empresa', 'supervisor', 'atendente', 'auditor']);

const ESCOPOS_APLICACAO = congelar(['mensagens:enviar', 'mensagens:ler', 'eventos:ler', 'canais:ler']);

const PROVEDORES = congelar(['wweb', 'meta']);

const ESTADOS_CANAL = congelar(['parado', 'iniciando', 'qr_pendente', 'conectado', 'reconectando', 'desconectado', 'erro']);

const TIPOS_MENSAGEM = congelar(['texto', 'imagem', 'documento', 'audio', 'video']);

// Saída: só estados que o sistema ou o provedor comprovam. "aceita" NÃO é entrega.
const ESTADOS_SAIDA = congelar(['aceita', 'aguardando', 'encaminhada', 'enviada', 'entregue', 'lida', 'falhou', 'desconhecida']);
const ESTADOS_ENTRADA = congelar(['recebida']);
const ESTADOS_FINAIS = congelar(['lida', 'falhou']);
// Só estes podem ser reenviados ou dados como falha manualmente na tela.
const ESTADOS_COM_ACAO_MANUAL = congelar(['desconhecida', 'falhou']);

const SITUACOES_ENTREGA_WEBHOOK = congelar(['pendente', 'entregue', 'falhando', 'esgotado']);

const TIPOS_EVENTO_WEBHOOK = congelar([
  'mensagem.recebida',
  'mensagem.estado_alterado',
  'canal.estado_alterado',
  'conversa.responsavel_alterado',
]);

const TIPOS_LOG_CANAL = congelar(['info', 'success', 'warning', 'error', 'received', 'sent', 'system']);

// Socket.IO: path config.SOCKET_PATH, namespace config.SOCKET_NAMESPACE.
const EVENTOS_SOCKET = Object.freeze({
  cliente: Object.freeze({
    assinarCanal: 'canal:assinar',   // { canal_id }
    sairCanal: 'canal:sair',         // { canal_id }
    assinarPainel: 'painel:assinar', // {}
  }),
  servidor: Object.freeze({
    estadoCanal: 'canal:estado',          // { canal_id, estado, em, detalhe? }
    qrCanal: 'canal:qr',                  // { canal_id, qr, expira_em }
    logCanal: 'canal:log',                // { canal_id, em, tipo, mensagem }
    estadoMensagem: 'mensagem:estado',    // { id, estado, em }
    painelAtualizado: 'painel:atualizado',// mesmo corpo de GET /painel
    erro: 'erro',                         // { codigo, mensagem }
  }),
});

// Campos obrigatórios de cada recurso nas respostas (usado nos testes de
// contrato do servidor simulado e, depois, do servidor real).
const FORMAS = Object.freeze({
  pagina: ['itens', 'proximo_cursor'],
  erro: ['codigo', 'mensagem'],
  sessao: ['usuario', 'empresa', 'papel', 'rotinas', 'empresas_disponiveis'],
  empresa: ['id', 'nome', 'documento', 'apelido', 'logo_url', 'situacao', 'vinculo_hub', 'criado_em', 'atualizado_em'],
  usuario: ['id', 'nome', 'telefone_mascarado', 'email', 'papel', 'situacao', 'ultimo_acesso_em', 'criado_em'],
  papel: ['codigo', 'nome', 'descricao', 'rotinas'],
  sitesAutorizados: ['origens', 'versao', 'atualizado_em'],
  emailEnvio: ['tipo', 'email', 'senha_configurada', 'smtp_host', 'smtp_porta', 'smtp_seguro', 'remetente_nome', 'situacao', 'atualizado_em'],
  aplicacao: ['id', 'nome', 'descricao', 'situacao', 'escopos', 'canais_autorizados', 'webhook', 'tokens', 'criado_em'],
  tokenAplicacao: ['id', 'prefixo', 'criado_em', 'ultimo_uso_em', 'revogado_em'],
  canal: ['id', 'nome', 'numero_mascarado', 'provedor', 'estado', 'estado_desde', 'empresa_dona', 'empresas_vinculadas', 'capacidades', 'fila_pendente', 'ultima_mensagem_em'],
  qrCanal: ['canal_id', 'estado', 'qr', 'expira_em'],
  logCanal: ['em', 'tipo', 'mensagem'],
  painel: ['canais', 'mensagens_hoje', 'fila', 'tempo_medio_envio_ms', 'pendencias', 'atualizado_em'],
  mensagemResumo: ['id', 'direcao', 'canal', 'aplicacao', 'contato_mascarado', 'tipo', 'previa', 'estado', 'correlacao_id', 'criada_em', 'atualizada_em'],
  mensagemDetalhe: ['id', 'direcao', 'canal', 'aplicacao', 'contato_mascarado', 'tipo', 'previa', 'estado', 'correlacao_id', 'criada_em', 'atualizada_em', 'historico_estados', 'metadados', 'anexos'],
  evento: ['id', 'tipo', 'em', 'aplicacao', 'entrega'],
  auditoria: ['id', 'em', 'usuario', 'aplicacao', 'acao', 'alvo_tipo', 'alvo_id', 'resumo', 'ip_mascarado'],
  v1MensagemAceita: ['id', 'estado', 'canal', 'criada_em'],
  v1Mensagem: ['id', 'estado', 'canal', 'para_mascarado', 'tipo', 'correlacao_id', 'criada_em', 'atualizada_em', 'historico_estados'],
  v1EstadoCanal: ['id', 'estado', 'estado_desde', 'capacidades'],
});

function camposFaltando(forma, objeto) {
  const campos = FORMAS[forma];
  if (!campos) throw new Error(`Forma desconhecida: ${forma}`);
  if (!objeto || typeof objeto !== 'object') return [...campos];
  return campos.filter(c => !Object.prototype.hasOwnProperty.call(objeto, c));
}

module.exports = {
  PAPEIS,
  ESCOPOS_APLICACAO,
  PROVEDORES,
  ESTADOS_CANAL,
  TIPOS_MENSAGEM,
  ESTADOS_SAIDA,
  ESTADOS_ENTRADA,
  ESTADOS_FINAIS,
  ESTADOS_COM_ACAO_MANUAL,
  SITUACOES_ENTREGA_WEBHOOK,
  TIPOS_EVENTO_WEBHOOK,
  TIPOS_LOG_CANAL,
  EVENTOS_SOCKET,
  FORMAS,
  camposFaltando,
};
