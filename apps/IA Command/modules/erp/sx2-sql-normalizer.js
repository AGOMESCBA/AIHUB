'use strict';

console.log('[IA Command] SX2SqlNormalizer v20260614b — fix: segunda passagem normaliza JOIN TabelaBase ON (alias=keyword SQL consumido pelo regex)');

// Palavras reservadas SQL que o regex FROM/JOIN nao deve capturar como alias de tabela.
// Sem este conjunto, "FROM SF2\nWHERE" captura WHERE como alias, fazendo
// ALIASES_PROTHEUS.has('WHERE') retornar false e o sufixo nao ser aplicado.
const SQL_KEYWORDS = new Set([
  'WHERE', 'AND', 'OR', 'ON', 'SET', 'GROUP', 'ORDER', 'HAVING',
  'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'FULL', 'UNION',
  'SELECT', 'INTO', 'VALUES', 'UPDATE', 'DELETE', 'INSERT',
  'WITH', 'LIMIT', 'OFFSET', 'DISTINCT', 'IN', 'NOT', 'NULL',
  'IS', 'BETWEEN', 'LIKE', 'EXISTS', 'CASE', 'WHEN', 'THEN',
  'ELSE', 'END', 'TOP', 'BY', 'FROM', 'JOIN',
]);

const ALIASES_PROTHEUS = new Set([
  'SA1', 'SA2', 'SA3', 'SA6',
  'SB1', 'SB2', 'SBM',
  'SC7',
  'SD1', 'SD2',
  'SE1', 'SE2', 'SE3', 'SE5', 'SE8',
  'SED',
  'SF1', 'SF2', 'SF4',
  'CTT',
  'FK1', 'FK2', 'FK5', 'FK6', 'FK7', 'FKA', 'FKB',
]);

function baseTabelaSX2(nome) {
  const valor = String(nome || '').trim().toUpperCase();
  const bases = [...ALIASES_PROTHEUS].sort((a, b) => b.length - a.length);
  // Reconhece sufixo numérico (SE5990) e sufixo placeholder xxx gerado pelo LLM (SE5xxx, SF2xxx)
  const baseConhecida = bases.find(base =>
    valor === base
    || new RegExp(`^${base}\\d{3,4}$`).test(valor)
    || new RegExp(`^${base}[Xx]{3}$`).test(valor),
  );
  if (baseConhecida) return baseConhecida;
  const m = valor.match(/^([A-Z]{2,4})(\d{3,4})$/);
  return m ? m[1] : valor;
}

function sufixoTabelaSX2(nome) {
  const valor = String(nome || '').trim().toUpperCase();
  const base = baseTabelaSX2(valor);
  const sufixo = valor.slice(base.length);
  return /^\d{3,4}$/.test(sufixo) ? sufixo : null;
}

function tabelaFisicaSX2(sx2 = {}, base) {
  const alvo = String(base || '').trim().toUpperCase();
  return Object.keys(sx2 || {}).filter(n => baseTabelaSX2(n) === alvo);
}

function modoTabelaSX2(sx2 = {}, tabelaOuBase) {
  const base = baseTabelaSX2(tabelaOuBase);
  const entrada = Object.entries(sx2 || {}).find(([nome]) => baseTabelaSX2(nome) === base);
  return entrada ? String(entrada[1] || '').trim().toUpperCase() : null;
}

function aliasTabelaSql(sql) {
  const aliases = {};
  const re = /\b(?:FROM|JOIN)\s+([A-Z_][A-Z0-9_]*)(?:[ \t]+(?:AS[ \t]+)?([A-Z_][A-Z0-9_]*))?/gi;
  let m;
  while ((m = re.exec(String(sql || ''))) !== null) {
    const tabela = String(m[1] || '').toUpperCase();
    const capturado = String(m[2] || '').toUpperCase();
    const alias = capturado && !SQL_KEYWORDS.has(capturado) ? capturado : baseTabelaSX2(tabela);
    aliases[alias] = baseTabelaSX2(tabela);
  }
  return aliases;
}

