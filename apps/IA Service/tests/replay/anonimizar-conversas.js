'use strict';

// Anonimização de conversas reais para o replay (Fase 1, 2026-11-12).
//
// Lê o banco do IA Service SOMENTE LEITURA e gera, FORA do repositório, uma
// amostra anonimizada para revisão humana. Nada é enviado a provedor externo.
// A correspondência original → substituto NÃO é gravada (evita reidentificar).
//
// Uso (na raiz do repositório):
//   node "apps/IA Service/tests/replay/anonimizar-conversas.js" --saida <pasta fora do repo> [--quantidade 3] [--semente 7] [--termos-extra <arquivo>]

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { redigirTexto } = require('../../backend/services/redaction-service');

const RAIZ_REPO = path.resolve(__dirname, '../../../..');
const DB_SERVICE = path.resolve(__dirname, '../../data/ia-service.db');
const EMPRESAS_JSON = path.resolve(__dirname, '../../../IAHUB/data/empresas.json');

// Palavras que aparecem em nomes de empresa/pessoa mas são comuns demais para
// substituir sozinhas (seriam trocadas em todo o texto técnico).
const PALAVRAS_GENERICAS = new Set(['ltda', 'eireli', 'me', 'epp', 'sa', 's/a', 'cia', 'comercio', 'industria', 'servicos', 'grupo', 'brasil',
  'agro', 'agricola', 'fazenda', 'fazendas', 'transportes', 'distribuidora', 'fundacao', 'associacao', 'cooperativa', 'filial', 'matriz',
  'suporte', 'sistema', 'sistemas', 'admin', 'administrador', 'totvs', 'protheus', 'softexpert', 'compras', 'fiscal', 'financeiro', 'job',
  'usuario', 'teste', 'integracao', 'analista', 'consultor', 'tecnico', 'atendimento', 'central', 'nacional', 'norte', 'sul', 'centro',
  'oeste', 'leste', 'sao', 'santa', 'santo', 'nova', 'novo', 'mato', 'grosso', 'campo', 'grande', 'dos', 'das', 'del', 'van']);

function _semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Rede de segurança para nomes citados no texto que não estão no cadastro
// (achado na 1ª amostra: um primeiro nome escapou). Só com inicial maiúscula.
const PRIMEIROS_NOMES = ['Adriana', 'Adriano', 'Alessandra', 'Alessandro', 'Alex', 'Alexandre', 'Aline', 'Amanda', 'Ana', 'Anderson', 'Andre', 'Andrea', 'Andreia', 'Angela', 'Antonio', 'Beatriz', 'Bruna', 'Bruno', 'Caio', 'Camila', 'Carla', 'Carlos', 'Carolina', 'Cassio', 'Cesar', 'Claudia', 'Claudio', 'Cristiane', 'Cristiano', 'Daniel', 'Daniela', 'Danilo', 'Debora', 'Denise', 'Diego', 'Douglas', 'Edson', 'Eduardo', 'Elaine', 'Eliane', 'Elisangela', 'Emerson', 'Erica', 'Evandro', 'Fabiana', 'Fabio', 'Fabricio', 'Felipe', 'Fernanda', 'Fernando', 'Flavia', 'Flavio', 'Francisco', 'Gabriel', 'Gabriela', 'Gilberto', 'Gisele', 'Guilherme', 'Gustavo', 'Helena', 'Henrique', 'Hugo', 'Igor', 'Isabela', 'Ivan', 'Jaqueline', 'Jefferson', 'Jessica', 'Joao', 'Joana', 'Jorge', 'Jose', 'Josiane', 'Juliana', 'Juliano', 'Julio', 'Karina', 'Kelly', 'Larissa', 'Leandro', 'Leonardo', 'Leticia', 'Lucas', 'Luciana', 'Luciano', 'Luis', 'Luiz', 'Marcela', 'Marcelo', 'Marcia', 'Marcio', 'Marco', 'Marcos', 'Maria', 'Mariana', 'Marina', 'Mario', 'Marlene', 'Mateus', 'Matheus', 'Mauricio', 'Mauro', 'Michele', 'Milena', 'Murilo', 'Natalia', 'Nelson', 'Otavio', 'Patricia', 'Paula', 'Paulo', 'Pedro', 'Priscila', 'Rafael', 'Rafaela', 'Raquel', 'Reginaldo', 'Renan', 'Renata', 'Renato', 'Ricardo', 'Roberta', 'Roberto', 'Rodrigo', 'Rogerio', 'Ronaldo', 'Rosana', 'Rubens', 'Samuel', 'Sandra', 'Sergio', 'Silvia', 'Simone', 'Sonia', 'Tatiane', 'Thiago', 'Tiago', 'Valeria', 'Vanessa', 'Vinicius', 'Vitor', 'Vivian', 'Wagner', 'Wellington', 'Wesley', 'Wilson'];

