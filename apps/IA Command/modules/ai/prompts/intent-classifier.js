// Constrói o prompt de classificação de intenção com a lista dinâmica
// carregada do banco para a empresa — inclui descrição e frases de exemplo.

function _buildSynonymSection(mensagem, sinonimos) {
  if (!sinonimos || sinonimos.length === 0) return '';

  const msgNorm = mensagem.toLowerCase();

  const porCamada = { intencao: [], filtro: [], coluna: [] };
  sinonimos.forEach(s => { if (porCamada[s.camada]) porCamada[s.camada].push(s); });

  const hints = sinonimos.filter(s => s.termo && msgNorm.includes(s.termo.toLowerCase()));

  const linhas = [
    '## Dicionário de termos desta empresa',
    'Use as equivalências abaixo ao classificar a intenção e extrair filtros.',
    'Se um termo não estiver nesta lista, use seu conhecimento geral para inferir.',
    '',
  ];

  if (porCamada.intencao.length) {
    linhas.push('### Sinônimos de intenção (use para escolher a intenção correta)');
    porCamada.intencao.forEach(s => linhas.push(`- "${s.termo}" → trate como "${s.equivalencia}"`));
    linhas.push('');
  }
  if (porCamada.coluna.length) {
    linhas.push('### Sinônimos de coluna (use para interpretar o que o usuário quer medir)');
    porCamada.coluna.forEach(s => linhas.push(`- "${s.termo}" → campo ${s.equivalencia}`));
    linhas.push('');
  }
  if (porCamada.filtro.length) {
    linhas.push('### Sinônimos de filtro (use para normalizar valores de filtros)');
    porCamada.filtro.forEach(s => {
      const ctx = s.contexto ? ` (filtros.${s.contexto})` : '';
      linhas.push(`- "${s.termo}" → valor real: "${s.equivalencia}"${ctx}`);
    });
    linhas.push('');
  }
  if (hints.length) {
    linhas.push('### Termos desta empresa detectados na mensagem atual');
    hints.forEach(s => linhas.push(`- "${s.termo}" encontrado → equivale a "${s.equivalencia}" (${s.camada})`));
    linhas.push('');
  }

  return linhas.join('\n');
}

function _buildContextSection(ctx) {
  if (!ctx || !ctx.intencao || ctx.intencao === 'desconhecido') return '';
  const linhas = [
    '## Contexto da pergunta anterior',
    'O usuário está dando continuidade a uma conversa. Use este contexto para interpretar',
    'campos ausentes na nova mensagem (intenção, período, filtros).',
    '',
    `- Intenção anterior: "${ctx.intencao}"`,
  ];
  const tipo = ctx.periodo?.tipo;
  if (tipo && tipo !== 'nenhum') {
    const extra = ctx.periodo.dataInicio
      ? ` (${ctx.periodo.dataInicio} → ${ctx.periodo.dataFim})`
      : '';
    linhas.push(`- Período anterior: ${tipo}${extra}`);
  }
  const filtros = Object.entries(ctx.filtros || {}).filter(([, v]) => v);
  if (filtros.length) linhas.push(`- Filtros anteriores: ${filtros.map(([k, v]) => `${k}="${v}"`).join(', ')}`);
  if (ctx.agrupar_por) linhas.push(`- Agrupamento anterior: ${ctx.agrupar_por}`);
  linhas.push('');
  linhas.push('IMPORTANTE: se a nova mensagem não mencionar intenção, período ou filtros explicitamente,');
  linhas.push('herde os valores acima. Se mencionar, use os novos valores.');
  linhas.push('Exceção: "mês a mês" / "por mês" / "por ano" em continuação = agrupar_por temporal,');
  linhas.push('mantendo o período anterior — NÃO é um novo período de comparação.');
  linhas.push('');
  return linhas.join('\n');
}