function campoFilialBase(base) {
  const b = String(base || '').toUpperCase();
  const mapa = {
    SA1: 'A1_FILIAL',
    SA2: 'A2_FILIAL',
    SA3: 'A3_FILIAL',
    SA6: 'A6_FILIAL',
    SB1: 'B1_FILIAL',
    SBM: 'BM_FILIAL',
    SC7: 'C7_FILIAL',
    SD1: 'D1_FILIAL',
    SD2: 'D2_FILIAL',
    SE1: 'E1_FILIAL',
    SE2: 'E2_FILIAL',
    SE3: 'E3_FILIAL',
    SE5: 'E5_FILIAL',
    SE8: 'E8_FILIAL',
    SED: 'ED_FILIAL',
    SF1: 'F1_FILIAL',
    SF2: 'F2_FILIAL',
    SF4: 'F4_FILIAL',
    CTT: 'CTT_FILIAL',
  };
  return mapa[b] || `${b.replace(/^S/, '')}_FILIAL`;
}

function _removerPredicadoLiteral(sql, alias, campo) {
  const a = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const c = campo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = String(sql || '');
  const pred = `${a}\\s*\\.\\s*${c}\\s*=\\s*'(?:[^']|'')*'`;
  out = out.replace(new RegExp(`\\s+AND\\s+${pred}`, 'gi'), '');
  out = out.replace(new RegExp(`\\s+WHERE\\s+${pred}\\s+AND\\s+`, 'gi'), ' WHERE ');
  out = out.replace(new RegExp(`\\s+WHERE\\s+${pred}(\\s*(?:GROUP\\s+BY|ORDER\\s+BY|HAVING|;|$))`, 'gi'), '$1');
  return out;
}

// Remove condição de igualdade entre campos de filial em cláusula JOIN quando
// a tabela com o alias indicado é compartilhada/global (X2_MODO C ou G).
// Padrão alvo: aliasA.campoFilialA = aliasB.campoFilialB (qualquer ordem), em qualquer
// posição da cláusula ON — logo após ON, no meio (precedido/seguido de AND) ou por último.
// Isso ocorre quando a IA une tabela exclusiva com cadastro compartilhado pelo campo filial,
// o que exclui registros válidos — cadastros compartilhados não têm filial significativa.
function _removerPredicadoFilialJoin(sql, aliasCompartilhado, campoCompartilhado) {
  const a = aliasCompartilhado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const c = campoCompartilhado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = String(sql || '');
  // Captura qualquerAlias.qualquerCampo = aliasComp.campoComp (ou ordem inversa)
  const qualquer = '[A-Z_][A-Z0-9_]*\\s*\\.\\s*[A-Z_][A-Z0-9_]*';
  const lado = `${a}\\s*\\.\\s*${c}`;
  const predicado = `(?:${qualquer}\\s*=\\s*${lado}|${lado}\\s*=\\s*${qualquer})`;
  // 1) Predicado no meio ou no fim da cláusula: sempre precedido por AND — remove junto com o AND.
  out = out.replace(new RegExp(`\\s+AND\\s+${predicado}`, 'gi'), '');
  // 2) Predicado é o PRIMEIRO logo após ON, seguido de outro predicado: remove o predicado e
  //    o AND seguinte, preservando a condição restante (senão sobraria "ON AND <resto>").
  out = out.replace(new RegExp(`\\bON\\s+${predicado}\\s+AND\\s+`, 'gi'), 'ON ');
  // 3) Predicado é o ÚNICO da cláusula ON (sem nenhum AND antes ou depois): não há como remover
  //    sem deixar o JOIN sem condição — substitui por 1=1, condição neutra sempre verdadeira,
  //    equivalente semanticamente a "sem filtro de filial" (mesmo efeito da regra de negócio).
  out = out.replace(new RegExp(`\\bON\\s+${predicado}(\\s*(?:WHERE|GROUP\\s+BY|ORDER\\s+BY|LEFT\\s+JOIN|INNER\\s+JOIN|JOIN|;|$))`, 'gi'), 'ON 1=1$1');
  return out;
}

