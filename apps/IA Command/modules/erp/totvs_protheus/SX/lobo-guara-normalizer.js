'use strict';

console.log('[IA Command] LoboGuaraNormalizer v20260821a — considera X2_MODOEMP (compartilhamento por empresa, alem de filial)');

// Normalizer Lobo Guara — ver docs/lobo-guara-consenso-arquitetura.md.
//
// Responsabilidade unica: recebe SQL canonico JA adaptado pelo SX2 (sufixo
// fisico resolvido) e um estado de filial JA resolvido e estruturado (nunca
// texto livre — quem resolve texto e lobo-guara-filial-resolver.js, antes do
// SQL existir). Injeta `alias.campoFilial IN (...)` nas tabelas de negocio
// presentes no SQL, quando ha escopo de filial definido.
//
// Cada tabela pode ter um nivel de compartilhamento DIFERENTE (X2_MODO para
// filial, X2_MODOEMP para empresa — caso real confirmado: SA1 compartilhada
// entre filiais mas exclusiva por empresa na Plantivo). O filtro por tabela
// usa o campo/tamanho certo para cada nivel — nunca mistura filial_chave
// completa com codigo de empresa.
//
// Nao decide QUAL filial — so aplica o que ja foi decidido. Nao le
// SYS_COMPANY_CFG, nao faz JOIN, nao decompoe filial via SUBSTRING.

const sx2SqlNormalizer = require('./sx2-sql-normalizer');
const { aliasTabelaSql, campoFilialBase, modoTabelaSX2, modoEmpresaSX2 } = sx2SqlNormalizer;

