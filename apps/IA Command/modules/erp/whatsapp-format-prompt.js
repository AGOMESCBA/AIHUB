'use strict';

// Engine universal de formatação de mensagens WhatsApp para todos os módulos ERP.
// Importado por schemas legados e pelo runner IA-OWNER para formatacao de respostas.

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT UNIVERSAL
// ─────────────────────────────────────────────────────────────────────────────

const WHATSAPP_FORMAT_SYSTEM_PROMPT = `
Voce formata resultados de consultas do ERP para mensagens de WhatsApp.

## Regras de Formatacao — SIGA EXATAMENTE, SEM VARIACOES

### 1. Negrito e Markdown
Use sempre *texto* (asterisco SIMPLES). NUNCA use **texto** (asterisco duplo).

### 2. Mascara de Dados Obrigatoria
- Valores monetarios: R$ 1.234,56 (padrao pt-BR, sempre com simbolo R$).
  Valores negativos: mantenha o sinal de menos antes do simbolo — ex: -R$ 1.234,56. NUNCA remova o sinal negativo.
- Quantidades/Unidades: separador de milhar pt-BR sem casas decimais quando forem inteiros (ex: 1.250 pecas).
- Percentuais: 2,5% (virgula decimal, padrao pt-BR).

### 3. Hierarquia Visual de Tres Niveis

*Nivel 1 — Contexto* (aparece uma unica vez no topo da resposta):
  Identifica o conjunto de dados: empresa, modulo, periodo e filtros ativos.
  Emojis permitidos neste nivel: 🏢 empresa | 💰 financeiro | 📦 compras/estoque | 📊 relatorio geral.
  Quando o prompt incluir "Contexto ativo da consulta", inclua OBRIGATORIAMENTE essas informacoes na linha de Nivel 1.
  Exemplo com filtro: "💰 Faturamento — Jan/2026 a Jun/2026 | Cliente: CETIQT"
  Exemplo sem filtro: "💰 Faturamento — Ano 2026"

*Nivel 2 — Agrupador Principal* (cabecalho de cada bloco):
  A dimensao de quebra: tempo, categoria, regiao, entidade, etc.
  Emoji OBRIGATORIO conforme o tipo do agrupador:
    🗓  → tempo (mes, ano, semana, data, periodo)
    📦  → categoria/grupo/produto/almoxarifado/natureza
    👤  → pessoa (vendedor, cliente, fornecedor, representante)
    📍  → geografico (estado, cidade, regiao, UF, filial)
    🏦  → banco/conta/carteira
    📋  → qualquer outro agrupador generico

*Nivel 3 — Itens do Bloco* (lista numerada interna de cada bloco):
  Os registros individuais dentro do bloco do Nivel 2.
  OBRIGATORIO: 2 espacos de recuo antes do numero sequencial.
  Formato de cada linha: "  N. *Rotulo*: [valor]"

### 4. Algoritmo de Agrupamento — PROIBICOES ABSOLUTAS

REGRA 1 — SEM REDUNDANCIA DE CABECALHO:
  O valor do Agrupador Principal (Nivel 2) SO aparece UMA VEZ como cabecalho do bloco.
  E TERMINANTEMENTE PROIBIDO repetir o valor do agrupador dentro das linhas do Nivel 3.
  ERRADO:
    🗓 *Maio / 2026*
      1. *Maio 2026*: R$ 1.525,00   <- PROIBIDO: repete o agrupador no item
  CERTO:
    🗓 *Maio / 2026*
      1. *ALELO*: R$ 1.525,00

REGRA 2 — BLOCO UNICO POR VALOR:
  Cada valor distinto do Nivel 2 cria UM unico bloco.
  Dois registros do mesmo mes/categoria/estado NUNCA abrem dois blocos separados — eles ficam no mesmo bloco.

REGRA 3 — SUBTOTAL OBRIGATORIO:
  Ao final da lista de itens de cada bloco (Nivel 2), exiba o subtotal daquele bloco.
  Formato da linha de subtotal: "🧾 *Subtotal*: [valor]"

REGRA 4 — SEPARACAO VISUAL:
  Insira sempre uma linha em branco entre blocos de Nivel 2 consecutivos.

### 5. Estrutura-Padrao de Saida

[Nivel 1 — contexto, uma unica linha]

[emoji] *[Agrupador A]*
  1. *[Item 1]*: R$ X.XXX,XX
  2. *[Item 2]*: R$ X.XXX,XX
🧾 *Subtotal*: R$ X.XXX,XX

[emoji] *[Agrupador B]*
  1. *[Item 3]*: R$ X.XXX,XX
🧾 *Subtotal*: R$ X.XXX,XX

*Total Geral*: R$ X.XXX,XX

### 6. Numeros e Calculos — REGRA CRITICA
Os subtotais e totais ja foram calculados pelo sistema backend e estao marcados como
"calculado pelo sistema" no prompt abaixo. NUNCA recalcule esses valores — use-os EXATAMENTE
como fornecidos. Sua unica responsabilidade e formata-los no padrao pt-BR correto.

### 7. Regras Gerais
- Maximo 20 itens em listas. Se houver mais, exiba os 20 de maior valor e indique "... e mais N".
- Sem saudacoes, rodape ou mencoes a SQL, banco de dados, tabelas ou campos tecnicos.
- Linguagem: portugues do Brasil, tom profissional e amigavel.

### 7a. Contextualizacao da Resposta — OBRIGATORIO para perguntas especificas
Quando a pergunta usar palavras como "qual foi", "qual e", "qual o", "quem teve", "quem tem", "qual cliente", "qual mes", "qual produto", "qual vendedor", "qual fornecedor", ou pedir superlativo (maior, menor, mais alto, mais baixo, melhor, pior, top, primeiro, ultimo):
EXIBA UMA LINHA DE RESPOSTA DIRETA antes dos blocos de dados. Essa linha responde a pergunta do usuario em linguagem natural, identificando o resultado encontrado.

Exemplos obrigatorios:
  - "Qual foi o mes com maior faturamento?" → "O mes com maior faturamento foi *Agosto/2025* com R$ 709.709,49."
  - "Qual cliente comprou mais?" → "O cliente que mais comprou foi *ACME LTDA* com R$ 150.000,00."
  - "Qual vendedor teve maior comissao?" → "O vendedor com maior comissao foi *JOAO SILVA* com R$ 5.200,00."
  - "Qual produto mais vendido?" → "O produto mais vendido foi *PARAFUSO M8* com 1.250 un."
  - "Qual o mes com menor faturamento?" → "O mes com menor faturamento foi *Fevereiro/2025* com R$ 42.300,00."
  - "Qual o mes com MAIOR e MENOR faturamento?" → "O mes com maior faturamento foi *Agosto/2025* com R$ 709.709,49. O mes com menor faturamento foi *Fevereiro/2026* com R$ 45.230,00." (identifique ambos os extremos a partir do conjunto completo de dados recebidos — NUNCA diga "nao foi informado" se os dados estiverem presentes)

Quando a resposta tiver dados de MULTIPLAS empresas (multiempresa), use a linha de contexto no consolidado:
  - "O mes com maior faturamento consolidado foi *Agosto/2025* com R$ 879.605,99."
- Campo ano_mes no formato AAAAMM: 202601=Janeiro, 202605=Maio, 202612=Dezembro.
  NUNCA some 1 ao mes — o valor ja e 1-indexado.

### 8. Multiplas metricas por item — EXIBIR TODAS, NUNCA OMITIR

Quando um item tiver mais de uma metrica (ex: "ACME — faturamento: 15000 | quantidade: 75 | valor_medio: 200"),
exiba TODAS as metricas na saida. NUNCA omita nenhuma coluna fornecida nos dados.

Rotulos amigaveis para cada metrica — use sempre pt-BR:
  - faturamento / total / receita → R$ X.XXX,XX (valor principal, sem rotulo ou rotulo "Fat.")
  - quantidade / quant / qtd → N un (sem decimal quando inteiro; ex: "75 un")
  - valor_medio / ticket_medio / preco_medio / media_venda → R$ X,XX/un (preco unitario medio)
  - saldo → R$ X.XXX,XX (pode ser negativo — nunca remova o sinal de menos)
  - percentual / pct / perc → X,X%
  - crescimento / variacao / variação / cresc → label "Crescimento:" + X,X% (se valor for ZERO: exiba "N/A" — indica ausencia de periodo anterior para comparar; NUNCA exiba "0,00%" para crescimento)

Exemplo de linha com tres metricas (faturamento + quantidade + preco medio):
  1. *ACME LTDA*: R$ 15.000,00 | 75 un | R$ 200,00/un

Linha de subtotal/total com tres metricas:
  🧾 *Subtotal*: R$ 15.000,00 | 75 un | R$ 200,00/un

Para resultados sem agrupamento (resposta de linha unica), liste cada metrica em linha propria:
  💰 *Faturamento*: R$ 500.000,00
  📦 *Quantidade*: 2.500 un
  🏷 *Preco medio*: R$ 200,00/un

### 9. Identificadores Internos — NUNCA Exibir
Colunas cujo nome indica um codigo ou identificador interno (cod_cliente, loja_cliente, codigo_cliente, loja_fornecedor, cod_fornecedor, cod_produto, cod_vendedor, etc.) NAO devem aparecer na mensagem final ao usuario. Esses campos sao tecnicos e sem significado para quem recebe o WhatsApp. Exiba APENAS o nome/descricao da entidade (ex: "ACME LTDA", "JEAN DUARTE") — nunca o codigo bruto (ex: "000123", "01").
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// DETECÇÃO DE COLUNAS (heurística semântica por nome de campo)
// ─────────────────────────────────────────────────────────────────────────────

const _RE_TEMPORAL = /^(ano_mes|competencia|competência|aaaa_mm|aaaamm|referencia|referência|periodo|período|mes|month|dia|data|vencimento|vencto|vencto_real|dt_venc|data_venc|data_vencimento|dt_vencimento|emissao|emissão|data_emissao|data_emissão|dt_emissao|data_entrada|dt_entrada)$/i;
// Nomes ambíguos que precisam de validação pelo valor para confirmar que são datas
const _RE_TEMPORAL_VALIDATE = /^(mes|month|dia|data|vencimento|vencto|vencto_real|emissao|emissão|data_entrada|dt_entrada)$/i;
const _RE_ENTIDADE = /^(fornecedor|nm_forn|ds_forn|nome_forn|nome_fornecedor|razao_social|razao|cliente|nm_cli|ds_cli|nome_cli|nome_cliente|vendedor|nm_vend|ds_vend|nome_vend|nome_vendedor|representante|estado|uf|regiao|região|filial|grupo|grupo_produto|grupo_de_produto|categoria|produto|descricao|descrição|descricao_produto|nome_produto|almoxarifado|banco|natureza)$/i;
// Colunas companheiras da entidade principal (ex: unidade de medida junto ao produto)
// Exibidas junto ao valor como "1.127,23 H" em vez de genérico "un"
const _RE_COMPANION = /^(unidade|unid|um|medida|un_medida|un_med|unidade_de_medida|un_de_medida|und_medida|unidade_medida|unit|ume)$/i;
// Detecção por valor: coluna é companion se todos os valores forem códigos curtos em maiúsculas (H, UN, KG…)
function _isCompanionByValue(scanRows, k) {
  const sample = scanRows.map(r => String(r[k] || '').trim()).filter(Boolean);
  return sample.length >= 2 && sample.every(v => /^[A-Z]{1,6}$/.test(v));
}
const _RE_SKIP_NUM  = /^(id|cod|codigo|código|num|seq|ano|mes|dia|dt|data|serie|série|doc|loja|tipo|status|cfop|cst|filial|uf|estado|vencimento|vencto|emissao|emissão)/i;
// Colunas auxiliares de cálculo (ex: faturamento_ano_anterior) — excluídas do output
const _RE_SKIP_CALC = /_anterior$/i;

function _arredondar2(v) {
  return Math.round((parseFloat(v) || 0) * 100) / 100;
}

// Colunas que representam médias/razões — nunca devem ser somadas no subtotal/total
const _RE_RATIO_COL = /^(valor_medio|ticket_medio|preco_medio|media_venda|media_por_item|ticket_medio_nf|valor_medio_nf|valor_medio_item)$/i;

// Aliases aceitos para numerador (faturamento) e denominador (quantidade) das razões
const _FAT_ALIASES = ['faturamento', 'total', 'valor', 'receita', 'valor_total', 'fat'];
const _QTD_ALIASES = ['quantidade', 'quant', 'qtd', 'qt'];

// Recalcula colunas de razão a partir de faturamento/quantidade já somados.
// Se as colunas-base não estiverem disponíveis, preserva o valor original
// em vez de deletar — evita que a métrica desapareça quando a IA omite as bases.
function _recalcularRatios(totaisObj, numCols) {
  for (const col of numCols) {
    if (!_RE_RATIO_COL.test(col)) continue;
    let fat = NaN, qtd = NaN;
    for (const k of _FAT_ALIASES) { if (totaisObj[k] !== undefined) { fat = parseFloat(totaisObj[k]); break; } }
    for (const k of _QTD_ALIASES) { if (totaisObj[k] !== undefined) { qtd = parseFloat(totaisObj[k]); break; } }
    if (!isNaN(fat) && !isNaN(qtd) && qtd !== 0) {
      totaisObj[col] = _arredondar2(fat / qtd);
    }
    // Quando colunas-base ausentes: preserva valor original (não apaga)
  }
}

// Normaliza qualquer representação de data para a chave canônica YYYY-MM-DD (UTC).
// Garante ordenação cronológica correta independente do formato retornado pelo driver SQL.
function _normalizarDataChave(v) {
  if (!v) return '';
  if (v instanceof Date) {
    const ano = v.getUTCFullYear();
    const mes = String(v.getUTCMonth() + 1).padStart(2, '0');
    const dia = String(v.getUTCDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);          // ISO: 2026-05-08T00:00:00Z
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                        // YYYY-MM-DD: ok
  if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`; // YYYYMMDD
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return `${s.slice(6,10)}-${s.slice(3,5)}-${s.slice(0,2)}`; // DD/MM/YYYY
  return s;
}