function sanitizarFiltrosFilialSX2(sql, sx2 = {}, opts = {}) {
  let texto = String(sql || '');
  const avisos = [];
  const aliases = aliasTabelaSql(texto);
  const filialSolicitada = Boolean(opts.filialSolicitada);

  for (const [alias, base] of Object.entries(aliases)) {
    const modo = modoTabelaSX2(sx2, base);
    if (!modo) continue;
    const campo = campoFilialBase(base);
    const antes = texto;
    if (modo === 'C' || modo === 'G') {
      texto = _removerPredicadoLiteral(texto, alias, campo);
      texto = _removerPredicadoFilialJoin(texto, alias, campo);
      if (texto !== antes) avisos.push(`${alias}.${campo} removido: tabela ${base} compartilhada/global no SX2`);
      continue;
    }
    if (modo === 'E' && !filialSolicitada) {
      texto = _removerPredicadoLiteral(texto, alias, campo);
      if (texto !== antes) avisos.push(`${alias}.${campo} removido: filial nao solicitada`);
    }
  }

  if (avisos.length && opts.logPrefix) {
    console.warn(`[${opts.logPrefix}] Filtros de filial sanitizados por SX2: ${avisos.join(' | ')}`);
  }
  return texto;
}

function normalizarTabelasPorAliasSX2(sql, sx2 = {}, opts = {}) {
  let alterou = false;
  const avisos = [];
  const texto = String(sql || '').replace(/\b(FROM|JOIN)\s+([A-Z_][A-Z0-9_]*)([ \t]+(?:AS[ \t]+)?([A-Z_][A-Z0-9_]*))\b/gi, (match, clausula, tabela, aliasParte, alias) => {
    const aliasNorm = String(alias || '').toUpperCase();
    if (!aliasNorm || SQL_KEYWORDS.has(aliasNorm) || !ALIASES_PROTHEUS.has(aliasNorm)) return match;

    const baseAtual = baseTabelaSX2(tabela);
    // Se o nome da tabela não é uma tabela Protheus conhecida, é um CTE — não alterar.
    if (!ALIASES_PROTHEUS.has(baseAtual)) return match;
    if (baseAtual === aliasNorm) return match;

    const candidatas = tabelaFisicaSX2(sx2, aliasNorm);
    if (candidatas.length !== 1) return match;

    alterou = true;
    avisos.push(`${tabela} ${aliasNorm} -> ${candidatas[0]} ${aliasNorm}`);
    return `${clausula} ${candidatas[0]}${aliasParte}`;
  });

  if (alterou && opts.logPrefix) {
    console.warn(`[${opts.logPrefix}] Tabela fisica normalizada por SX2: ${avisos.join(' | ')}`);
  }
  return texto;
}

