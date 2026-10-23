'use strict';

const { baseTabelaSX2, campoFilialBase, modoTabelaSX2, modoEmpresaSX2 } = require('./sx2-sql-normalizer');

function erro(motivo) {
  throw Object.assign(new Error(`Não foi possível validar o filtro de filial do chat tradicional: ${motivo}.`), {
    _tipo: 'chat_tradicional_filial_invalida',
  });
}

// Tokens com posição no texto original: comentários e conteúdo de strings nunca
// são interpretados como SQL. Nenhum literal fora de um campo de filial é editado.
function tokensSql(sql) {
  const tokens = [];
  const re = /'(?:[^']|'')*'|\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$#]*|<>|!=|>=|<=|[^\s]/y;
  let depth = 0;
  let cursor = 0;
  while (cursor < sql.length) {
    if (/\s/.test(sql[cursor])) { cursor++; continue; }
    if (sql.startsWith('--', cursor)) {
      while (cursor < sql.length && !/[\r\n]/.test(sql[cursor])) cursor++;
      continue;
    }
    if (sql.startsWith('/*', cursor)) {
      let comments = 1;
      cursor += 2;
      while (cursor < sql.length && comments) {
        if (sql.startsWith('/*', cursor)) { comments++; cursor += 2; }
        else if (sql.startsWith('*/', cursor)) { comments--; cursor += 2; }
        else cursor++;
      }
      if (comments) erro('comentário SQL não terminado');
      continue;
    }
    re.lastIndex = cursor;
    const m = re.exec(sql);
    cursor = re.lastIndex;
    const raw = m[0];
    if (raw === ')') depth--;
    const string = raw.startsWith("'");
    const value = string ? raw.slice(1, -1).replace(/''/g, "'")
      : raw.startsWith('[') ? raw.slice(1, -1).replace(/\]\]/g, ']')
        : raw.startsWith('"') ? raw.slice(1, -1).replace(/""/g, '"') : raw;
    tokens.push({ raw, value, upper: value.toUpperCase(), string, start: m.index, end: m.index + raw.length, depth });
    if (raw === '(') depth++;
  }
  return tokens;
}

const RESERVED = new Set(['WHERE', 'ON', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'GROUP', 'ORDER', 'HAVING', 'UNION', 'EXCEPT', 'INTERSECT', 'WITH', 'OFFSET', 'FOR']);
const identifier = token => token && !token.string && /^(?:[A-Za-z_]|\[|")/.test(token.raw);

// Cada SELECT tem seus próprios aliases; um alias da subconsulta não deve
// herdar o significado de um alias homônimo do SELECT externo.
function escoposSql(tokens) {
  const scopes = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].upper !== 'SELECT' || tokens[i].string) continue;
    const depth = tokens[i].depth;
    let end = i + 1;
    while (end < tokens.length && tokens[end].depth >= depth && tokens[end].raw !== ';'
      && !(tokens[end].depth === depth && ['UNION', 'EXCEPT', 'INTERSECT'].includes(tokens[end].upper))) end++;
    scopes.push({ start: i, end, depth, aliases: new Map() });
  }
  for (let i = 0; i < tokens.length; i++) {
    tokens[i].scope = scopes.filter(s => s.start <= i && i < s.end).sort((a, b) => b.depth - a.depth || b.start - a.start)[0];
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.string || !token.scope || !['FROM', 'JOIN'].includes(token.upper) || !identifier(tokens[i + 1])) continue;
    let j = i + 1;
    let table = tokens[j].upper;
    while (tokens[j + 1]?.raw === '.' && identifier(tokens[j + 2])) { j += 2; table = tokens[j].upper; }
    if (tokens[j + 1]?.upper === 'AS') j++;
    const aliasToken = tokens[j + 1];
    const alias = identifier(aliasToken) && !RESERVED.has(aliasToken.upper) ? aliasToken.upper : baseTabelaSX2(table);
    token.scope.aliases.set(alias, baseTabelaSX2(table));
  }
  for (const scope of scopes) {
    scope.where = tokens.findIndex((t, i) => i > scope.start && i < scope.end && t.scope === scope && t.depth === scope.depth && t.raw.toUpperCase() === 'WHERE');
    scope.or = scope.where >= 0 && tokens.some((t, i) => i > scope.where && i < scope.end && t.scope === scope && t.depth === scope.depth && t.raw.toUpperCase() === 'OR');
  }
  return scopes;
}

function baseDoAlias(alias, token, scopes) {
  if (!token.scope) return null;
  const candidates = scopes.filter(s => s.start <= token.scope.start && s.end >= token.scope.end)
    .sort((a, b) => b.depth - a.depth || b.start - a.start);
  for (const scope of candidates) if (scope.aliases.has(alias)) return scope.aliases.get(alias);
  return null;
}