function _detectarColunas(rows) {
  const firstRow  = Array.isArray(rows) ? (rows[0] || {}) : (rows || {});
  const scanRows  = Array.isArray(rows) ? rows.slice(0, 20) : [firstRow];
  const keys      = Object.keys(firstRow);

  let colTemporal = keys.find(k => {
    if (!_RE_TEMPORAL.test(k)) return false;
    // Nomes ambíguos: validar pelo valor para confirmar que contêm uma data
    if (_RE_TEMPORAL_VALIDATE.test(k)) {
      const raw = firstRow[k];
      if (raw instanceof Date) return true;  // Date object é sempre uma data válida
      const v = String(raw || '');
      // Inteiro 1-12 em coluna chamada "mes" = número de mês (MONTH() do SQL)
      if (/^(mes|month)$/i.test(k) && /^\d{1,2}$/.test(v) && parseInt(v, 10) >= 1 && parseInt(v, 10) <= 12) return true;
      return (
        /^\d{6}$/.test(v) ||              // AAAAMM  (ex: 202605)
        /^\d{8}$/.test(v) ||              // YYYYMMDD (ex: 20260529)
        /^\d{4}-\d{2}-\d{2}/.test(v) ||  // YYYY-MM-DD ou ISO
        /^\d{4}-\d{2}$/.test(v) ||        // AAAA-MM
        /^\d{2}\/\d{2}\/\d{4}$/.test(v)  // DD/MM/YYYY
      );
    }
    return true;
  }) || null;

  let colEntidade = keys.find(k => _RE_ENTIDADE.test(k) && k !== colTemporal) || null;

  // Coluna companheira da entidade: ex. unidade de medida (H, UN, KG) junto ao produto.
  // Detectada apenas quando há entidade principal. Exibida junto ao valor: "1.127,23 H".
  // Prioridade: nome canônico → fallback por valor (códigos curtos em maiúsculas)
  const colCompanion = colEntidade
    ? (keys.find(k => _RE_COMPANION.test(k) && k !== colTemporal && k !== colEntidade)
       || keys.find(k => !_RE_TEMPORAL.test(k) && !_RE_ENTIDADE.test(k) && k !== colTemporal && k !== colEntidade && _isCompanionByValue(scanRows, k))
       || null)
    : null;

  // Caso especial: "faturamento por mês e por ano" — mes com nome/número de mês + ano com 4 dígitos.
  // Ex.: { mes: "Janeiro", ano: 2025, faturamento: X, crescimento: Y }
  //   ou: { mes: 1, ano: 2025, faturamento: X, crescimento: Y }
  // Tratamos mes como bloco externo (colTemporal) e ano como item interno (colEntidade).
  if (!colTemporal && !colEntidade) {
    const mesKey = keys.find(k => {
      if (!/^(mes|nome_mes|mes_nome|month_name)$/i.test(k)) return false;
      const raw = firstRow[k];
      const s   = String(raw || '');
      const isNomeMes  = /^[a-zA-ZÀ-ú]/.test(s);
      const isNumMes   = /^\d{1,2}$/.test(s) && parseInt(s, 10) >= 1 && parseInt(s, 10) <= 12;
      return isNomeMes || isNumMes;
    });
    const anoKey = keys.find(k =>
      /^(ano|year)$/i.test(k) && /^\d{4}$/.test(String(firstRow[k] || ''))
    );
    if (mesKey && anoKey) {
      colTemporal = mesKey;   // mês = bloco externo
      colEntidade = anoKey;   // ano = item interno de cada bloco
    } else if (anoKey) {
      colTemporal = anoKey;   // histórico por ano (sem mês): trata ano como dimensão temporal
    }
  }

  // Varre até 20 linhas para detectar colunas numéricas.
  // Necessário porque algumas colunas (ex: crescimento_percentual) podem ter null nas primeiras linhas.
  const numCols = keys.filter(k => {
    if (k === colTemporal || k === colEntidade) return false;
    if (colCompanion && k === colCompanion) return false;  // companion nunca é numérico
    if (_RE_SKIP_NUM.test(k)) return false;
    if (_RE_SKIP_CALC.test(k)) return false;  // exclui colunas auxiliares como faturamento_ano_anterior
    return scanRows.some(r => {
      const v = r[k];
      return typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(parseFloat(v)));
    });
  });

  return { colTemporal, colEntidade, colCompanion, numCols };
}

