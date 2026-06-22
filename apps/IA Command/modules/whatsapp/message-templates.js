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
  timeout_agente: {
    titulo: 'Timeout no agente ERP',
    template: '⏱️ Sua consulta demorou mais que o esperado e não pôde ser concluída.\n\nIsso pode acontecer em consultas complexas ou com grande volume de dados. Tente novamente com um período menor ou filtros mais específicos.',
  },
  aguardando_processamento: {
    titulo: 'Aguardando processamento longo',
    template: '⏳ Ainda estamos pesquisando sua informação, aguarde um instante...',
  },
  intencao_desconhecida: {
    titulo: 'Intencao desconhecida',
    template: 'Nao consegui entender exatamente qual consulta voce quer fazer.\n\n{{mensagem}}\n\nTente escrever de forma mais especifica, por exemplo:\n* "Qual o faturamento do ano passado?"\n* "Detalhe o faturamento mes a mes"\n* "Mostre o faturamento por empresa"\n* "Quero a quantidade por produto em abril"\n* "Traga valor e quantidade por cliente"',
  },
  dataset_sem_informacao: {
    titulo: 'Informacao nao disponivel no dataset',
    template: '{{mensagem}}\n\nO dataset disponivel para esta consulta nao possui os campos ou o nivel de detalhe necessario para responder com seguranca.\n\nDeseja consultar outra informacao?',
  },
  ia_cota_esgotada: {
    titulo: 'IA com cota esgotada',
    template: '⚠️ As IAs estao temporariamente indisponiveis ({{provedores}}: cota esgotada).\n\nAguarde alguns minutos e tente novamente.',
  },
  compras_processando: {
    titulo: 'Compras — processando consulta',
    template: '🔍 Consultando os dados de compras no ERP... aguarde um instante.',
  },
  compras_sem_resultado: {
    titulo: 'Compras — sem resultado',
    template: 'Não encontrei registros de compras para essa consulta no período informado. Tente ajustar o período ou os filtros.',
  },
  compras_erro_interpretacao: {
    titulo: 'Compras — não entendeu a pergunta',
    template: 'Não consegui interpretar sua pergunta sobre compras. Pode reformular ou ser mais específico? Por exemplo: "Compras do mês", "Top fornecedores de abril" ou "Compras por produto".',
  },
  compras_cota_esgotada: {
    titulo: 'Compras — IA indisponível',
    template: 'Estou com muitas consultas agora e não consigo processar sua pergunta de compras. Tente novamente em alguns instantes.',
  },
  compras_erro_erp: {
    titulo: 'Compras — erro no ERP',
    template: 'Não consegui buscar essa informação no sistema. Tente um período menor ou filtros mais específicos.',
  },
  numero_nao_autorizado: {
    titulo: 'Numero nao autorizado',
    template: 'Este numero nao esta autorizado a interagir com o IA Command.',
  },
  empresa_ambigua: {
    titulo: 'Escolha de empresa',
    template: 'Para responder sua consulta, preciso saber qual empresa considerar:\n\n{{opcoes_empresas}}\n\nResponda com o número ou o nome da empresa.',
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