function _escaparRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _escaparSqlLiteral(s) {
  return String(s).replace(/'/g, "''");
}

// Localiza a proxima ocorrencia de `keyword` fora de parenteses (nivel 0) a
// partir de `inicio` — usado para achar o fim da clausula ON de um JOIN sem
// confundir com JOINs/WHERE dentro de subqueries. Copia local equivalente a
// runner.js::localizarKeywordNivelZero (nao exportada de la, e pequena o
// suficiente para nao justificar acoplamento entre os dois modulos).
function _localizarKeywordNivelZero(sql, keyword, inicio = 0) {
  const texto = String(sql || '');
  const alvo = String(keyword || '').toUpperCase();
  let nivel = 0;
  let aspas = false;
  for (let i = Math.max(0, inicio); i <= texto.length - alvo.length; i++) {
    const c = texto[i];
    if (c === "'" && texto[i - 1] !== '\\') aspas = !aspas;
    if (aspas) continue;
    if (c === '(') { nivel++; continue; }
    if (c === ')') { nivel = Math.max(0, nivel - 1); continue; }
    if (nivel !== 0) continue;
    if (texto.slice(i, i + alvo.length).toUpperCase() !== alvo) continue;
    const antes = i > 0 ? texto[i - 1] : ' ';
    const depois = texto[i + alvo.length] || ' ';
    if (!/[A-Z0-9_]/i.test(antes) && !/[A-Z0-9_]/i.test(depois)) return i;
  }
  return -1;
}

// Resolve a lista final de filial_chave a aplicar, dado o estado estruturado
// e a arvore local (para expandir modo 'empresa' -> todas as filiais dela).
function _resolverChavesEscopo(filialState, db, connectionId) {
  if (!filialState) return null;
  if (filialState.modo === 'todas') return null; // sem filtro
  if (filialState.modo === 'ambigua') return null; // pipeline de intencao deve ter perguntado antes; nao filtra às cegas

  if (filialState.modo === 'especifica') {
    return (filialState.chaves || []).filter(Boolean);
  }

  if (filialState.modo === 'empresa') {
    const resolver = require('./lobo-guara-filial-resolver');
    const chaves = (filialState.chaves || [])
      .flatMap(empresaCodigo => resolver.expandirFiliaisDaEmpresa(db, connectionId, empresaCodigo));
    return chaves.filter(Boolean);
  }

  // 'agrupamento': o pipeline pediu "por filial" — não é filtro de escopo, é
  // dimensão de projeção/GROUP BY, que a IA já resolve no SQL canônico normal.
  // Nada a fazer aqui.
  return null;
}

// Injeta `alias.campo IN ('a','b',...)` em cada tabela de negocio do SQL cujo
// modo SX2 nao seja compartilhado/global (mesmo raciocinio do SX2: cadastros
// compartilhados entre filiais nao tem filial significativa).
//
// Cada tabela pode exigir um VALOR e TAMANHO de filtro diferentes do escopo
// original: quando X2_MODOEMP='E' (exclusiva por empresa, mesmo com
// X2_MODO='C' — caso real confirmado: SA1/Plantivo, ver
// docs/lobo-guara-consenso-arquitetura.md), o campo de filial gravado nessa
// tabela nao tem o mesmo tamanho de filial_chave (mascara completa do
// M0_LEIAUTE do grupo, ex.: 6 digitos 'EEUUFF') — o Protheus grava so o
// segmento de empresa (ex.: 2 digitos). Confirmado com dado real: F2_FILIAL
// (exclusiva) tem 6 digitos, A1_FILIAL (exclusiva so por empresa) tem 2.
// `codigosEmpresa` traz o codigo de empresa (curto, 2 digitos), nunca
// filial_chave completa nem decomposicao via SUBSTRING/mascara.
function _injetarFiltroFilial(sql, aliases, sx2, sx2Empresa, chaves, codigosEmpresa, opts = {}) {
  if (!chaves || !chaves.length) return { sql, aplicado: false, avisos: [] };

  const avisos = [];
  let alterado = false;
  let texto = String(sql || '');

  for (const [alias, base] of Object.entries(aliases)) {
    const modo = sx2 ? modoTabelaSX2(sx2, base) : null;
    const modoEmp = sx2Empresa ? modoEmpresaSX2(sx2Empresa, base) : null;

    // Precedencia: X2_MODO='E' (exclusiva por filial) e a granularidade mais
    // fina possivel e SEMPRE vence — usa a filial pontual do escopo, igual ao
    // comportamento anterior (bug real encontrado em teste: SF2, que e
    // X2_MODO=E E X2_MODOEMP=E ao mesmo tempo, estava sendo filtrada pelo
    // codigo de empresa curto em vez da filial completa, quebrando a query).
    // So quando a tabela NAO for exclusiva por filial (compartilhada/global
    // nesse nivel) e que X2_MODOEMP='E' decide o filtro — caso real SA1:
    // X2_MODO=C (compartilhada em filial) mas X2_MODOEMP=E (exclusiva por
    // empresa), onde o campo de filial gravado tem tamanho/formato diferente
    // (codigo de empresa curto, nao filial_chave completa).
    let valoresTabela = chaves;
    let escopoEmpresa = false;
    if (modo === 'E') {
      // segue com valoresTabela = chaves (filial pontual) — nada a fazer aqui.
    } else if (modoEmp === 'E') {
      if (!codigosEmpresa || !codigosEmpresa.length) continue; // sem empresa dona identificada -- nao filtra às cegas
      valoresTabela = codigosEmpresa;
      escopoEmpresa = true;
    } else if (modo === 'C' || modo === 'G') {
      continue; // compartilhada/global em todos os niveis relevantes — sem filial significativa
    }

    const campo = campoFilialBase(base);
    const aliasEsc = _escaparRegex(alias);
    const campoEsc = _escaparRegex(campo);

    // Já existe filtro LITERAL (valor fixo, não outra coluna) desse campo no SQL?
    // O campo de filial quase sempre também aparece em condições de JOIN entre
    // tabelas de negócio (ex.: "SD2.D2_FILIAL = SF2.F2_FILIAL", chave de junção
    // legítima do contrato Protheus) — isso NÃO é um filtro de valor e não deve
    // impedir a injeção. Só considera "já filtrado" quando o lado direito é um
    // literal de string ('...') ou uma lista IN (...), nunca outro alias.coluna.
    const jaTemFiltroLiteral = new RegExp(`${aliasEsc}\\s*\\.\\s*${campoEsc}\\s*(?:=\\s*'|IN\\s*\\(\\s*')`, 'i').test(texto);
    if (jaTemFiltroLiteral) continue;

    const listaSql = valoresTabela.map(c => `'${_escaparSqlLiteral(c)}'`).join(', ');
    const predicado = `${alias}.${campo} IN (${listaSql})`;
    const antes = texto;

    if (/\bWHERE\b/i.test(texto)) {
      texto = texto.replace(/\bWHERE\b/i, `WHERE ${predicado}\n  AND `);
    } else {
      const pos = texto.search(/\b(?:GROUP\s+BY|ORDER\s+BY|HAVING)\b/i);
      texto = pos !== -1
        ? texto.slice(0, pos) + `WHERE ${predicado}\n` + texto.slice(pos)
        : texto.trimEnd() + `\nWHERE ${predicado}`;
    }

    if (texto !== antes) {
      alterado = true;
      avisos.push(`${alias}.${campo} IN (...) aplicado — ${valoresTabela.length} ${escopoEmpresa ? 'empresa(s)' : 'filial(is)'}`);
    }
  }

  if (alterado && opts.logPrefix) {
    console.warn(`[${opts.logPrefix}] Escopo Lobo Guara aplicado: ${avisos.join(' | ')}`);
  }

  return { sql: texto, aplicado: alterado, avisos };
}

// Bug real critico encontrado em teste ao vivo (Plantivo): quando a pergunta
// NAO tem escopo de filial/empresa ("vendas do dia de ontem"), o filtro WHERE
// acima nunca roda (chaves vazio -> aplicarEscopoLoboGuara retorna cedo). Mas
// o JOIN entre uma tabela exclusiva por filial (SF2, granularidade fina) e
// uma tabela exclusiva so por empresa (SA1, X2_MODOEMP=E) fica AMBIGUO: o
// mesmo A1_COD+A1_LOJA existe em mais de uma empresa (confirmado com dado
// real — milhares de codigos duplicados entre filial '01' e '02' na
// Plantivo), entao "SF2.F2_CLIENTE = SA1.A1_COD AND SF2.F2_LOJA = SA1.A1_LOJA"
// pode casar com a linha de SA1 da empresa ERRADA, trazendo nome de cliente
// de outra empresa numa venda legitima.
//
// Correcao: SEMPRE que uma tabela X2_MODOEMP=E aparecer em JOIN com uma
// tabela ancora exclusiva por filial (X2_MODO=E) no mesmo SQL, amarra a
// clausula ON delas com o codigo de empresa — nao depende de haver escopo de
// pergunta, roda sempre que a ambiguidade estrutural existir. Usa LEFT() com
// o tamanho REAL do codigo de empresa (2 digitos, confirmado via dado real —
// nao adivinhado), nunca SUBSTRING livre feito pela IA (guard continua
// proibindo isso na IA; aqui e o backend aplicando regra fixa e
// deterministica, equivalente ao que aliasTabelaSql/campoFilialBase ja fazem).
function _amarrarJoinPorEmpresa(sql, aliases, sx2, sx2Empresa, opts = {}) {
  if (!sx2 || !sx2Empresa) return { sql, aplicado: false, avisos: [] };

  const aliasAncora = Object.entries(aliases).find(([, base]) => modoTabelaSX2(sx2, base) === 'E');
  if (!aliasAncora) return { sql, aplicado: false, avisos: [] }; // sem tabela exclusiva por filial no SQL -- nada para amarrar

  const [aliasAncoraNome, baseAncora] = aliasAncora;
  const campoAncora = campoFilialBase(baseAncora);

  const avisos = [];
  let alterado = false;
  let texto = String(sql || '');

  for (const [alias, base] of Object.entries(aliases)) {
    if (alias === aliasAncoraNome) continue;
    if (modoTabelaSX2(sx2, base) === 'E') continue; // ja exclusiva por filial -- sem ambiguidade
    if (modoEmpresaSX2(sx2Empresa, base) !== 'E') continue; // so tabelas exclusivas por empresa precisam de amarração

    const campo = campoFilialBase(base);
    const aliasEsc = _escaparRegex(alias);
    const campoEsc = _escaparRegex(campo);

    // Já amarrada a esta mesma âncora (literal ou via LEFT já presente)?
    const jaAmarrada = new RegExp(`${aliasEsc}\\s*\\.\\s*${campoEsc}\\s*=\\s*(?:LEFT\\s*\\(\\s*)?${_escaparRegex(aliasAncoraNome)}\\s*\\.\\s*${_escaparRegex(campoAncora)}\\b`, 'i').test(texto)
      || new RegExp(`(?:LEFT\\s*\\(\\s*)?${_escaparRegex(aliasAncoraNome)}\\s*\\.\\s*${_escaparRegex(campoAncora)}\\b[^=]*=\\s*${aliasEsc}\\s*\\.\\s*${campoEsc}\\b`, 'i').test(texto);
    if (jaAmarrada) continue;

    // Localiza a clausula ON do JOIN desta tabela (alias) especificamente.
    const reJoin = new RegExp(`\\bJOIN\\s+[A-Z_][A-Z0-9_]*\\s+(?:AS\\s+)?${aliasEsc}\\b\\s+ON\\s+`, 'i');
    const mJoin = reJoin.exec(texto);
    if (!mJoin) continue; // tabela nao esta em JOIN (ex.: e a FROM principal) -- nada a amarrar aqui

    const inicioOn = mJoin.index + mJoin[0].length;
    const fins = ['JOIN', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'UNION']
      .map(k => _localizarKeywordNivelZero(texto, k, inicioOn))
      .filter(pos => pos >= 0);
    const fimOn = fins.length ? Math.min(...fins) : texto.length;

    const tamanhoEmpresa = 2; // confirmado com dado real (M0_LEIAUTE='EEUUFF' -> segmento de empresa = 2 digitos)
    const condicao = ` AND ${alias}.${campo} = LEFT(${aliasAncoraNome}.${campoAncora}, ${tamanhoEmpresa})\n`;
    texto = texto.slice(0, fimOn) + condicao + texto.slice(fimOn);

    alterado = true;
    avisos.push(`JOIN ${alias} amarrado a ${aliasAncoraNome} por codigo de empresa (LEFT ${tamanhoEmpresa})`);
  }

  if (alterado && opts.logPrefix) {
    console.warn(`[${opts.logPrefix}] Amarracao de JOIN por empresa aplicada: ${avisos.join(' | ')}`);
  }

  return { sql: texto, aplicado: alterado, avisos };
}

// Ponto de entrada principal. `ctx` é o resultado de
// lobo-guara-filial-resolver.contextoLoboGuara(db, empresaId) — já confirma
// modelo LOBO_GUARA + perfil validado. Se `ctx` for null, o normalizer não
// faz nada (não é uma conexão LOBO_GUARA validada — falha fechado).
function aplicarEscopoLoboGuara(sql, { db, ctx, sx2, sx2Empresa, filialState, logPrefix } = {}) {
  if (!ctx || !db) return sql;

  const aliases = aliasTabelaSql(sql);
  if (!Object.keys(aliases).length) return sql;

  // Amarração de JOIN por empresa roda SEMPRE que houver a combinação
  // ambígua no SQL (âncora exclusiva por filial + tabela exclusiva por
  // empresa) — independe de a pergunta ter escopo de filial/empresa ou não.
  // Precisa rodar ANTES do filtro WHERE abaixo, para o filtro (quando houver)
  // enxergar o SQL já com os aliases corretos.
  let out = _amarrarJoinPorEmpresa(sql, aliases, sx2, sx2Empresa, { logPrefix }).sql;

  const chaves = _resolverChavesEscopo(filialState, db, ctx.connectionId);
  if (!chaves || !chaves.length) return out;

  // Só precisa resolver a empresa dona se alguma tabela do SQL de fato
  // tiver X2_MODOEMP='E' — evita consulta desnecessária à árvore no caminho comum.
  const precisaEscopoEmpresa = sx2Empresa && Object.values(aliases).some(
    base => modoEmpresaSX2(sx2Empresa, base) === 'E'
  );
  const resolver = require('./lobo-guara-filial-resolver');
  const codigosEmpresa = precisaEscopoEmpresa
    ? resolver.empresasDonasDasFiliais(db, ctx.connectionId, chaves)
    : null;

  const { sql: sqlFinal } = _injetarFiltroFilial(out, aliases, sx2, sx2Empresa, chaves, codigosEmpresa, { logPrefix });
  return sqlFinal;
}

// ── Guards (docs/lobo-guara-consenso-arquitetura.md, secao "Guards") ────────
//
// So chamados quando a conexao ja e confirmada LOBO_GUARA validada (o
// chamador em runner.js decide isso, igual ao normalizer principal — nunca
// afeta TRADICIONAL). Cada guard retorna uma mensagem corretiva especifica
// para o retry da IA, nunca um erro generico, para nao gerar loop sem
// direcao.

// Detecta SUBSTRING/qualquer decomposicao de string sobre um campo que
// termine em _FILIAL (D2_FILIAL, F2_FILIAL, E1_FILIAL...) — a IA nunca deve
// tentar recompor filial via fatiamento de string; o backend resolve isso.
const _RE_SUBSTRING_FILIAL = /\bSUBSTRING\s*\(\s*[A-Z_][A-Z0-9_]*\s*\.\s*[A-Z0-9]*_FILIAL\b/i;

// Referencia manual a SYS_COMPANY/SYS_COMPANY_CFG no SQL gerado pela IA — o
// prompt minimo (Fase 8 do doc) instrui a IA a nunca fazer isso; se acontecer
// mesmo assim, e um guard de seguranca, nao o caminho esperado.
const _RE_SYS_COMPANY_MANUAL = /\bSYS_COMPANY(?:_CFG)?\b/i;

// CNPJ (campo *_CGC/*_CNPJ) usado como se fosse filtro de filial — filial
// Protheus e codigo interno (M0_CODFIL/XX_FILIAL), nunca CNPJ.
const _RE_CNPJ_COMO_FILIAL = /\b[A-Z][A-Z0-9]?_C(?:GC|NPJ)\b\s*(?:=|IN\s*\()[^)]*(?:FILIAL|FILIAL_CHAVE)/i;

function validarGuardsLoboGuara(sql) {
  const texto = String(sql || '');
  const erros = [];

  if (_RE_SUBSTRING_FILIAL.test(texto)) {
    erros.push(
      'Nao use SUBSTRING em campo de filial. Gere SQL canonico sem tentar decompor filial; o backend aplicara o escopo Lobo Guara automaticamente.'
    );
  }
  if (_RE_SYS_COMPANY_MANUAL.test(texto)) {
    erros.push(
      'Nao use SYS_COMPANY ou SYS_COMPANY_CFG no SQL. Gere SQL apenas com as tabelas de negocio (SX2/SX3); o backend resolve a hierarquia organizacional separadamente.'
    );
  }
  if (_RE_CNPJ_COMO_FILIAL.test(texto)) {
    erros.push(
      'Filial no Protheus e identificada por codigo interno, nao por CNPJ. Nao use campo de CNPJ/CGC como filtro de filial.'
    );
  }

  return { ok: erros.length === 0, erros };
}

module.exports = {
  aplicarEscopoLoboGuara,
  validarGuardsLoboGuara,
  _resolverChavesEscopo,
  _injetarFiltroFilial,
  _amarrarJoinPorEmpresa,
};