function adaptarSqlCanonicoPorSX2(sql, sx2 = {}, opts = {}) {
  const sufixoFallback = String(opts.sufixoFallback || '').trim();
  let alterou = false;
  const avisos = [];
  // Rastreia {base → física} apenas para tabelas SEM alias explícito, para corrigir
  // qualificadores de coluna (SF2.F2_EMISSAO → SF2020.F2_EMISSAO) na etapa seguinte.
  const baseToPhysical = {};

  // Pré-processamento: corrige `JOIN TabelaBase ON` onde a tabela Protheus aparece sem sufixo e sem alias,
  // seguida imediatamente de ON. O regex principal não cobre esse caso porque captura `ON` como alias de
  // uma tabela anterior (ex: `FROM SE1990 JOIN` → alias=JOIN → cursor avança além de `SE5 ON`).
  // Este regex é não-ambíguo: captura apenas `(FROM|JOIN) TABELABASE ON` sem grupo de alias opcional.
  let texto = String(sql || '').replace(
    /\b(FROM|JOIN)\s+([A-Z][A-Z0-9]{1,3}(?:[Xx]{3})?)\s+(ON\b)/gi,
    (match, clausula, tabela, on) => {
      const base = baseTabelaSX2(tabela);
      if (!ALIASES_PROTHEUS.has(base)) return match;
      // Só atua quando o nome é exatamente a base (sem sufixo) ou um placeholder xxx
      const tabelaUp = String(tabela).toUpperCase();
      const ehBaseOuPlaceholder = tabelaUp === base || new RegExp(`^${base}[Xx]{3}$`).test(tabelaUp);
      if (!ehBaseOuPlaceholder) return match;
      const candidatas = tabelaFisicaSX2(sx2, base);
      if (candidatas.length === 1) {
        if (tabelaUp === candidatas[0]) return match;
        alterou = true;
        avisos.push(`${tabela} -> ${candidatas[0]} (pre-proc)`);
        baseToPhysical[base] = candidatas[0];
        return `${clausula} ${candidatas[0]} ${on}`;
      }
      if (sufixoFallback) {
        const novaTabela = `${base}${sufixoFallback}`;
        if (tabelaUp !== novaTabela) {
          alterou = true;
          avisos.push(`${tabela} -> ${novaTabela} (pre-proc+fallback)`);
          baseToPhysical[base] = novaTabela;
          return `${clausula} ${novaTabela} ${on}`;
        }
      }
      return match;
    }
  );

  texto = texto.replace(/\b(FROM|JOIN)\s+([A-Z_][A-Z0-9_]*)([ \t]+(?:AS[ \t]+)?([A-Z_][A-Z0-9_]*))?/gi, (match, clausula, tabela, aliasParte, alias) => {
    // Ignora palavras reservadas SQL capturadas erroneamente como alias.
    // Ex.: "FROM SF2\nWHERE" captura alias='WHERE' → sem este guard, ALIASES_PROTHEUS.has('WHERE')
    // retorna false e o sufixo não é aplicado.
    const aliasReal = alias && !SQL_KEYWORDS.has(String(alias).toUpperCase()) ? alias : null;
    const aliasNorm = String(aliasReal || baseTabelaSX2(tabela)).toUpperCase();
    if (!ALIASES_PROTHEUS.has(aliasNorm)) return match;

    const base = baseTabelaSX2(tabela);
    // Se o nome da tabela não é uma tabela Protheus conhecida (ex: é um CTE como "saldo_recente"),
    // não substituir — o normalizer não deve trocar CTEs por tabelas físicas.
    if (!ALIASES_PROTHEUS.has(base)) return match;
    const candidatas = tabelaFisicaSX2(sx2, aliasNorm);
    if (candidatas.length !== 1) {
      // Sem SX2 cadastrado: aplica sufixo de fallback quando disponível.
      // Cobre SF2 → SF2990 e SF2010 → SF2990 sem depender de SX2 cadastrado.
      if (sufixoFallback && ALIASES_PROTHEUS.has(aliasNorm)) {
        const novaTabela = `${base}${sufixoFallback}`;
        if (String(tabela).toUpperCase() !== novaTabela.toUpperCase()) {
          alterou = true;
          avisos.push(`${tabela} -> ${novaTabela} (sufixo_fallback)`);
          // Sem alias explícito: registra para corrigir qualificadores de coluna depois.
          if (!aliasReal) baseToPhysical[base] = novaTabela;
          return `${clausula} ${novaTabela}${aliasParte || ''}`;
        }
      }
      return match;
    }
    if (String(tabela || '').toUpperCase() === candidatas[0]) return match;

    alterou = true;
    avisos.push(`${tabela}${aliasReal ? ` ${aliasNorm}` : ''} -> ${candidatas[0]}${aliasReal ? ` ${aliasNorm}` : ''}`);
    // Sem alias explícito: registra para corrigir qualificadores de coluna depois.
    if (!aliasReal) baseToPhysical[base] = candidatas[0];
    return `${clausula} ${candidatas[0]}${aliasParte || ''}`;
  });

  // Corrige qualificadores de coluna quando a tabela foi renomeada sem alias explícito.
  // Ex.: FROM SF2 → FROM SF2020, então SF2.F2_EMISSAO → SF2020.F2_EMISSAO.
  // Quando há alias explícito (FROM SF2 AS SF2), o alias não muda → qualificador já funciona.
  for (const [base, physical] of Object.entries(baseToPhysical)) {
    const reQ = new RegExp(`\\b${base}\\.`, 'g');
    const antes = texto;
    texto = texto.replace(reQ, `${physical}.`);
    if (texto !== antes) avisos.push(`qualificador ${base}. -> ${physical}.`);
  }

  if (alterou && opts.logPrefix) {
    console.warn(`[${opts.logPrefix}] SQL canonico adaptado por SX2: ${avisos.join(' | ')}`);
  }
  return texto;
}