// ─────────────────────────────────────────────────────────────────────────────
// CÁLCULO PROGRAMÁTICO DE SUBTOTAIS E TOTAL GERAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recebe as rows brutas do SQL e retorna:
 *   dados       – rows agregadas (desduplicadas por chave composta, máx 50 para IA)
 *   subtotais   – { [valorGrupo]: { col: número } } — por bloco do Nível 2
 *   totalGeral  – { col: número } — soma de todas as linhas
 *
 * Se não detectar dimensões suficientes, retorna rows originais + totalGeral apenas.
 */
// Regex para colunas AAAAMM típicas (ex: competencia, referencia, ano_mes)
const _RE_AAAAMM_COL = /^(competencia|competência|aaaa_mm|aaaamm|referencia|referência|periodo|período|ano_mes)$/i;

function _converterMesAnoParaCompetencia(rows) {
  // Caso 3D: mes (1-12) + ano (4 dígitos) + entidade (ex: vendedor).
  // mes como inteiro não passa na validação de data temporal → converte para competencia AAAAMM
  // para que _detectarColunas ative dupla dimensão (competencia × entidade).
  const keys = Object.keys(rows[0] || {});
  const mesKey = keys.find(k => /^(mes|nome_mes|mes_nome|month_name)$/i.test(k));
  const anoKey = keys.find(k => /^(ano|year)$/i.test(k));
  const entKey = keys.find(k => _RE_ENTIDADE.test(k));
  // Só age quando há entidade E mes+ano numéricos E ainda não há coluna AAAAMM
  if (!mesKey || !anoKey || !entKey) return rows;
  if (keys.some(k => _RE_AAAAMM_COL.test(k))) return rows;
  const sampleMes = String(rows[0][mesKey] || '');
  const sampleAno = String(rows[0][anoKey] || '');
  const isMesNum = /^\d{1,2}$/.test(sampleMes) && parseInt(sampleMes, 10) >= 1 && parseInt(sampleMes, 10) <= 12;
  if (!isMesNum || !/^\d{4}$/.test(sampleAno)) return rows;
  // Remove mes e ano individuais; adiciona competencia AAAAMM
  return rows.map(r => {
    const { [mesKey]: _m, [anoKey]: _a, ...rest } = r;
    const m = parseInt(String(r[mesKey] || ''), 10);
    return { ...rest, competencia: `${String(r[anoKey] || '')}${String(m).padStart(2, '0')}` };
  });
}

function _converterAaamamParaMesAno(rows) {
  // Sem entidade: AAAAMM já ordena cronologicamente como string ('202506' < '202601').
  // _buildListaSimples formata cada chave via _formatarLabelGrupo ('202506' → 'Junho/2025').
  // Converter para {mes, ano} quebraria a ordenação para períodos que cruzam dois anos
  // (o sort lexicográfico de inteiros 1-12 não é calendário).
  // buildFormatDirect exige entidade de qualquer forma, então a conversão nunca beneficia
  // o caminho de dupla-dimensão sem entidade.
  const keys = Object.keys(rows[0] || {});
  if (!keys.some(k => _RE_ENTIDADE.test(k))) return rows;
  // Com entidade: competencia+entidade já é dupla dimensão válida — não converter
  const aaamamCol = keys.find(k => _RE_AAAAMM_COL.test(k));
  if (!aaamamCol) return rows;
  const sample = rows.slice(0, 20).map(r => String(r[aaamamCol] || '').trim());
  if (!sample.every(v => /^\d{6}$/.test(v))) return rows;
  const anos = [...new Set(sample.map(v => v.slice(0, 4)))];
  if (anos.length < 2) return rows;
  // Remove coluna AAAAMM; adiciona mes (inteiro 1-12) e ano (string '2025')
  return rows.map(r => {
    const { [aaamamCol]: _rem, ...rest } = r;
    const compet = String(r[aaamamCol] || '').trim();
    return { ...rest, mes: parseInt(compet.slice(4, 6), 10), ano: compet.slice(0, 4) };
  });
}

function prepararDadosComTotais(rows) {
  if (!rows || rows.length === 0) return { dados: [], subtotais: null, totalGeral: null };

  // 3D: mes+ano+entidade → competencia+entidade (bloco por período × entidade)
  rows = _converterMesAnoParaCompetencia(rows);
  // 2D: competencia multi-ano sem entidade → mes+ano (blocos por mês × ano)
  rows = _converterAaamamParaMesAno(rows);

  const { colTemporal, colEntidade, colCompanion, numCols } = _detectarColunas(rows);

  // Helper: rótulo simples do item (sem companion — companion vai junto ao valor)
  const _itemLabel = (row) => String(row[colEntidade] || '').trim();

  const totalGeral = {};
  for (const col of numCols) {
    totalGeral[col] = _arredondar2(rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0));
  }

  // Sem dimensão de agrupamento — devolve rows originais + total
  if ((!colTemporal && !colEntidade) || !numCols.length) {
    return { dados: rows, subtotais: null, totalGeral: numCols.length ? totalGeral : null };
  }

  // Agrupamento duplo (temporal + entidade): constrói mapa único
  if (colTemporal && colEntidade) {
    const mapa = new Map();
    const subtotais = {};

    for (const row of rows) {
      const chaveGrupo  = _normalizarDataChave(row[colTemporal]);
      const rawEnt      = _itemLabel(row);
      const rawComp     = colCompanion ? String(row[colCompanion] || '').trim() : '';
      const chaveItem   = rawEnt;
      if (!chaveGrupo || !chaveItem) continue;

      // Inclui companion na chave para diferenciar mesmo produto com unidades distintas
      const chaveUnica = colCompanion ? `${chaveGrupo}\x00${rawEnt}\x00${rawComp}` : `${chaveGrupo}\x00${rawEnt}`;
      if (!mapa.has(chaveUnica)) {
        const base = { [colTemporal]: chaveGrupo, [colEntidade]: chaveItem };
        if (colCompanion && rawComp) base[colCompanion] = rawComp;  // armazena unidade no item
        for (const col of numCols) base[col] = 0;
        mapa.set(chaveUnica, base);
      }
      if (!subtotais[chaveGrupo]) {
        subtotais[chaveGrupo] = {};
        for (const col of numCols) subtotais[chaveGrupo][col] = 0;
      }

      const acc = mapa.get(chaveUnica);
      for (const col of numCols) {
        const v = parseFloat(row[col]) || 0;
        acc[col] = _arredondar2(acc[col] + v);
        subtotais[chaveGrupo][col] = _arredondar2(subtotais[chaveGrupo][col] + v);
      }
    }

    // Arredonda subtotais finais e recalcula razões
    for (const g of Object.keys(subtotais)) {
      for (const col of numCols) subtotais[g][col] = _arredondar2(subtotais[g][col]);
      _recalcularRatios(subtotais[g], numCols);
    }
    _recalcularRatios(totalGeral, numCols);

    // Sort: AAAAMM/YYYY-MM-DD ordenam corretamente como strings.
    // Para nomes ou números de mês (ex: "Janeiro" ou 1), ordena pelo índice calendário.
    const _MESES_ORD = ['janeiro','fevereiro','março','marco','abril','maio','junho',
                        'julho','agosto','setembro','outubro','novembro','dezembro'];
    const _mesOrd = (v) => {
      const s = String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      const idx = _MESES_ORD.indexOf(s);
      if (idx >= 0) return idx + 1;
      const n = parseInt(s, 10);
      return (n >= 1 && n <= 12) ? n : 0;
    };
    const dados = [...mapa.values()].sort((a, b) => {
      const va = a[colTemporal], vb = b[colTemporal];
      const ma = _mesOrd(va), mb = _mesOrd(vb);
      if (ma && mb) return ma - mb;
      return String(va) < String(vb) ? -1 : String(va) > String(vb) ? 1 : 0;
    });
    return { dados, subtotais, totalGeral };
  }

  // Agrupamento simples (apenas uma dimensão)
  const dimCol = colTemporal || colEntidade;
  const subtotais = {};
  for (const row of rows) {
    const chave = (dimCol === colTemporal
      ? _normalizarDataChave(row[dimCol])
      : _itemLabel(row));  // rótulo da entidade (produto)
    if (!chave) continue;
    if (!subtotais[chave]) {
      subtotais[chave] = {};
      for (const col of numCols) subtotais[chave][col] = 0;
    }
    for (const col of numCols) {
      subtotais[chave][col] = _arredondar2(subtotais[chave][col] + (parseFloat(row[col]) || 0));
    }
  }

  for (const g of Object.keys(subtotais)) _recalcularRatios(subtotais[g], numCols);
  _recalcularRatios(totalGeral, numCols);

  return { dados: rows, subtotais, totalGeral };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRÉ-ESTRUTURAÇÃO DE BLOCOS (elimina ambiguidade do primeiro bloco para a IA)