function buildPrompt(mensagem, intencoes = [], sinonimos = [], contextoAnterior = null) {
  const _hoje = new Date();
  const _dataHoje = `${_hoje.getFullYear()}-${String(_hoje.getMonth()+1).padStart(2,'0')}-${String(_hoje.getDate()).padStart(2,'0')}`;
  const _anoAtual = _hoje.getFullYear();
  const _anoPassado = _anoAtual - 1;
  // intencoes = [{nome, descricao, frases_exemplo}, ...]
  const listaFormatada = intencoes.map(i => {
    let bloco = `- ${i.nome}`;
    if (i.descricao?.trim()) {
      bloco += `\n  Descrição: ${i.descricao.trim()}`;
    }
    if (i.frases_exemplo?.trim()) {
      const exemplos = i.frases_exemplo
        .split('\n')
        .map(f => f.trim())
        .filter(Boolean)
        .slice(0, 6);
      if (exemplos.length) {
        bloco += `\n  Exemplos de frases: ${exemplos.map(f => `"${f}"`).join(', ')}`;
      }
    }
    return bloco;
  }).join('\n');

  const secaoSinonimos = _buildSynonymSection(mensagem, sinonimos);
  const secaoContexto  = _buildContextSection(contextoAnterior);

  const prompt = [
    'Você é um classificador de intenções para um assistente de ERP via WhatsApp em português brasileiro.',
    'Analise a mensagem do usuário e retorne um JSON identificando a intenção e os parâmetros da consulta.',
    '',
    ...(secaoContexto  ? [secaoContexto]  : []),
    ...(secaoSinonimos ? [secaoSinonimos] : []),
    '## Intenções disponíveis para esta empresa',
    listaFormatada || '(nenhuma intenção cadastrada)',
    '- desconhecido',
    '',
    '## Estrutura do JSON de resposta',
    '{',
    '  "intencao": string,        // exatamente um dos nomes listados acima, ou "desconhecido"',
    '  "periodo": {',
    '    "tipo": string,          // ver lista de tipos abaixo',
    '    "meses_atras": number|null,',
    '    "dias": number|null,     // preenchido quando tipo="ultimos_N_dias" (ex: 7, 15, 30, 90)',
    '    "mes": number|null,      // 1-12, preenchido quando tipo="comparacao_mesmo_mes" ou "comparacao_acumulado_mes"',
    '    "ano_base": number|null, // preenchido quando tipo="comparacao_mensal_entre_anos"',
    '    "ano_comparacao": number|null, // preenchido quando tipo="comparacao_mensal_entre_anos"',
    '    "ano_ref": "atual"|"anterior"|null,  // para trimestre/semestre nomeado',
    '    "data_inicio": string|null,  // "YYYYMMDD", apenas quando tipo="personalizado"',
    '    "data_fim": string|null      // "YYYYMMDD", apenas quando tipo="personalizado"',
    '  },',
    '  "filtros": {               // campos extras extraídos da mensagem',
    '    "cliente": string|null,',
    '    "vendedor": string|null,',
    '    "fornecedor": string|null,',
    '    "produto": string|null,',
    '    "filial": string|null,',
    '    "status": string|null',
    '  },',
    '  "agrupar_por": string|null,   // dimensão de agrupamento: "cliente", "produto", "vendedor", "fornecedor", "empresa", "mes", "ano" — preencher quando o usuário pede breakdown',
    '  "operacao_analitica": {       // use quando o usuario pedir media/soma explicitamente',
    '    "operacao": "soma"|"media"|null,',
    '    "granularidade": "dia"|"mes"|"ano"|null,',
    '    "metrica": string|null      // ex: "faturamento", "quantidade", "custo", "margem"',
    '  }|null,',
    '  "ordenar_por": string|null,   // ex: "valor:desc"',
    '  "limite": number|null,        // para "top 5", "os 10 maiores", etc.',
    '  "confianca": number,          // 0.0 a 1.0',
    '  "precisa_confirmacao": boolean,',
    '  "origem": "texto"',
    '}',
    '',
    '## Tipos de período disponíveis',
    'hoje | ontem | esta_semana | semana_anterior | mes_atual | mes_anterior | ano_atual | ano_anterior',
    'ultimo_trimestre | primeiro_trimestre | segundo_trimestre | terceiro_trimestre | quarto_trimestre (preencher ano_ref)',
    'primeiro_semestre | segundo_semestre (preencher ano_ref)',
    'ultimos_N_dias (preencher dias) | comparacao_anual | comparacao_mensal | comparacao_mensal_entre_anos (preencher ano_base/ano_comparacao) | comparacao_mesmo_mes (preencher mes)',
    'comparacao_acumulado_mes (preencher mes) | personalizado (preencher data_inicio/data_fim) | nenhum',
    '',
    'Regra especifica: quando o usuario pedir comparar "mes a mes" entre dois anos explicitos, use comparacao_mensal_entre_anos, ano_base=primeiro ano e ano_comparacao=segundo ano.',
    'Exemplo: "comparar faturamento mes a mes do ano de 2025 com o ano de 2026" -> comparacao_mensal_entre_anos, ano_base=2025, ano_comparacao=2026.',
    '',
    '## Regras de classificação',
    '',
    '1. TOLERÂNCIA: aceite abreviações, erros de digitação e linguagem informal.',
    '   - "fat" = faturamento, "qtd" = quantidade, "vlr" = valor, "cli" = cliente, "vend" = vendedor',
    '   - "d hoje" = de hoje, "p esse mes" = para esse mês, "ult trim" = último trimestre',
    '   - Erros comuns: "faturamente", "faturameto", "faturamnto" → faturamento',
    '',
    '   Atalhos de período sem artigo — interprete sempre como o período ATUAL:',
    '   - "fat mes" / "fat do mes" / "fat mes atual" → mes_atual',
    '   - "fat ano" / "fat do ano" / "fat ano atual" → ano_atual',
    '   - "fat semana" / "fat da semana" → esta_semana',
    '   - "fat hoje" / "fat d hoje" → hoje',
    '   - "fat ontem" → ontem',
    '   - "fat trim" / "fat trimestre" → ultimo_trimestre',
    '   - Combinados com agrupamento: "fat mes por produto" → mes_atual + agrupar_por="produto"',
    '   - Combinados com agrupamento: "fat ano por cliente" → ano_atual + agrupar_por="cliente"',
    '   - Combinados com agrupamento: "fat semana por vendedor" → esta_semana + agrupar_por="vendedor"',
    '',
    '2. FRASES DE EXEMPLO têm prioridade máxima. Se a mensagem é variação de um exemplo cadastrado,',
    '   use aquela intenção mesmo que a correspondência não seja literal.',
    '',
    '3. DESCONHECIDO: use quando a mensagem não corresponder a nenhuma intenção com clareza.',
    '   Nunca force um match duvidoso — é melhor retornar "desconhecido" com confianca < 0.5.',
    '',
    '4. AMBIGUIDADE DE PERÍODO — regras de desempate:',
    '   REGRA PRINCIPAL: tipos "comparacao_*" SÓ devem ser usados quando a mensagem contiver',
    '   explicitamente palavras de comparação: "vs", "versus", "contra", "comparar", "comparativo",',
    '   "comparado", "com o mesmo período", "ano a ano", "mês a mês".',
    '   Sem essas palavras → use personalizado, mes_anterior, ano_anterior, etc.',
    '',
    '   a. "mês anterior" sozinho = mes_anterior. Com agrupamento:',
    '      Ex: "fat do mês anterior por produto" → mes_anterior, agrupar_por="produto"',
    '      Ex: "top 5 clientes do mês passado" → mes_anterior, agrupar_por="cliente", limite=5',
    '      Ex: "fat do mês passado por vendedor" → mes_anterior, agrupar_por="vendedor"',
    '   b. Mês específico SEM palavra de comparação = personalizado (apenas aquele mês, de um único ano)',
    '      Ano passado:',
    `      Ex: "fat de maio do ano passado" → personalizado, data_inicio="${_anoPassado}0501", data_fim="${_anoPassado}0531"`,
    `      Ex: "fat de março do ano passado por produto" → personalizado, data_inicio="${_anoPassado}0301", data_fim="${_anoPassado}0331", agrupar_por="produto"`,
    `      Ex: "fat de janeiro do ano passado por cliente" → personalizado, data_inicio="${_anoPassado}0101", data_fim="${_anoPassado}0131", agrupar_por="cliente"`,
    `      Ex: "fat de abril do ano passado por vendedor" → personalizado, data_inicio="${_anoPassado}0401", data_fim="${_anoPassado}0430", agrupar_por="vendedor"`,
    '      Ano atual:',
    `      Ex: "fat de março deste ano" → personalizado, data_inicio="${_anoAtual}0301", data_fim="${_anoAtual}0331"`,
    `      Ex: "fat de fevereiro deste ano por produto" → personalizado, data_inicio="${_anoAtual}0201", data_fim="${_anoAtual}0228", agrupar_por="produto"`,
    `      Ex: "fat de janeiro deste ano por cliente" → personalizado, data_inicio="${_anoAtual}0101", data_fim="${_anoAtual}0131", agrupar_por="cliente"`,
    '',
    '   b2. Acumulado de um único ano SEM palavra de comparação = personalizado (jan até o mês alvo)',
    '      Ano passado:',
    `      Ex: "fat acumulado até maio do ano passado" → personalizado, data_inicio="${_anoPassado}0101", data_fim="${_anoPassado}0531"`,
    `      Ex: "fat acumulado até março do ano passado por produto" → personalizado, data_inicio="${_anoPassado}0101", data_fim="${_anoPassado}0331", agrupar_por="produto"`,
    `      Ex: "fat de janeiro a abril do ano passado por vendedor" → personalizado, data_inicio="${_anoPassado}0101", data_fim="${_anoPassado}0430", agrupar_por="vendedor"`,
    '      Ano atual:',
    `      Ex: "fat acumulado até março deste ano" → personalizado, data_inicio="${_anoAtual}0101", data_fim="${_anoAtual}0331"`,
    `      Ex: "fat acumulado até abril deste ano por cliente" → personalizado, data_inicio="${_anoAtual}0101", data_fim="${_anoAtual}0430", agrupar_por="cliente"`,
    `      Ex: "fat de janeiro a maio deste ano por produto" → personalizado, data_inicio="${_anoAtual}0101", data_fim="${_anoAtual}0531", agrupar_por="produto"`,
    '   c. "[mês] deste ano vs [mês] do ano passado" COM palavra de comparação = comparacao_mesmo_mes',
    '      Ex: "fat de maio deste ano vs maio do ano passado" → comparacao_mesmo_mes, mes=5',
    '      Ex: "comparativo de março com março anterior" → comparacao_mesmo_mes, mes=3',
    '   d. "anterior" sem mês nomeado junto = mes_anterior',
    '   e. Dois anos explícitos diferentes COM comparação → comparacao_anual (sem mês) ou comparacao_mesmo_mes (com mês).',
    '   f. "ano a ano" com mês nomeado → comparacao_mesmo_mes. Sem mês → comparacao_anual.',
    '   g. "mês a mês" → comparacao_mensal.',
    '   h. "acumulado até [mês]", "jan a [mês]", "de janeiro até [mês]", "YTD até [mês]" com comparação entre anos → comparacao_acumulado_mes com mes=[mês alvo].',
    '      Ex: "comparativo acumulado do ano passado até maio" → comparacao_acumulado_mes, mes=5',
    '      Ex: "jan a abril deste ano vs ano passado" → comparacao_acumulado_mes, mes=4',
    '      ATENÇÃO: "acumulado até maio" NÃO é o mesmo que "apenas maio". É janeiro+fev+mar+abr+mai somados.',
    '',
    '5. FILTROS: extraia entidades mesmo escritas de forma informal.',
    '   - "do cliente João" / "da empresa ACME" → filtros.cliente',
    '   - "vendedor 03" / "rep Carlos" / "pelo vendedor X" → filtros.vendedor',
    '   - "fornecedor ACME" / "do fornecedor X" / "compra do forn. Y" → filtros.fornecedor',
    '   - "produto aço 1020" / "item X-50" / "referência 001" → filtros.produto',
    '   - "filial SP" / "unidade Rio" / "loja 02" → filtros.filial',
    '',
    '6. AGRUPAMENTO: preencha "agrupar_por" quando o usuário pedir breakdown por uma dimensão.',
    '   REGRA CRÍTICA: "agrupar_por" é independente do período — funciona com QUALQUER tipo de período.',
    '   Sempre extraia o agrupamento mesmo quando o período for mes_anterior, mes_atual, ano_anterior, etc.',
    '',
    '   Dimensões reconhecidas:',
    '   - "por produto", "por negócio", "detalhado por produto" → agrupar_por = "produto"',
    '   - "por cliente", "ranking de clientes", "quem mais comprou" → agrupar_por = "cliente"',
    '   - "por vendedor", "breakdown por vendedor", "quem mais vendeu" → agrupar_por = "vendedor"',
    '   - "por fornecedor", "ranking de fornecedores", "top fornecedores" → agrupar_por = "fornecedor"',
    '   - "por empresa", "por filial", "por unidade" → agrupar_por = "empresa"',
    '   - "por mês", "mês com maior faturamento", "melhor mês", "ranking mensal" → agrupar_por = "mes"',
    '   - "por ano", "ano com maior faturamento", "melhor ano", "ranking anual" → agrupar_por = "ano"',
    '   - Sem pedido explícito → agrupar_por = null (retorna total consolidado)',
    '',
    '   O padrão "período + por dimensão" funciona com QUALQUER combinação. Exemplos:',
    '   - "fat do mês por produto" → mes_atual, agrupar_por="produto"',
    '   - "fat do ano por cliente" → ano_atual, agrupar_por="cliente"',
    '   - "top 5 clientes do mês passado" → mes_anterior, agrupar_por="cliente", limite=5',
    '   - "quem mais vendeu esse mês" → mes_atual, agrupar_por="vendedor"',
    '   - "fat do Q1 por produto" → primeiro_trimestre, ano_ref="atual", agrupar_por="produto"',
    '   - "fat dos últimos 7 dias por produto" → ultimos_N_dias, dias=7, agrupar_por="produto"',
    '   - "qual o mês com maior faturamento em 2025" → personalizado 20250101-20251231, agrupar_por="mes", ordenar_por="faturamento:desc", limite=1',
    '   - "qual o mês com menor faturamento em 2026" → personalizado 20260101-20261231, agrupar_por="mes", ordenar_por="faturamento:asc", limite=1',
    '',
    '7. LIMITE: extraia número quando houver ranking ou top-N. Aceite números por extenso.',
    '   - "top 5 clientes", "os 10 mais vendidos", "5 maiores" → limite = 5 ou 10',
    '   - "cinco maiores", "dez produtos", "três clientes" → limite = 5, 10, 3',
    '   - "vinte mais vendidos", "quinze fornecedores" → limite = 20, 15',
    '',
    '7b. OPERACOES ANALITICAS: quando o usuario pedir media, preencha operacao_analitica.',
    '   - "media mensal faturado no ano de 2026" -> operacao="media", granularidade="mes", metrica="faturamento"',
    '   - "media de faturamento anual" -> operacao="media", granularidade="ano", metrica="faturamento"',
    '   - "quanto faturei em media por mes" -> operacao="media", granularidade="mes", metrica="faturamento"',
    '   - "media diaria de vendas" -> operacao="media", granularidade="dia", metrica="faturamento"',
    '   Importante: media de faturamento NAO e ticket medio. Ticket medio so deve ser usado quando o usuario falar ticket, nota media ou valor medio por nota.',
    '   Nao crie uma nova intencao para media se ja existir uma intencao de faturamento; use a mesma intencao e preencha operacao_analitica.',
    '',
    `## Data de referência`,
    `Hoje é ${_dataHoje}. Ano atual: ${_anoAtual}. Ano passado: ${_anoPassado}.`,
    `Use SEMPRE essas referências ao calcular datas relativas como "ano passado", "mês passado", "este mês", etc.`,
    '',
    '8. TRIMESTRES E SEMESTRES: use os tipos específicos e preencha ano_ref.',
    '   - ano_ref="atual" quando não mencionar ano ou disser "deste ano", "atual"',
    '   - ano_ref="anterior" quando disser "do ano passado", "anterior", "passado"',
    `   - "Q1 do ano passado" → primeiro_trimestre, ano_ref="anterior"`,
    `   - "segundo trimestre deste ano" → segundo_trimestre, ano_ref="atual"`,
    `   - "primeiro semestre do ano passado" → primeiro_semestre, ano_ref="anterior"`,
    `   - "H2 deste ano" → segundo_semestre, ano_ref="atual"`,
    '',
    '9. ÚLTIMOS N DIAS: preencha dias com o número extraído da mensagem.',
    '   - "últimos 7 dias" → ultimos_N_dias, dias=7',
    '   - "últimas 2 semanas" → ultimos_N_dias, dias=14',
    '   - "últimos 30 dias" → ultimos_N_dias, dias=30',
    '   - "últimos 3 meses em dias" ou "90 dias" → ultimos_N_dias, dias=90',
    '   - "últimos dois anos" em contexto mensal → personalizado com 24 meses calendário, não use todo o histórico disponível',
    '   - "últimos 24 meses" → personalizado com 24 meses calendário',
    '   Exemplo com data de referência em maio/2026: "média mensal dos últimos dois anos" → data_inicio="20240601", data_fim="20260531"',
    '',
    '10. COMPARAÇÃO GENÉRICA "vs mesmo período":',
    '   Quando o usuário pedir comparação sem especificar o tipo, infira pelo contexto:',
    '   - "fat do mês vs mesmo período do ano passado" → comparacao_mensal',
    '   - "fat do ano vs ano passado" ou "fat acumulado deste ano vs ano passado" → comparacao_acumulado_mes, mes=mês atual',
    '   - "fat de hoje vs ontem" → personalizado (calcule ambos os dias)',
    '   - "fat desta semana vs semana passada" → comparacao_mensal (use semanas como janela)',
    '',
    '11. PERSONALIZADO: calcule datas explícitas usando a data de referência acima. Meses por extenso:',
    '   jan=01 fev=02 mar=03 abr=04 mai=05 jun=06 jul=07 ago=08 set=09 out=10 nov=11 dez=12',
    '   Exemplos (considerando data de referência acima):',
    `   - "janeiro a março do ano passado" → data_inicio="${_anoPassado}0101", data_fim="${_anoPassado}0331"`,
    `   - "de março a junho deste ano" → data_inicio="${_anoAtual}0301", data_fim="${_anoAtual}0630"`,
    `   - "último trimestre do ano passado" → data_inicio="${_anoPassado}1001", data_fim="${_anoPassado}1231"`,
    '',
    `## Mensagem do usuário`,
    `"${mensagem.replace(/"/g, '\\"')}"`,
    '',
    'Responda SOMENTE com o JSON. Sem markdown, sem explicações, sem texto adicional.',
  ].join('\n');

  return prompt;
}

module.exports = { buildPrompt, buildSynonymSection: _buildSynonymSection, buildContextSection: _buildContextSection };
