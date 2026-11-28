'use strict';

// Contratos congelados na C0 (fonte única: docs/contratos.md descreve, este
// arquivo é o que o código e os testes usam). Mudar aqui = mudar contrato:
// só com combinação entre Claude Code e Antigravity e registro em
// docs/andamento.md.

const congelar = (lista) => Object.freeze([...lista]);

const PAPEIS = congelar(['admin_empresa', 'supervisor', 'atendente', 'auditor']);

// conversas:* (C8 §8.9): o sistema de origem abre conversa a partir de um chamado e lê os retornos.
const ESCOPOS_APLICACAO = congelar(['mensagens:enviar', 'mensagens:ler', 'eventos:ler', 'canais:ler', 'conversas:criar', 'conversas:ler']);

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

// C8 — Atendimento (Fase 2). Uso do número: só integração (Fase 1), atendimento
// próprio (opção A) ou compartilhado com o IA Command (opção B).
const USOS_CANAL = congelar(['integracao', 'atendimento', 'compartilhado']);
const SITUACOES_CONVERSA = congelar(['aberta', 'encerrada']);
const VISOES_CONVERSA = congelar(['minhas', 'fila', 'abertas', 'encerradas', 'todas', 'triagem']);
// C10 — Onda 1 (§9)
const STATUS_ATENDENTE = congelar(['disponivel', 'ocupado', 'ausente']);
const MODOS_DISTRIBUICAO = congelar(['fila_livre', 'rodizio']);
const TIPOS_ALERTA = congelar(['nova_na_fila', 'oferta', 'espera_longa', 'sla_estourado', 'escalonamento']);
const CATEGORIAS_ITEM_CONVERSA = congelar(['mensagem', 'nota', 'evento']);
const AUTORES_ITEM_CONVERSA = congelar(['contato', 'atendente', 'sistema', 'ia']);
const PRIORIDADES_CONVERSA = congelar(['normal', 'alta']);
// Retornos que o sistema de origem busca em GET /v1/retornos e confirma (§8.9).
const TIPOS_RETORNO = congelar(['conversa.criada', 'conversa.vinculada', 'conversa.assumida', 'conversa.transferida',
  'conversa.devolvida', 'conversa.encerrada', 'conversa.reaberta']);

// Socket.IO: path config.SOCKET_PATH, namespace config.SOCKET_NAMESPACE.
const EVENTOS_SOCKET = Object.freeze({
  cliente: Object.freeze({
    assinarCanal: 'canal:assinar',   // { canal_id }
    sairCanal: 'canal:sair',         // { canal_id }
    assinarPainel: 'painel:assinar', // {}
    assinarAtendimento: 'atendimento:assinar', // {} (C8)
    assinarConversa: 'conversa:assinar',       // { conversa_id } (C8)
    sairConversa: 'conversa:sair',             // { conversa_id } (C8)
  }),
  servidor: Object.freeze({
    estadoCanal: 'canal:estado',          // { canal_id, estado, em, detalhe? }
    qrCanal: 'canal:qr',                  // { canal_id, qr, expira_em }
    logCanal: 'canal:log',                // { canal_id, em, tipo, mensagem }
    estadoMensagem: 'mensagem:estado',    // { id, estado, em }
    painelAtualizado: 'painel:atualizado',// mesmo corpo de GET /painel
    contadoresAtendimento: 'atendimento:contadores', // mesmo corpo de GET /conversas/contadores (C8)
    conversaAtualizada: 'conversa:atualizada',       // conversaResumo (C8)
    conversaSaiu: 'conversa:saiu',                   // { id } — deixou de ser visível para quem recebe (C8)
    itemConversa: 'conversa:item',                   // { conversa_id, item } (C8)
    estadoItemConversa: 'conversa:item_estado',      // { conversa_id, item_id, estado, em } (C8)
    presencaAtualizada: 'presenca:atualizada',       // { usuario_id, status, online, em } (C10)
    alerta: 'alerta',                                // forma alerta, só para a pessoa (C10)
    painelAtendimento: 'atendimento:painel',         // mesmo corpo de GET /atendimento/painel (C10)
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
  // C8 — Atendimento (docs/contratos.md §8)
  setor: ['id', 'codigo', 'nome', 'descricao', 'situacao', 'membros', 'horario', 'fora_horario', 'conversas_abertas', 'na_fila', 'versao', 'criado_em', 'atualizado_em'],
  contato: ['id', 'nome', 'nome_whatsapp', 'telefone_mascarado', 'conversas_total', 'primeira_conversa_em', 'ultima_conversa_em'],
  conversaResumo: ['id', 'protocolo', 'canal', 'contato', 'setor', 'responsavel', 'situacao', 'na_fila', 'nao_lidas', 'ultima_mensagem',
    'aguardando_desde', 'etiquetas', 'prioridade', 'referencias', 'aberta_em', 'atualizada_em', 'encerrada_em'],
  conversaDetalhe: ['id', 'protocolo', 'canal', 'contato', 'setor', 'responsavel', 'situacao', 'na_fila', 'nao_lidas', 'ultima_mensagem',
    'aguardando_desde', 'etiquetas', 'prioridade', 'referencias', 'aberta_em', 'atualizada_em', 'encerrada_em', 'motivo_encerramento', 'envio'],
  itemConversa: ['id', 'categoria', 'direcao', 'autor', 'tipo', 'texto', 'estado', 'mensagem_id', 'em'],
  contadoresAtendimento: ['minhas', 'fila', 'abertas', 'por_setor', 'atualizado_em'],
  respostaRapida: ['id', 'atalho', 'titulo', 'texto', 'setor', 'situacao', 'atualizado_em'],
  v1Conversa: ['id', 'protocolo', 'situacao', 'na_fila', 'canal', 'setor', 'responsavel', 'prioridade', 'referencias', 'aberta_em',
    'atualizada_em', 'encerrada_em', 'motivo_encerramento', 'link'],
  v1Retorno: ['id', 'tipo', 'em', 'conversa', 'referencias', 'dados'],
  // C10 — Onda 1 (docs/contratos.md §9). Campos novos de setor e conversa conferidos à parte
  // (o servidor real ganha cada um na sua etapa, C11–C16).
  setorOnda1: ['menu', 'distribuicao', 'alertas', 'sla', 'inatividade', 'pesquisa', 'personalizados'],
  politicaAtendimento: ['distribuicao', 'alertas', 'sla', 'inatividade', 'pesquisa', 'uso', 'versao', 'atualizado_em'], // §9.10
  conversaOnda1: ['triagem', 'oferta', 'sla', 'pesquisa'],
  atendente: ['usuario', 'status', 'online', 'conversas_abertas', 'limite', 'setores', 'alertas_whatsapp', 'status_desde'],
  alerta: ['id', 'tipo', 'conversa_id', 'protocolo', 'setor', 'mensagem', 'em'],
  painelAtendimento: ['por_setor', 'atendentes', 'hoje', 'atualizado_em'],
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
  USOS_CANAL,
  SITUACOES_CONVERSA,
  VISOES_CONVERSA,
  CATEGORIAS_ITEM_CONVERSA,
  AUTORES_ITEM_CONVERSA,
  PRIORIDADES_CONVERSA,
  STATUS_ATENDENTE,
  MODOS_DISTRIBUICAO,
  TIPOS_ALERTA,
  TIPOS_RETORNO,
  EVENTOS_SOCKET,
  FORMAS,
  camposFaltando,
};