const CLASSES = { a: '[aáàâãä]', e: '[eéèêë]', i: '[iíìîï]', o: '[oóòôõö]', u: '[uúùûü]', c: '[cç]', n: '[nñ]' };
const CLASSES_MAIUSC = { a: '[AÁÀÂÃÄ]', e: '[EÉÈÊË]', i: '[IÍÌÎÏ]', o: '[OÓÒÔÕÖ]', u: '[UÚÙÛÜ]', c: '[CÇ]', n: '[NÑ]' };
const _escapar = ch => ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const LIMITES = ['(?<![\\p{L}\\d])', '(?![\\p{L}\\d])'];

// Valor completo (nome inteiro, razão social): sem diferenciar maiúsculas.
function _regexPalavra(termo) {
  const corpo = _semAcento(termo).toLowerCase().split('')
    .map(ch => CLASSES[ch] || _escapar(ch))
    .join('')
    .replace(/\s+/g, '\\s+');
  return new RegExp(`${LIMITES[0]}${corpo}${LIMITES[1]}`, 'giu');
}

// Palavra solta de um nome: só como nome próprio (Inicial maiúscula), para
// não trocar palavras comuns ("campos", "com", "para") no texto técnico.
function _regexNomeProprio(termo) {
  const [primeira, ...resto] = _semAcento(termo).toLowerCase().split('');
  const corpo = (CLASSES_MAIUSC[primeira] || _escapar(primeira.toUpperCase())) + resto.map(ch => CLASSES[ch] || _escapar(ch)).join('');
  return new RegExp(`${LIMITES[0]}${corpo}${LIMITES[1]}`, 'gu');
}

// Substitutos ficam entre ⟦ ⟧ e nunca são reprocessados (o sobrenome
// "Pessoa" trocava o próprio substituto PESSOA-001).
const RE_SUBSTITUTO = /⟦[^⟧]*⟧|\[(?:REDACTED|NOME|ID|DOC|URL)[^\]]*\]/g;
function _foraDosSubstitutos(texto, fn) {
  let saida = '';
  let ultimo = 0;
  for (const m of texto.matchAll(RE_SUBSTITUTO)) {
    saida += fn(texto.slice(ultimo, m.index)) + m[0];
    ultimo = m.index + m[0].length;
  }
  return saida + fn(texto.slice(ultimo));
}

class Substituidor {
  constructor() { this.mapas = new Map(); }
  rotulo(categoria, original) {
    if (!this.mapas.has(categoria)) this.mapas.set(categoria, new Map());
    const mapa = this.mapas.get(categoria);
    const chave = _semAcento(original).toLowerCase().trim();
    if (!mapa.has(chave)) mapa.set(chave, `⟦${categoria}-${String(mapa.size + 1).padStart(3, '0')}⟧`);
    return mapa.get(chave);
  }
  contagens() { return Object.fromEntries([...this.mapas].map(([c, m]) => [c, m.size])); }
}