// Strips physical table suffixes from FROM/JOIN clauses, keeping aliases unchanged.
// Used to normalize a canonical SQL before multiempresa reuse: the module-runner
// applies adaptarSqlCanonicoPorSX2 per-company to re-add the correct suffix.
// FROM SF2990 SF2  →  FROM SF2 SF2
// FROM SF2020 SF2  →  FROM SF2 SF2
// FROM SF2 SF2     →  FROM SF2 SF2 (unchanged)
// Tables without a recognized Protheus alias are left untouched.
function sqlParaCanonico(sql) {
  return String(sql || '').replace(
    /\b(FROM|JOIN)\s+([A-Z_][A-Z0-9_]*)([ \t]+(?:AS[ \t]+)?([A-Z_][A-Z0-9_]*))?/gi,
    (match, clausula, tabela, aliasParte, alias) => {
      const aliasNorm = String(alias || '').toUpperCase();
      if (!aliasNorm || !ALIASES_PROTHEUS.has(aliasNorm)) return match;
      const base = baseTabelaSX2(tabela);
      if (String(tabela).toUpperCase() === base) return match;
      return `${clausula} ${base}${aliasParte || ''}`;
    }
  );
}

// Garante que palavras-chave SQL não fiquem coladas a identificadores Protheus (ex: F1_LOJAWHERE → F1_LOJA WHERE).
// Isso ocorre quando a IA gera SQL com quebra de linha sem espaço antes da palavra-chave,
// e algum processamento intermediário remove o newline mas não insere espaço.
// ATENÇÃO: aplica apenas quando precedido por identificador Protheus (letras+dígitos+_),
// e apenas às keywords que podem colidir — exclui ON (substring de UNION, INNER, etc.).
const _SQL_KEYWORDS_COLADAS = /([A-Z][A-Z0-9]*_[A-Z0-9_]*)(WHERE|AND\b|GROUP\b|ORDER\b|HAVING\b|FROM\b|JOIN\b|LEFT\b|RIGHT\b|INNER\b|OUTER\b|SELECT\b|SET\b)/gi;
function sanitizarEspacosKeywords(sql) {
  return String(sql || '').replace(_SQL_KEYWORDS_COLADAS, '$1 $2');
}

module.exports = {
  ALIASES_PROTHEUS,
  baseTabelaSX2,
  tabelaFisicaSX2,
  modoTabelaSX2,
  sufixoTabelaSX2,
  aliasTabelaSql,
  campoFilialBase,
  normalizarTabelasPorAliasSX2,
  adaptarSqlCanonicoPorSX2,
  sanitizarFiltrosFilialSX2,
  sqlParaCanonico,
  sanitizarEspacosKeywords,
};
