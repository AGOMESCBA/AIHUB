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

// Ponto de entrada principal. `ctx` é o resultado de
// lobo-guara-filial-resolver.contextoLoboGuara(db, empresaId) — já confirma
// modelo LOBO_GUARA + perfil validado. Se `ctx` for null, o normalizer não
// faz nada (não é uma conexão LOBO_GUARA validada — falha fechado).
function aplicarEscopoLoboGuara(sql, { db, ctx, sx2, sx2Empresa, filialState, logPrefix } = {}) {
  if (!ctx || !db) return sql;

  const chaves = _resolverChavesEscopo(filialState, db, ctx.connectionId);
  if (!chaves || !chaves.length) return sql;

  const aliases = aliasTabelaSql(sql);
  if (!Object.keys(aliases).length) return sql;

  // Só precisa resolver a empresa dona se alguma tabela do SQL de fato
  // tiver X2_MODOEMP='E' — evita consulta desnecessária à árvore no caminho comum.
  const precisaEscopoEmpresa = sx2Empresa && Object.values(aliases).some(
    base => modoEmpresaSX2(sx2Empresa, base) === 'E'
  );
  const resolver = require('./lobo-guara-filial-resolver');
  const codigosEmpresa = precisaEscopoEmpresa
    ? resolver.empresasDonasDasFiliais(db, ctx.connectionId, chaves)
    : null;

  const { sql: sqlFinal } = _injetarFiltroFilial(sql, aliases, sx2, sx2Empresa, chaves, codigosEmpresa, { logPrefix });
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
};