function carregarDicionario(db) {
  const unicos = arr => [...new Set(arr.map(v => String(v || '').trim()).filter(v => v.length >= 3))];
  const consulta = (sql) => { try { return db.prepare(sql).all().map(r => Object.values(r)[0]); } catch { return []; } };
  const pessoas = unicos([
    ...consulta('SELECT DISTINCT origem_autor FROM mensagens'),
    ...consulta('SELECT DISTINCT tecnico_nome_origem FROM posicionamentos'),
    ...consulta('SELECT nome FROM usuarios_cliente'),
    ...consulta('SELECT nome FROM tecnicos'),
  ]);
  let empresasPlataforma = [];
  try {
    const e = JSON.parse(fs.readFileSync(EMPRESAS_JSON, 'utf8'));
    empresasPlataforma = (Array.isArray(e) ? e : (e.empresas || Object.values(e))).map(x => x?.razao_social);
  } catch { /* opcional */ }
  const clientes = unicos([
    ...consulta('SELECT nome FROM clientes'),
    ...consulta('SELECT nome_fantasia FROM clientes'),
    ...consulta("SELECT DISTINCT trim(substr(titulo, 1, instr(titulo, '|') - 1)) FROM chamados WHERE instr(titulo, '|') > 0"),
    ...empresasPlataforma,
  ]);
  const emails = unicos([...consulta('SELECT email FROM usuarios_cliente'), ...consulta('SELECT email FROM tecnicos')]);
  const telefones = unicos(consulta('SELECT telefone FROM usuarios_cliente'));
  const cnpjs = unicos(consulta('SELECT cnpj FROM clientes'));
  const chamados = unicos(consulta('SELECT numero FROM chamados'));
  // Palavras que o próprio corpus usa em minúsculas com frequência são palavras
  // comuns, não nomes: não são trocadas sozinhas (só dentro do nome completo).
  const comuns = new Map();
  for (const texto of consulta('SELECT conteudo FROM mensagens ORDER BY rowid DESC LIMIT 4000')) {
    for (const m of String(texto || '').matchAll(/(?<![\p{L}\d])\p{Ll}{3,}(?![\p{L}\d])/gu)) {
      const w = _semAcento(m[0]);
      comuns.set(w, (comuns.get(w) || 0) + 1);
    }
  }
  const palavrasComuns = new Set([...comuns].filter(([, n]) => n >= 3).map(([w]) => w));
  return { pessoas, clientes, emails, telefones, cnpjs, chamados, palavrasComuns };
}

function _tokensSignificativos(nome, palavrasComuns = new Set()) {
  return _semAcento(nome).split(/[\s|/.,-]+/)
    .filter(t => t.length >= 4 && !PALAVRAS_GENERICAS.has(t.toLowerCase()) && !palavrasComuns.has(t.toLowerCase()));
}

