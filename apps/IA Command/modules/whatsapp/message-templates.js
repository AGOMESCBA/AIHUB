const { getDB } = require('../database');

const DEFAULT_TEMPLATES = {
  processando: {
    titulo: 'Mensagem de processamento',
    template: '*IA Command* recebeu sua mensagem e esta processando...',
  },
  audio_recebido: {
    titulo: 'Audio recebido',
    template: '*IA Command* recebeu seu audio e esta transcrevendo...',
  },
  erro_processamento: {
    titulo: 'Erro no processamento',
    template: 'Nao foi possivel processar sua consulta.\n_{{erro}}_',
  },
  erro_transcricao: {
    titulo: 'Erro na transcricao',
    template: 'Nao consegui transcrever o audio agora. Tente enviar novamente em instantes.',
  },
  intencao_desconhecida: {
    titulo: 'Intencao desconhecida',
    template: '❓ {{mensagem}}\n\nTente perguntar, por exemplo:\n* "Qual o faturamento deste mes?"\n* "Top 10 clientes do mes passado"\n* "Titulos em aberto"\n* "Pedidos abertos esta semana"\n* "Produtos mais vendidos do trimestre"',
  },
  ia_cota_esgotada: {
    titulo: 'IA com cota esgotada',
    template: '⚠️ As IAs estao temporariamente indisponiveis ({{provedores}}: cota esgotada).\n\nAguarde alguns minutos e tente novamente.',
  },
  numero_nao_autorizado: {
    titulo: 'Numero nao autorizado',
    template: 'Este numero nao esta autorizado a interagir com o IA Command.',
  },
  empresa_ambigua: {
    titulo: 'Escolha de empresa',
    template: 'Identifiquei mais de uma empresa vinculada a este WhatsApp.\n\n{{opcoes_empresas}}\n\nResponda com o numero ou nome da empresa para continuar.',
  },
  resposta_empresa_prefixo: {
    titulo: 'Prefixo com empresa',
    template: '*{{empresa_nome}}*\n{{resposta}}',
  },
  audio_resposta_prefixo: {
    titulo: 'Prefixo da resposta de audio',
    template: '_"{{transcricao}}"_\n\n{{resposta}}',
  },
};

function listarPadroes() {
  return Object.entries(DEFAULT_TEMPLATES).map(([chave, cfg]) => ({
    chave,
    titulo: cfg.titulo,
    template_padrao: cfg.template,
  }));
}

function getDefault(chave) {
  return DEFAULT_TEMPLATES[chave] || { titulo: chave, template: '' };
}

function renderTemplate(template, vars = {}) {
  return String(template || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const val = vars[key];
    return val === undefined || val === null ? '' : String(val);
  });
}

function buscar(empresaId, chave) {
  if (!empresaId || !chave) return null;
  try {
    return getDB().prepare(`
      SELECT * FROM whatsapp_message_templates
      WHERE empresa_id = ? AND chave = ? AND ativo = 1
      LIMIT 1
    `).get(Number(empresaId), chave) || null;
  } catch (_) {
    return null;
  }
}

function render(empresaId, chave, vars = {}) {
  const row = buscar(empresaId, chave);
  const fallback = getDefault(chave);
  const template = row?.template || fallback.template;
  return renderTemplate(template, vars);
}

module.exports = {
  DEFAULT_TEMPLATES,
  listarPadroes,
  getDefault,
  render,
  renderTemplate,
};