// ─────────────────────────────────────────────────────────────────────────────

const _MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function _formatarLabelGrupo(v) {
  const s = String(v || '').trim();
  // AAAAMM → Mês/Ano  (ex: 202605 → Maio/2026)
  if (/^\d{6}$/.test(s)) {
    const ano = s.slice(0, 4);
    const mes = parseInt(s.slice(4, 6), 10);
    if (mes >= 1 && mes <= 12) return `${_MESES[mes - 1]}/${ano}`;
  }
  // YYYYMMDD → DD/MM/YYYY  (ex: 20260529 → 29/05/2026)
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
  }
  // YYYY-MM-DD → DD/MM/YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [ano, mes, dia] = s.split('-');
    return `${dia}/${mes}/${ano}`;
  }
  // AAAA-MM → Mês/Ano
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [ano, mesStr] = s.split('-');
    const mes = parseInt(mesStr, 10);
    if (mes >= 1 && mes <= 12) return `${_MESES[mes - 1]}/${ano}`;
  }
  // Número de mês (1-12) → nome do mês em português
  if (/^\d{1,2}$/.test(s)) {
    const mes = parseInt(s, 10);
    if (mes >= 1 && mes <= 12) return _MESES[mes - 1];
  }
  return s;
}

/**
 * Pré-estrutura dados de agrupamento simples (uma única dimensão) em lista numerada.
 * Usado quando há apenas entidade OU apenas temporal (sem duplo agrupamento).
 * Elimina a ambiguidade da IA ao formatar listas simples de vendedores, fornecedores, etc.
 *
 * Formato de saída (exemplo com vendedor):
 *   1. JEAN DUARTE — valor_comissao: 1346.85
 *   2. LUCINIR CORREIA — valor_comissao: 335.46
 *   ...
 *   Total Geral (calculado pelo sistema): valor_comissao: 2331.67
 *
 * @param {object}   subtotais   – { [chave]: { col: número } }
 * @param {object}   totalGeral  – { col: número } | null
 * @param {string[]} numCols     – colunas numéricas
 * @param {boolean}  ehTemporal  – true → ordena cronologicamente; false → ordena por valor desc
 */
function _buildListaSimples(subtotais, totalGeral, numCols, ehTemporal) {
  const entradas = Object.entries(subtotais);

  if (ehTemporal) {
    entradas.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  } else {
    const colOrdem = numCols[0];
    entradas.sort(([, a], [, b]) => (b[colOrdem] || 0) - (a[colOrdem] || 0));
  }

  const MAX = ehTemporal ? 31 : 20;
  const visiveis = entradas.slice(0, MAX);
  const ocultados = entradas.length - visiveis.length;

  const linhas = [];
  visiveis.forEach(([chave, vals], i) => {
    const label = ehTemporal ? _formatarLabelGrupo(chave) : chave;
    let itemStr;
    if (numCols.length === 1) {
      // Métrica única: "label: valor" — sem o nome da coluna para evitar duplicação pela IA
      itemStr = `  ${i + 1}. ${label}: ${vals[numCols[0]]}`;
    } else {
      const valoresStr = numCols.map(col => `${col}: ${vals[col]}`).join(' | ');
      itemStr = `  ${i + 1}. ${label} — ${valoresStr}`;
    }
    linhas.push(itemStr);
  });

  if (ocultados > 0) {
    linhas.push(`  ... e mais ${ocultados}`);
  }

  if (totalGeral) {
    const totStr = numCols.length === 1
      ? String(totalGeral[numCols[0]])
      : numCols.map(col => `${col}: ${totalGeral[col]}`).join(' | ');
    linhas.push('');
    linhas.push(`Total Geral (calculado pelo sistema): ${totStr}`);
  }

  return linhas.join('\n');
}

/**
 * Pré-estrutura os dados em blocos textuais explícitos.
 * Usado quando há agrupamento duplo (temporal + entidade) para garantir que
 * a IA nunca confunda o nome de uma coluna com o cabeçalho do primeiro bloco.
 *
 * Formato de saída:
 *   --- BLOCO 1: Maio/2026 ---
 *     1. ALELO — saldo: 3375.00
 *     2. AMTU — saldo: 297.00
 *   Subtotal (calculado pelo sistema): saldo: 8377.89
 *
 *   --- BLOCO 2: Junho/2026 ---
 *   ...
 */
function _buildBlocosTexto(dados, subtotais, totalGeral, colTemporal, colEntidade, numCols, colCompanion) {
  // Agrupa por valor temporal mantendo a ordem de inserção (já ordenada)
  const grupos = new Map();
  for (const row of dados) {
    const chave = String(row[colTemporal] || '');
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(row);
  }

  const _RE_QTD_COL = /quantidade|quant|qtd/i;

  const linhas = [];
  let blocoNum = 1;

  for (const [chaveGrupo, items] of grupos) {
    const labelGrupo = _formatarLabelGrupo(chaveGrupo);
    linhas.push(`--- BLOCO ${blocoNum}: ${labelGrupo} ---`);

    items.forEach((item, i) => {
      const labelItem = String(item[colEntidade] || '').trim();
      // Companion (ex: unidade de medida) é exibido junto ao valor numérico
      const itemUnit  = colCompanion ? String(item[colCompanion] || '').trim() : '';
      const valoresStr = numCols.map(col => {
        const val = item[col];
        return (itemUnit && _RE_QTD_COL.test(col)) ? `${col}: ${val} ${itemUnit}` : `${col}: ${val}`;
      }).join(' | ');
      linhas.push(`  ${i + 1}. ${labelItem} — ${valoresStr}`);
    });

    if (subtotais && subtotais[chaveGrupo]) {
      const subStr = numCols.map(col => `${col}: ${subtotais[chaveGrupo][col]}`).join(' | ');
      linhas.push(`  Subtotal (calculado pelo sistema): ${subStr}`);
    }

    linhas.push('');
    blocoNum++;
  }

  if (totalGeral) {
    const totStr = numCols.map(col => `${col}: ${totalGeral[col]}`).join(' | ');
    linhas.push(`Total Geral (calculado pelo sistema): ${totStr}`);
  }

  return linhas.join('\n');
}

/**
 * Pré-estrutura dados em 3 níveis: Mês → Ano → Entidade (ex: vendedor).
 * Usado quando competencia AAAAMM abrange múltiplos anos E há coluna de entidade.
 * Calcula crescimento por entidade programaticamente (não depende do SQL).
 *
 * Formato de saída:
 *   --- BLOCO 1: Janeiro ---
 *     Ano 2025:
 *       1. JEAN DUARTE — valor_comissao: 4785.44
 *       Subtotal 2025 (calculado pelo sistema): valor_comissao: 17848.54
 *     Ano 2026 (vs 2025):
 *       1. JEAN DUARTE — valor_comissao: 5899.04 | crescimento: +23.26%
 *       Subtotal 2026 (calculado pelo sistema): valor_comissao: 12830.54 | crescimento: -28.12%
 */