function criarAnonimizador(dic) {
  const sub = new Substituidor();
  const regras = [];
  // Ordem importa: valores completos antes de partes (nome completo antes do
  // primeiro nome), identificadores estruturados antes do texto livre.
  for (const v of dic.emails) regras.push([_regexPalavra(v), () => sub.rotulo('EMAIL', v)]);
  for (const v of dic.cnpjs) regras.push([new RegExp(v.replace(/\D/g, '').split('').join('[.\\/-]?'), 'g'), () => sub.rotulo('CNPJ', v)]);
  for (const v of dic.telefones) { const d = v.replace(/\D/g, '').slice(-8); if (d.length === 8) regras.push([new RegExp(`${d.slice(0, 4)}[-\\s]?${d.slice(4)}`, 'g'), () => sub.rotulo('TEL', v)]); }
  const porTamanho = arr => [...arr].sort((a, b) => b.length - a.length);
  for (const v of porTamanho(dic.clientes)) regras.push([_regexPalavra(v), () => sub.rotulo('CLIENTE', v)]);
  for (const v of porTamanho(dic.pessoas)) regras.push([_regexPalavra(v), () => sub.rotulo('PESSOA', v)]);
  for (const v of porTamanho(dic.termosExtra || [])) regras.push([_regexPalavra(v), () => sub.rotulo('TERMO', v)]);
  const tokensCliente = new Map();
  for (const v of dic.clientes) for (const t of _tokensSignificativos(v, dic.palavrasComuns)) if (!tokensCliente.has(t.toLowerCase())) tokensCliente.set(t.toLowerCase(), v);
  const tokensPessoa = new Set(PRIMEIROS_NOMES.map(n => n.toLowerCase()));
  for (const v of dic.pessoas) for (const t of _tokensSignificativos(v, dic.palavrasComuns)) tokensPessoa.add(t.toLowerCase());
  for (const [t, v] of tokensCliente) regras.push([_regexNomeProprio(t), () => sub.rotulo('CLIENTE', v)]);
  for (const t of tokensPessoa) regras.push([_regexNomeProprio(t), () => '[NOME]']);
  const numerosChamado = new Set(dic.chamados.map(n => String(n).replace(/^0+/, '')));

  const etapas = [
    s => s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, m => sub.rotulo('EMAIL', m)),
    s => s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[ID]'),
    s => s.replace(/\bhttps?:\/\/[^\s"'<>)]+/gi, url => {
      try {
        const u = new URL(url);
        return /(^|\.)(totvs\.com|softexpert\.com|microsoft\.com|google\.com)$/i.test(u.hostname) ? url : `https://${sub.rotulo('HOST', u.hostname)}/`;
      } catch { return '[URL]'; }
    }),
    s => s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, m => sub.rotulo('IP', m)),
    s => s.replace(/([A-Za-z]:\\Users\\)[^\\\s]+/gi, '$1USUARIO'),
    s => s.replace(/(THREAD ERROR \(\[\d+\],\s*)([^,\s]+)(,\s*)([^)\s]+)/g, (_m, a, usr, b, maq) => `${a}${sub.rotulo('USR', usr)}${b}${sub.rotulo('MAQ', maq)}`),
    s => s.replace(/\b\d{14}\b/g, '[DOC]').replace(/(?<![\d.])\d{11}(?![\d.])/g, '[DOC]'),
    s => s.replace(/(\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]\d{4}\b/g, m => sub.rotulo('TEL', m)),
    s => s.replace(/#?\b0?\d{5,6}\b/g, m => (numerosChamado.has(m.replace(/^#?0*/, '')) ? `#${sub.rotulo('CH', m.replace(/^#/, ''))}` : m)),
    ...regras.map(([re, rotulo]) => s => s.replace(re, rotulo)),
    // Nome após saudação/assinatura que não estava no cadastro.
    s => s.replace(/\b(Bom dia|Boa tarde|Boa noite|Olá|Ola|Oi|Prezad[oa]s?|Caro|Cara|Att\.?|Atenciosamente|Sr\.?|Sra\.?|falei com (?:o|a))([,:\s]+)(\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+){0,2})/gu, (_m, a, sep) => `${a}${sep}[NOME]`),
  ];

  function anonimizar(texto) {
    return etapas.reduce((s, etapa) => _foraDosSubstitutos(s, etapa), redigirTexto(String(texto || '')));
  }

  function verificarResiduos(textoAnonimizado) {
    const t = _semAcento(textoAnonimizado).toLowerCase();
    return {
      emails: (textoAnonimizado.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []).length,
      ips: (textoAnonimizado.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || []).length,
      cpfCnpj: (textoAnonimizado.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g) || []).length,
      nomesCompletosDoCadastro: [...dic.pessoas, ...dic.clientes].filter(n => n.length >= 6 && t.includes(_semAcento(n).toLowerCase())).length,
      primeirosNomesComuns: PRIMEIROS_NOMES.filter(n => _regexNomeProprio(n).test(textoAnonimizado)).length,
      termosExtra: (dic.termosExtra || []).filter(n => t.includes(_semAcento(n).toLowerCase())).length,
    };
  }

  return { anonimizar, verificarResiduos, contagens: () => sub.contagens() };
}

function _palavrasParaRevisao(texto) {
  const freq = new Map();
  for (const m of texto.matchAll(/(?<![\p{L}\d_-])\p{Lu}\p{Ll}{2,}(?![\p{L}\d_-])/gu)) freq.set(m[0], (freq.get(m[0]) || 0) + 1);
  return [...freq].filter(([, n]) => n <= 3).sort((a, b) => a[0].localeCompare(b[0])).map(([w]) => w).slice(0, 150);
}