function literal(tokens, index) {
  if (tokens[index]?.upper === 'N' && !tokens[index].string) index++;
  return tokens[index]?.string ? { token: tokens[index], next: index + 1 } : null;
}

function normalizarLiteraisFilial(sql, { db, connectionId, chaves, sx2, sx2Empresa, tabelasMovimento }) {
  const texto = String(sql || '');
  const tokens = tokensSql(texto);
  const scopes = escoposSql(tokens);
  const elegivel = base => {
    const modo = modoTabelaSX2(sx2, base);
    return modo === 'E' || (!modo && modoEmpresaSX2(sx2Empresa, base) !== 'E' && tabelasMovimento.has(base));
  };
  if (!scopes.some(scope => [...scope.aliases.values()].some(elegivel))) {
    return { sql: texto, validado: false, alterado: false };
  }
  const placeholders = chaves.map(() => '?').join(',');
  const rows = db.prepare(`SELECT filial_chave, filial_codigo FROM protheus_company_tree
    WHERE connection_id = ? AND ativo = 1 AND tipo_no = 'filial' AND filial_chave IN (${placeholders})`).all(connectionId, ...chaves);
  const mapa = new Map();
  for (const row of rows) {
    const chave = String(row.filial_chave || '').trim();
    const codigo = String(row.filial_codigo || '').trim();
    if (!codigo || (mapa.has(chave) && mapa.get(chave) !== codigo)) erro('mapeamento cadastral ausente ou ambíguo');
    mapa.set(chave, codigo);
  }
  if (chaves.some(chave => !mapa.has(chave))) erro('filial selecionada sem código físico cadastrado');
  const fisicas = new Set(mapa.values());
  const edits = new Map();
  const filtrosConjuntivos = new Set();
  function validar(token) {
    const valor = token.value;
    if (fisicas.has(valor) && mapa.has(valor) && mapa.get(valor) !== valor) erro('código físico e chave completa conflitantes');
    const codigo = mapa.get(valor) || (fisicas.has(valor) ? valor : null);
    if (!codigo) erro('literal fora do escopo de filiais selecionado');
    if (codigo !== valor) edits.set(token.start, { ...token, novo: `'${codigo.replace(/'/g, "''")}'` });
  }
  for (let i = 0; i < tokens.length - 2; i++) {
    const alias = tokens[i];
    if (!identifier(alias) || tokens[i + 1].raw !== '.' || !identifier(tokens[i + 2])) continue;
    const base = baseDoAlias(alias.upper, alias, scopes);
    if (!base || tokens[i + 2].upper !== campoFilialBase(base)) continue;
    if (!elegivel(base)) continue;
    const conjuntivo = alias.scope && alias.scope.where >= 0 && i > alias.scope.where
      && alias.depth === alias.scope.depth && !alias.scope.or;
    const chaveFiltro = `${alias.scope?.start}:${alias.upper}`;
    let j = i + 3;
    if (tokens[j]?.raw === '=') {
      const value = literal(tokens, j + 1);
      if (value) {
        validar(value.token);
        if (conjuntivo) filtrosConjuntivos.add(chaveFiltro);
      }
    } else {
      const negativo = tokens[j]?.upper === 'NOT';
      if (tokens[j]?.upper === 'NOT') j++;
      if (tokens[j]?.upper === 'IN' && tokens[j + 1]?.raw === '(') {
        j += 2;
        if (tokens[j]?.raw.toUpperCase() === 'SELECT') continue; // subconsulta: valida os predicados internos separadamente
        while (true) {
          const value = literal(tokens, j);
          if (!value) erro('lista de filiais não literal');
          validar(value.token);
          j = value.next;
          if (tokens[j]?.raw === ')') break;
          if (tokens[j]?.raw !== ',') erro('expressão não suportada na lista de filiais');
          j++;
        }
        if (conjuntivo && !negativo) filtrosConjuntivos.add(chaveFiltro);
      }
    }
    if (tokens[i - 1]?.raw === '=' && tokens[i - 2]?.string) {
      validar(tokens[i - 2]);
      if (conjuntivo) filtrosConjuntivos.add(chaveFiltro);
    }
  }
  let out = texto;
  for (const edit of [...edits.values()].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.novo + out.slice(edit.end);
  // Um literal na projeção/ON ou num OR não comprova recorte. Só reconhece
  // escopo já aplicado quando todos os aliases elegíveis têm filtro positivo
  // e conjuntivo no WHERE do próprio SELECT. A injeção existente decide os demais casos.
  const aliasesElegiveis = scopes.flatMap(scope => [...scope.aliases].filter(([, base]) => elegivel(base)).map(([alias]) => `${scope.start}:${alias}`));
  const validado = aliasesElegiveis.length > 0 && aliasesElegiveis.every(chave => filtrosConjuntivos.has(chave));
  return { sql: out, validado, alterado: edits.size > 0 };
}

module.exports = { normalizarLiteraisFilial };