function _buildBlocosMesAnoEntidade(dados, colTemporal, colEntidade, numCols, totalGeral) {
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                 'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  // Exclui colunas de crescimento/variação — recalculamos aqui
  const _RE_CRESC_COL = /crescimento|variacao|variação|cresc|variacao_pct/i;
  const colsValor = numCols.filter(col => !_RE_CRESC_COL.test(col));
  const primaryCol = colsValor[0];
  if (!primaryCol) return '';

  // Estrutura: mes (MM) → ano (YYYY) → entidade → { col: total }
  const porMes = new Map();
  for (const row of dados) {
    const compet = String(row[colTemporal] || '').trim();
    if (!/^\d{6}$/.test(compet)) continue;
    const mesKey = compet.slice(4, 6);
    const anoKey = compet.slice(0, 4);
    const ent    = String(row[colEntidade] || '').trim();
    if (!ent) continue;
    if (!porMes.has(mesKey)) porMes.set(mesKey, new Map());
    const porAno = porMes.get(mesKey);
    if (!porAno.has(anoKey)) porAno.set(anoKey, new Map());
    const porEnt = porAno.get(anoKey);
    if (!porEnt.has(ent)) { const b = {}; for (const c of colsValor) b[c] = 0; porEnt.set(ent, b); }
    const acc = porEnt.get(ent);
    for (const c of colsValor) acc[c] = _arredondar2(acc[c] + (parseFloat(row[c]) || 0));
  }

  const _pct = (atual, anterior) => {
    if (!anterior) return null;
    const v = ((atual - anterior) / anterior) * 100;
    const s = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return v >= 0 ? `+${s}%` : `-${s}%`;
  };

  const linhas = [];
  let blocoNum = 1;

  for (const [mesKey, porAno] of [...porMes.entries()].sort(([a],[b]) => parseInt(a,10)-parseInt(b,10))) {
    const mesNum   = parseInt(mesKey, 10);
    const labelMes = (mesNum >= 1 && mesNum <= 12) ? MESES[mesNum-1] : mesKey;
    linhas.push(`--- BLOCO ${blocoNum}: ${labelMes} ---`);
    blocoNum++;

    const anosOrdenados = [...porAno.entries()].sort(([a],[b]) => parseInt(a)-parseInt(b));

    anosOrdenados.forEach(([anoKey, porEnt], anoIdx) => {
      const prevPorEnt = anoIdx > 0 ? anosOrdenados[anoIdx-1][1] : null;
      const prevAno    = anoIdx > 0 ? anosOrdenados[anoIdx-1][0] : null;
      const header     = prevAno ? `Ano ${anoKey} (vs ${prevAno}):` : `Ano ${anoKey}:`;
      linhas.push(`  ${header}`);

      const entradas = [...porEnt.entries()].sort(([,a],[,b]) => (b[primaryCol]||0)-(a[primaryCol]||0));
      let subAno = {}; for (const c of colsValor) subAno[c] = 0;

      entradas.forEach(([ent, vals], i) => {
        const valStr = colsValor.map(c => `${c}: ${vals[c]}`).join(' | ');
        let crescStr = '';
        if (prevPorEnt) {
          const prev = prevPorEnt.get(ent);
          if (prev) {
            const p = _pct(vals[primaryCol] || 0, prev[primaryCol] || 0);
            crescStr = ` | crescimento: ${p ?? 'N/A'}`;
          } else {
            crescStr = ' | crescimento: N/A (novo)';
          }
        }
        linhas.push(`    ${i+1}. ${ent} — ${valStr}${crescStr}`);
        for (const c of colsValor) subAno[c] = _arredondar2(subAno[c] + (vals[c] || 0));
      });

      const subStr = colsValor.map(c => `${c}: ${subAno[c]}`).join(' | ');
      let subCresc = '';
      if (prevPorEnt) {
        const prevTotal = [...prevPorEnt.values()].reduce((s, v) => s + (v[primaryCol] || 0), 0);
        const p = _pct(subAno[primaryCol] || 0, prevTotal);
        subCresc = ` | crescimento: ${p ?? 'N/A'}`;
      }
      linhas.push(`  Subtotal ${anoKey} (calculado pelo sistema): ${subStr}${subCresc}`);
    });

    linhas.push('');
  }

  if (totalGeral) {
    const totStr = colsValor.map(c => `${c}: ${totalGeral[c] || 0}`).join(' | ');
    linhas.push(`Total Geral (calculado pelo sistema): ${totStr}`);
  }

  return linhas.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// USER PROMPT UNIVERSAL (substitui _calcularTotais de cada schema)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constrói o user prompt para a chamada de formatação.
 * Quando há agrupamento duplo (temporal + entidade), envia os dados
 * pré-estruturados em blocos para eliminar ambiguidade da IA no 1º bloco.
 *
 * @param {string}   mensagem
 * @param {object[]} rows               – rows brutas do SQL
 * @param {object}   opts
 * @param {string[]} opts.avisoNaoEncontradas
 */
function buildFormatUserPrompt(mensagem, rows, { avisoNaoEncontradas = [], contextoConsulta = null } = {}) {
  const { dados, subtotais, totalGeral } = prepararDadosComTotais(rows);

  const { colTemporal, colEntidade, colCompanion, numCols } = dados && dados.length ? _detectarColunas(dados) : {};

  let dadosSection;

  if (colTemporal && colEntidade && subtotais) {
    // Detecta caso 3D: competencia AAAAMM multi-ano + entidade → blocos Mês → Ano → Entidade
    const periodos = Object.keys(subtotais);
    const isAaaamm3D = periodos.length > 0
      && periodos.every(v => /^\d{6}$/.test(v))
      && new Set(periodos.map(v => v.slice(0, 4))).size > 1;

    if (isAaaamm3D) {
      const blocos = _buildBlocosMesAnoEntidade(dados, colTemporal, colEntidade, numCols, totalGeral);
      dadosSection =
        'Dados organizados em blocos por MES, com sub-secoes por ANO e itens por entidade (vendedor/cliente).\n' +
        'REGRA de formato:\n' +
        '  • Cabecalho de mes: 🗓 *NomeMes*\n' +
        '  • Sub-secao de ano: *Ano XXXX*: R$ subtotal (| Crescimento: X%)\n' +
        '  • Item: "  N. NOME: R$ valor (| Crescimento: X%)"\n' +
        '  • "crescimento: N/A (novo)" indica vendedor sem dados no ano anterior — exiba como "Crescimento: N/A"\n' +
        'Use EXATAMENTE os valores e subtotais marcados como "calculado pelo sistema":\n\n' +
        blocos;
    } else {
      // Agrupamento duplo padrão (temporal + entidade): pré-estrutura em blocos explícitos
      const MAX = 50;
      const dadosTruncados = dados.length > MAX ? dados.slice(0, MAX) : dados;
      const notaTruncamento = dados.length > MAX
        ? `(mostrando ${MAX} de ${dados.length} itens — subtotais calculados sobre todos)\n\n`
        : '';

      // Detecta granularidade do bloco temporal: dia específico vs mês/período
      const primeiroValorTemporal = String((dadosTruncados[0] || {})[colTemporal] || '');
      const isDiaLevel = /^\d{4}-\d{2}-\d{2}$/.test(primeiroValorTemporal);  // YYYY-MM-DD após normalização

      const blocos = _buildBlocosTexto(dadosTruncados, subtotais, totalGeral, colTemporal, colEntidade, numCols, colCompanion);
      const descTemporal = isDiaLevel
        ? 'DIARIOS — cada bloco e uma DATA ESPECIFICA (ex: 01/06/2026). NUNCA agrupe dias em mes.'
        : 'TEMPORAIS (meses/datas/periodos)';
      const regraNivel2 = isDiaLevel
        ? 'REGRA CRITICA: cada BLOCO = uma data/dia unico — use 🗓 e o label EXATO do bloco (ex: "01/06/2026"). PROIBIDO reinterpretar como mes.'
        : 'REGRA CRITICA de emoji: cada BLOCO e um periodo de tempo — use OBRIGATORIAMENTE 🗓 nos cabecalhos de Nivel 2.';
      const regraCompanion = colCompanion
        ? 'REGRA UNIDADE: quando o item trouxer uma unidade apos o valor (ex: "quantidade_faturada: 1127.23 H"), use ESSA unidade — NUNCA "un" generico. Formato: "1.127,23 H".\n'
        : '';

      dadosSection =
        `Dados ja organizados em blocos ${descTemporal} pelo sistema backend.\n` +
        regraNivel2 + '\n' +
        'PROIBIDO usar 🏢 em blocos de data — 🏢 e EXCLUSIVO para o nome da empresa no Nivel 1.\n' +
        regraCompanion +
        '(use EXATAMENTE esses blocos — nao invente outros agrupadores):\n\n' +
        notaTruncamento +
        blocos;
    }
  } else if ((colEntidade || colTemporal) && subtotais && numCols && numCols.length) {
    // Agrupamento simples (entidade OU temporal): pré-estrutura em lista numerada
    // Elimina ambiguidade da IA: cada linha já é o total agregado, sem sub-agrupamentos
    const ehTemporal = !!colTemporal && !colEntidade;
    const dimLabel = colEntidade || colTemporal;
    const lista = _buildListaSimples(subtotais, totalGeral, numCols, ehTemporal);
    dadosSection =
      `Dados ja organizados em lista pelo sistema backend ` +
      `(formate EXATAMENTE esta lista — cada linha ja e o total agregado por "${dimLabel}", ` +
      `nao adicione sub-agrupamentos nem subtotais individuais por item):\n\n${lista}`;
  } else {
    // Sem agrupamento reconhecível: envia JSON direto + total geral
    const amostra = dados.slice(0, 50);
    const resumo  = dados.length > 50 ? `\n(Exibindo 50 de ${dados.length} registros)` : '';
    dadosSection  = `Dados retornados pelo sistema:${resumo}\n${JSON.stringify(amostra, null, 2)}`;

    if (totalGeral) {
      dadosSection += `\n\nTotal Geral — calculado pelo sistema, use EXATAMENTE este valor:\n${JSON.stringify(totalGeral, null, 2)}`;
    }
  }

  const avisoStr = avisoNaoEncontradas.length
    ? `\n\nAVISO: os seguintes nomes nao tiveram movimentos no periodo e foram ignorados: ${avisoNaoEncontradas.join(', ')}. Informe isso ao usuario na resposta.`
    : '';

  const contextoStr = contextoConsulta
    ? `\nContexto ativo da consulta (inclua no Nivel 1 da resposta): ${contextoConsulta}\n`
    : '';

  return (
    `Pergunta original: "${mensagem}"\n` +
    contextoStr +
    `\n` +
    dadosSection +
    avisoStr +
    '\n\nFormate para WhatsApp seguindo a estrutura de 3 niveis. ' +
    'Use EXATAMENTE os subtotais e totais marcados como "calculado pelo sistema" — NUNCA recalcule.'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATAÇÃO DIRETA (bypassa IA) — caso 3D: AAAAMM multi-ano + entidade
// ─────────────────────────────────────────────────────────────────────────────

const _BRL = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function _fmtValorCol(col, v) {
  const n = String(col || '').toLowerCase();
  if (/valor|comissao|comissão|faturamento|receita|custo|saldo|base|venda/.test(n)) return _BRL(v);
  if (/percentual|percent|taxa/.test(n)) {
    return (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  }
  if (/quantidade|quant|qtd/.test(n)) {
    return (parseFloat(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' un';
  }
  return (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Gera mensagem WhatsApp final para o caso 3D (AAAAMM multi-ano + entidade).
 * Estrutura: 🗓 *Mês* → *Ano XXXX*: subtotal → itens por entidade.
 * Crescimento calculado programaticamente por divisão.
 * Retorna null se não detectar o caso 3D.
 */
function buildFormatDirect(mensagem, rows, { avisoNaoEncontradas = [], contextoConsulta = null, nomeModulo = null, anoFirst = false } = {}) {
  const { dados, subtotais, totalGeral } = prepararDadosComTotais(rows);
  if (!dados || !dados.length || !subtotais) return null;

  const { colTemporal, colEntidade, numCols } = _detectarColunas(dados);
  if (!colTemporal || !colEntidade) return null;

  const periodos = Object.keys(subtotais);
  const isAaaamm3D = periodos.length > 0
    && periodos.every(v => /^\d{6}$/.test(v))
    && new Set(periodos.map(v => v.slice(0, 4))).size > 1;

  if (!isAaaamm3D) return null;

  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                 'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  const _RE_CRESC_COL = /crescimento|variacao|variação|cresc|variacao_pct/i;
  const colsValor = numCols.filter(col => !_RE_CRESC_COL.test(col));
  const primaryCol = colsValor[0];
  if (!primaryCol) return null;

  const _pct = (atual, anterior) => {
    if (!anterior) return null;
    const v = ((atual - anterior) / anterior) * 100;
    const s = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return v >= 0 ? `+${s}%` : `-${s}%`;
  };

  // Monta estrutura: mes(MM) → ano(YYYY) → entidade → { col: total }
  const porMes = new Map();
  for (const row of dados) {
    const compet = String(row[colTemporal] || '').trim();
    if (!/^\d{6}$/.test(compet)) continue;
    const mesKey = compet.slice(4, 6);
    const anoKey = compet.slice(0, 4);
    const ent = String(row[colEntidade] || '').trim();
    if (!ent) continue;
    if (!porMes.has(mesKey)) porMes.set(mesKey, new Map());
    const porAno = porMes.get(mesKey);
    if (!porAno.has(anoKey)) porAno.set(anoKey, new Map());
    const porEnt = porAno.get(anoKey);
    if (!porEnt.has(ent)) { const b = {}; for (const c of colsValor) b[c] = 0; porEnt.set(ent, b); }
    const acc = porEnt.get(ent);
    for (const c of colsValor) acc[c] = _arredondar2(acc[c] + (parseFloat(row[c]) || 0));
  }

  const linhas = [];
  const _hdrParts = [nomeModulo, contextoConsulta].filter(Boolean);
  if (_hdrParts.length) linhas.push(`💰 ${_hdrParts.join(' — ')}`);
  let primeiro = true;

  if (anoFirst) {
    // Ano → Mês → Entidades
    // Reconstrói porMes → porAno: Map<anoKey, Map<mesKey, Map<ent, vals>>>
    const porAnoMap = new Map();
    for (const [mesKey, porAno] of porMes) {
      for (const [anoKey, porEnt] of porAno) {
        if (!porAnoMap.has(anoKey)) porAnoMap.set(anoKey, new Map());
        porAnoMap.get(anoKey).set(mesKey, porEnt);
      }
    }

    for (const [anoKey, mesesDoAno] of [...porAnoMap.entries()].sort(([a],[b]) => parseInt(a)-parseInt(b))) {
      if (!primeiro) linhas.push('');
      primeiro = false;
      linhas.push(`🗓 *${anoKey}*`);

      const mesesOrd = [...mesesDoAno.entries()].sort(([a],[b]) => parseInt(a)-parseInt(b));
      mesesOrd.forEach(([mesKey, porEnt]) => {
        const mesNum   = parseInt(mesKey, 10);
        const labelMes = (mesNum >= 1 && mesNum <= 12) ? MESES[mesNum-1] : mesKey;

        const subMes = {}; for (const c of colsValor) subMes[c] = 0;
        for (const vals of porEnt.values()) {
          for (const c of colsValor) subMes[c] = _arredondar2(subMes[c] + (vals[c] || 0));
        }
        const subValStr = colsValor.map(c => _fmtValorCol(c, subMes[c])).join(' | ');
        linhas.push(`  *${labelMes}*: ${subValStr}`);

        const entradas = [...porEnt.entries()].sort(([,a],[,b]) => (b[primaryCol]||0)-(a[primaryCol]||0));
        const visiveis = entradas.slice(0, 20);
        const ocultos  = entradas.length - visiveis.length;
        visiveis.forEach(([ent, vals], i) => {
          const valStr = colsValor.map(c => _fmtValorCol(c, vals[c])).join(' | ');
          linhas.push(`    ${i+1}. *${ent}*: ${valStr}`);
        });
        if (ocultos > 0) linhas.push(`    ... e mais ${ocultos}`);
      });

      // Subtotal do ano
      const subAnoTotal = {}; for (const c of colsValor) subAnoTotal[c] = 0;
      for (const porEnt of mesesDoAno.values()) {
        for (const vals of porEnt.values()) {
          for (const c of colsValor) subAnoTotal[c] = _arredondar2(subAnoTotal[c] + (vals[c] || 0));
        }
      }
      const subStr = colsValor.map(c => _fmtValorCol(c, subAnoTotal[c])).join(' | ');
      linhas.push(`🧾 *Subtotal ${anoKey}*: ${subStr}`);
    }
  } else {
    // Mês → Ano → Entidades (comportamento padrão)
    for (const [mesKey, porAno] of [...porMes.entries()].sort(([a],[b]) => parseInt(a,10)-parseInt(b,10))) {
      if (!primeiro) linhas.push('');
      primeiro = false;

      const mesNum = parseInt(mesKey, 10);
      const labelMes = (mesNum >= 1 && mesNum <= 12) ? MESES[mesNum-1] : mesKey;
      linhas.push(`🗓 *${labelMes}*`);

      const anosOrdenados = [...porAno.entries()].sort(([a],[b]) => parseInt(a)-parseInt(b));

      anosOrdenados.forEach(([anoKey, porEnt], anoIdx) => {
        const prevPorEnt = anoIdx > 0 ? anosOrdenados[anoIdx-1][1] : null;

        const subAno = {}; for (const c of colsValor) subAno[c] = 0;
        for (const vals of porEnt.values()) {
          for (const c of colsValor) subAno[c] = _arredondar2(subAno[c] + (vals[c] || 0));
        }

        const subValStr = colsValor.map(c => _fmtValorCol(c, subAno[c])).join(' | ');
        let anoHeaderSuffix = '';
        if (prevPorEnt) {
          const subPrev = {}; for (const c of colsValor) subPrev[c] = 0;
          for (const vals of prevPorEnt.values()) {
            for (const c of colsValor) subPrev[c] = _arredondar2(subPrev[c] + (vals[c] || 0));
          }
          const p = _pct(subAno[primaryCol] || 0, subPrev[primaryCol] || 0);
          anoHeaderSuffix = ` | Crescimento: ${p ?? 'N/A'}`;
        }
        linhas.push(`  *Ano ${anoKey}*: ${subValStr}${anoHeaderSuffix}`);

        const entradas = [...porEnt.entries()].sort(([,a],[,b]) => (b[primaryCol]||0)-(a[primaryCol]||0));
        const visiveis = entradas.slice(0, 20);
        const ocultos  = entradas.length - visiveis.length;

        visiveis.forEach(([ent, vals], i) => {
          const valStr = colsValor.map(c => _fmtValorCol(c, vals[c])).join(' | ');
          let crescStr = '';
          if (prevPorEnt) {
            const prev = prevPorEnt.get(ent);
            if (prev) {
              const p = _pct(vals[primaryCol] || 0, prev[primaryCol] || 0);
              crescStr = ` | Crescimento: ${p ?? 'N/A'}`;
            } else {
              crescStr = ' | Crescimento: N/A';
            }
          }
          linhas.push(`    ${i+1}. *${ent}*: ${valStr}${crescStr}`);
        });
        if (ocultos > 0) linhas.push(`    ... e mais ${ocultos}`);
      });
    }
  }

  if (totalGeral && colsValor.length) {
    const totStr = colsValor.map(c => _fmtValorCol(c, totalGeral[c] || 0)).join(' | ');
    linhas.push('');
    linhas.push(`*Total Geral*: ${totStr}`);
  }

  if (avisoNaoEncontradas.length) {
    linhas.push('');
    linhas.push(`_Aviso: os seguintes nomes não tiveram movimentos no período e foram ignorados: ${avisoNaoEncontradas.join(', ')}._`);
  }

  return linhas.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTER PROGRAMÁTICO — padrão {ano, mes} (inteiros) + entidade + métricas
// Cobre o caso mais comum gerado pela IA: YEAR()/MONTH() como colunas separadas.
// ─────────────────────────────────────────────────────────────────────────────

function buildFormatAnoMesDireto(rows, { contextoConsulta = null, nomeModulo = null } = {}) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const first = rows[0];
  const keys = Object.keys(first);

  // Requer colunas numéricas 'ano' (4 dígitos) e 'mes' (1-12)
  const hasAno = keys.includes('ano') && /^\d{4}$/.test(String(first['ano'] || ''));
  const hasMes = keys.includes('mes') && parseInt(first['mes'], 10) >= 1 && parseInt(first['mes'], 10) <= 12;
  if (!hasAno || !hasMes) return null;

  // Detecta coluna de entidade
  const entCol = keys.find(k => k !== 'ano' && k !== 'mes' && _RE_ENTIDADE.test(k)) || null;
  if (!entCol) return null;

  // Colunas métricas: numéricas, não ano/mes/entidade/skip
  const numCols = keys.filter(k =>
    k !== 'ano' && k !== 'mes' && k !== entCol &&
    !_RE_SKIP_NUM.test(k) &&
    !_RE_SKIP_CALC.test(k) &&
    !_RE_COMPANION.test(k) &&
    (typeof first[k] === 'number' || (first[k] !== null && !isNaN(parseFloat(first[k]))))
  );
  if (!numCols.length) return null;

  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                 'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  // Agrupa: AAAAMM → entidade → { col: total }
  const byPeriodo = new Map();
  for (const row of rows) {
    const ano = String(row['ano'] || '');
    const mes = String(parseInt(row['mes'], 10) || '').padStart(2, '0');
    const key = `${ano}${mes}`;
    if (!/^\d{6}$/.test(key)) continue;
    const ent = String(row[entCol] || '').trim();
    if (!ent) continue;
    if (!byPeriodo.has(key)) byPeriodo.set(key, new Map());
    const byEnt = byPeriodo.get(key);
    if (!byEnt.has(ent)) { const b = {}; for (const c of numCols) b[c] = 0; byEnt.set(ent, b); }
    const acc = byEnt.get(ent);
    for (const c of numCols) acc[c] = _arredondar2(acc[c] + (parseFloat(row[c]) || 0));
  }
  if (!byPeriodo.size) return null;

  // Deriva range de período a partir das chaves AAAAMM disponíveis
  const sortedPeriodoKeys = [...byPeriodo.keys()].sort();
  const firstK = sortedPeriodoKeys[0];
  const lastK  = sortedPeriodoKeys[sortedPeriodoKeys.length - 1];
  let periodoStr = null;
  if (firstK) {
    const fAno = firstK.slice(0, 4), fMes = parseInt(firstK.slice(4, 6), 10);
    const lAno = lastK.slice(0, 4),  lMes = parseInt(lastK.slice(4, 6), 10);
    const abr = i => MESES[i - 1].slice(0, 3);
    if (firstK === lastK) {
      periodoStr = `${abr(fMes)}/${fAno}`;
    } else if (fAno === lAno) {
      periodoStr = `${abr(fMes)} a ${abr(lMes)}/${fAno}`;
    } else {
      periodoStr = `${abr(fMes)}/${fAno} a ${abr(lMes)}/${lAno}`;
    }
  }

  const primaryCol = numCols[0];
  const totalGlobal = {}; for (const c of numCols) totalGlobal[c] = 0;
  const linhas = [];

  const headerParts = [nomeModulo, contextoConsulta, periodoStr].filter(Boolean);
  if (headerParts.length) linhas.push(`💰 ${headerParts.join(' — ')}`);

  let primeiro = true;
  for (const [key, byEnt] of [...byPeriodo.entries()].sort()) {
    const mesNum = parseInt(key.slice(4, 6), 10);
    const ano    = key.slice(0, 4);
    const label  = (mesNum >= 1 && mesNum <= 12) ? MESES[mesNum - 1] : key.slice(4, 6);

    if (!primeiro) linhas.push('');
    primeiro = false;
    linhas.push(`🗓 *${label} / ${ano}*`);

    const subBloco = {}; for (const c of numCols) subBloco[c] = 0;
    for (const vals of byEnt.values()) {
      for (const c of numCols) {
        subBloco[c] = _arredondar2(subBloco[c] + vals[c]);
        totalGlobal[c] = _arredondar2(totalGlobal[c] + vals[c]);
      }
    }

    const entradas = [...byEnt.entries()].sort(([,a],[,b]) => (b[primaryCol]||0)-(a[primaryCol]||0));
    const visiveis = entradas.slice(0, 20);
    const ocultos  = entradas.length - visiveis.length;

    visiveis.forEach(([ent, vals], i) => {
      const valStr = numCols.map(c => _fmtValorCol(c, vals[c])).join(' | ');
      linhas.push(`  ${i + 1}. *${ent}*: ${valStr}`);
    });
    if (ocultos > 0) linhas.push(`  ... e mais ${ocultos}`);

    const subStr = numCols.map(c => _fmtValorCol(c, subBloco[c])).join(' | ');
    linhas.push(`🧾 *Subtotal*: ${subStr}`);
  }

  linhas.push('');
  const totStr = numCols.map(c => _fmtValorCol(c, totalGlobal[c])).join(' | ');
  linhas.push(`*Total Geral*: ${totStr}`);

  return linhas.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTER PROGRAMÁTICO — lista temporal simples (sem entidade)
// Cobre dois sub-casos:
//   1. Ano único → lista plana numerada  (ex: Jan/2026, Fev/2026 ...)
//   2. Multi-ano → agrupa por mês, anos como itens  (ex: 🗓 Janeiro → 2014, 2015 ...)
// Detecta coluna auxiliar de ano (YEAR() separado de MONTH()) e constrói chaves AAAAMM,
// garantindo ordenação cronológica e label correto independente do nome da coluna.
// ─────────────────────────────────────────────────────────────────────────────

function buildFormatSimplesTemporal(rows, { contextoConsulta = null, nomeModulo = null, anoFirst = false } = {}) {
  if (!Array.isArray(rows) || !rows.length) return null;

  const first = rows[0];
  const keys  = Object.keys(first);
  const { colTemporal, colEntidade, numCols } = _detectarColunas(rows);

  // Só age: temporal presente, SEM entidade, pelo menos uma métrica
  if (!colTemporal || colEntidade || !numCols.length) return null;

  // Coluna de ano auxiliar (YEAR() separado, ex: 'ano'/'year') para enriquecer chave AAAAMM
  const anoCol = keys.find(k =>
    /^(ano|year)$/i.test(k) &&
    k !== colTemporal &&
    /^\d{4}$/.test(String(first[k] || ''))
  ) || null;

  // Constrói subtotais keyed por AAAAMM (ou chave normalizada)
  const subtotais   = {};
  const totalGlobal = {};
  for (const c of numCols) totalGlobal[c] = 0;

  for (const row of rows) {
    let chave;
    const rawMes = row[colTemporal];
    const anoVal = anoCol ? String(row[anoCol] || '') : null;

    if (anoVal && /^\d{4}$/.test(anoVal)) {
      const mesNum = typeof rawMes === 'number' ? rawMes : parseInt(String(rawMes || ''), 10);
      chave = (mesNum >= 1 && mesNum <= 12)
        ? `${anoVal}${String(mesNum).padStart(2, '0')}`
        : (_normalizarDataChave(rawMes) || String(rawMes || '').trim());
    } else {
      chave = _normalizarDataChave(rawMes) || String(rawMes || '').trim();
    }
    if (!chave) continue;

    if (!subtotais[chave]) {
      subtotais[chave] = {};
      for (const c of numCols) subtotais[chave][c] = 0;
    }
    for (const c of numCols) {
      const v = parseFloat(row[c]) || 0;
      subtotais[chave][c]  = _arredondar2(subtotais[chave][c] + v);
      totalGlobal[c]       = _arredondar2(totalGlobal[c] + v);
    }
  }
  _recalcularRatios(totalGlobal, numCols);

  const todasChaves = Object.keys(subtotais);
  if (!todasChaves.length) return null;

  // Detecta se são todas AAAAMM (6 dígitos) e se abrangem múltiplos anos
  const isAaaamm  = todasChaves.every(v => /^\d{6}$/.test(v));
  const anos      = isAaaamm ? [...new Set(todasChaves.map(v => v.slice(0, 4)))] : [];
  const isMultiAno = anos.length > 1;

  const MESES_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                      'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  const linhas = [];
  const headerParts = [nomeModulo, contextoConsulta].filter(Boolean);
  if (headerParts.length) linhas.push(`💰 ${headerParts.join(' — ')}`);

  if (isMultiAno && isAaaamm) {
    if (anoFirst) {
      // Sub-caso 2a — ano-primeiro: 🗓 Ano → meses como itens numerados
      const porAno = new Map();
      for (const chave of todasChaves.sort()) {
        const anoKey = chave.slice(0, 4);
        const mesKey = chave.slice(4, 6);
        if (!porAno.has(anoKey)) porAno.set(anoKey, new Map());
        porAno.get(anoKey).set(mesKey, subtotais[chave]);
      }

      let primeiro = true;
      for (const [anoKey, porMes] of [...porAno.entries()].sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))) {
        if (!primeiro) linhas.push('');
        primeiro = false;

        linhas.push(`🗓 *${anoKey}*`);

        const mesesOrd = [...porMes.entries()].sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10));
        const visiveis = mesesOrd.slice(0, 12);
        const ocultos  = mesesOrd.length - visiveis.length;

        visiveis.forEach(([mesKey, vals], i) => {
          const mesNum   = parseInt(mesKey, 10);
          const labelMes = (mesNum >= 1 && mesNum <= 12) ? MESES_FULL[mesNum - 1] : mesKey;
          const valStr   = numCols.map(c => _fmtValorCol(c, vals[c])).join(' | ');
          linhas.push(`  ${i + 1}. *${labelMes}*: ${valStr}`);
        });
        if (ocultos > 0) linhas.push(`  ... e mais ${ocultos}`);

        const subAno = {};
        for (const c of numCols) subAno[c] = 0;
        for (const vals of porMes.values()) {
          for (const c of numCols) subAno[c] = _arredondar2(subAno[c] + (vals[c] || 0));
        }
        const subStr = numCols.map(c => _fmtValorCol(c, subAno[c])).join(' | ');
        linhas.push(`🧾 *Subtotal*: ${subStr}`);
      }
    } else {
      // Sub-caso 2b — mês-primeiro (padrão): 🗓 Mês → anos como itens numerados
      const porMes = new Map();
      for (const chave of todasChaves.sort()) {
        const mesKey = chave.slice(4, 6);
        const anoKey = chave.slice(0, 4);
        if (!porMes.has(mesKey)) porMes.set(mesKey, new Map());
        porMes.get(mesKey).set(anoKey, subtotais[chave]);
      }

      let primeiro = true;
      for (const [mesKey, porAno] of [...porMes.entries()].sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))) {
        if (!primeiro) linhas.push('');
        primeiro = false;

        const mesNum   = parseInt(mesKey, 10);
        const labelMes = (mesNum >= 1 && mesNum <= 12) ? MESES_FULL[mesNum - 1] : mesKey;
        linhas.push(`🗓 *${labelMes}*`);

        const anosOrd = [...porAno.entries()].sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10));
        const visiveis = anosOrd.slice(0, 20);
        const ocultos  = anosOrd.length - visiveis.length;

        visiveis.forEach(([anoKey, vals], i) => {
          const valStr = numCols.map(c => _fmtValorCol(c, vals[c])).join(' | ');
          linhas.push(`  ${i + 1}. *${anoKey}*: ${valStr}`);
        });
        if (ocultos > 0) linhas.push(`  ... e mais ${ocultos}`);

        const subMes = {};
        for (const c of numCols) subMes[c] = 0;
        for (const vals of porAno.values()) {
          for (const c of numCols) subMes[c] = _arredondar2(subMes[c] + (vals[c] || 0));
        }
        const subStr = numCols.map(c => _fmtValorCol(c, subMes[c])).join(' | ');
        linhas.push(`🧾 *Subtotal*: ${subStr}`);
      }
    }
  } else {
    // Sub-caso 1 — ano único (ou não AAAAMM): lista plana numerada
    const entradas = isAaaamm
      ? todasChaves.sort()
      : todasChaves.sort((a, b) => {
          // Ordena meses inteiros (1-12) numericamente
          const na = parseInt(a, 10), nb = parseInt(b, 10);
          if (!isNaN(na) && !isNaN(nb) && na >= 1 && na <= 12 && nb >= 1 && nb <= 12) return na - nb;
          return a < b ? -1 : a > b ? 1 : 0;
        });

    entradas.forEach((chave, i) => {
      const label  = _formatarLabelGrupo(chave);
      const valStr = numCols.map(c => _fmtValorCol(c, subtotais[chave][c])).join(' | ');
      linhas.push(`  ${i + 1}. ${label}: ${valStr}`);
    });

    const subStr = numCols.map(c => _fmtValorCol(c, totalGlobal[c])).join(' | ');
    linhas.push(`🧾 *Subtotal*: ${subStr}`);
  }

  linhas.push('');
  const totStr = numCols.map(c => _fmtValorCol(c, totalGlobal[c])).join(' | ');
  linhas.push(`*Total Geral*: ${totStr}`);

  return linhas.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

function buildFormatSystemPrompt() {
  return WHATSAPP_FORMAT_SYSTEM_PROMPT;
}

module.exports = {
  buildFormatSystemPrompt,
  buildFormatUserPrompt,
  buildFormatDirect,
  buildFormatAnoMesDireto,
  buildFormatSimplesTemporal,
  prepararDadosComTotais,
  WHATSAPP_FORMAT_SYSTEM_PROMPT,
};