function gerarAmostra({ saida, quantidade = 3, semente = 7, termosExtra = [] }) {
  const destino = path.resolve(saida);
  if ((destino + path.sep).toLowerCase().startsWith((RAIZ_REPO + path.sep).toLowerCase())) throw new Error(`Recusado: a amostra contém dados reais e não pode ser gravada dentro do repositório (${destino}).`);
  const db = new Database(DB_SERVICE, { readonly: true, fileMustExist: true });
  try {
    const anon = criarAnonimizador({ ...carregarDicionario(db), termosExtra });
    // Conversas com pelo menos 2 mensagens do analista/cliente e 1 resposta da IA;
    // seleção determinística por semente, preferindo as que têm anexo de texto.
    const candidatos = db.prepare(`
      SELECT a.id,
             SUM(m.papel = 'user') AS usuarios,
             SUM(m.papel = 'assistant') AS respostas,
             (SELECT COUNT(*) FROM anexos x WHERE x.atendimento_id = a.id AND x.conteudo_extraido IS NOT NULL) AS anexos
        FROM atendimentos a JOIN mensagens m ON m.atendimento_id = a.id AND m.excluida_em IS NULL
       GROUP BY a.id
      HAVING usuarios >= 2 AND respostas >= 1 AND COUNT(*) <= 16
    `).all();
    const ordenados = candidatos
      .map(c => ({ ...c, chave: (parseInt(c.id.replace(/-/g, '').slice(0, 8), 16) * semente) % 1000003 }))
      .sort((a, b) => (b.anexos > 0) - (a.anexos > 0) || a.chave - b.chave);
    const escolhidos = ordenados.slice(0, quantidade);
    const partes = ['# Amostra anonimizada para revisão', '', `Gerada em ${new Date().toISOString()} · ${escolhidos.length} conversa(s) de ${candidatos.length} elegíveis · semente ${semente}`, '',
      'Revise se sobrou nome de pessoa, cliente, empresa, contato, servidor ou qualquer dado que identifique alguém. Nada foi enviado a provedor externo.', ''];
    const residuos = [];
    escolhidos.forEach((c, i) => {
      const msgs = db.prepare('SELECT papel, origem_autor, conteudo FROM mensagens WHERE atendimento_id = ? AND excluida_em IS NULL ORDER BY criado_em, rowid').all(c.id);
      const anexos = db.prepare('SELECT nome_original, conteudo_extraido FROM anexos WHERE atendimento_id = ? AND conteudo_extraido IS NOT NULL ORDER BY criado_em LIMIT 3').all(c.id);
      partes.push(`## Conversa ${i + 1} (${msgs.length} mensagens, ${anexos.length} anexo(s) de texto)`, '');
      for (const m of msgs) {
        const autor = m.papel === 'assistant' ? 'IA' : (m.origem_autor ? anon.anonimizar(m.origem_autor) : 'Analista/Cliente');
        const texto = anon.anonimizar(String(m.conteudo || '').slice(0, 1500));
        residuos.push(anon.verificarResiduos(texto));
        partes.push(`**${m.papel === 'assistant' ? 'IA' : 'Usuário'} (${autor}):**`, '', texto.split('\n').map(l => `> ${l}`).join('\n'), '');
      }
      for (const a of anexos) {
        const texto = anon.anonimizar(String(a.conteudo_extraido).slice(0, 800));
        residuos.push(anon.verificarResiduos(texto));
        partes.push(`**Anexo ${anon.anonimizar(a.nome_original)} (trecho):**`, '', '```', texto, '```', '');
      }
    });
    const md = partes.join('\n');
    const totalResiduos = residuos.reduce((acc, r) => { for (const k of Object.keys(r)) acc[k] = (acc[k] || 0) + r[k]; return acc; }, {});
    fs.mkdirSync(destino, { recursive: true });
    fs.writeFileSync(path.join(destino, 'amostra-anonimizada.md'), md);
    fs.writeFileSync(path.join(destino, 'relatorio-anonimizacao.json'), JSON.stringify({
      geradoEm: new Date().toISOString(), conversas: escolhidos.length, elegiveis: candidatos.length,
      substituicoesPorCategoria: anon.contagens(), residuosDetectados: totalResiduos,
      palavrasCapitalizadasRarasParaRevisao: _palavrasParaRevisao(md),
    }, null, 2));
    return { destino, residuos: totalResiduos, substituicoes: anon.contagens() };
  } finally {
    db.close();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const valor = nome => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
  if (!valor('--saida')) { console.error('Informe --saida <pasta fora do repositório>.'); process.exit(1); }
  try {
    // --termos-extra: arquivo com um termo por linha (cidade, fazenda, projeto...)
    // que o cadastro não cobre. Fica fora do repositório, como a amostra.
    const termosExtra = valor('--termos-extra')
      ? fs.readFileSync(valor('--termos-extra'), 'utf8').split(/\r?\n/).map(t => t.trim()).filter(t => t.length >= 3)
      : [];
    const r = gerarAmostra({ saida: valor('--saida'), quantidade: Number(valor('--quantidade') || 3), semente: Number(valor('--semente') || 7), termosExtra });
    console.log(JSON.stringify(r, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { criarAnonimizador, gerarAmostra };
