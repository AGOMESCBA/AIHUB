'use strict';

/**
 * Aplica propostas de correcao de spec (status='aprovado') diretamente no
 * arquivo *-fragmentos-spec.js do modulo, trocando o corpo do template
 * literal de uma funcao top-level pelo texto_proposto.
 *
 * Seguranca: so aplica quando a funcao do fragmento for uma declaracao
 * top-level `function nome() { return \`...\`; }` SEM parametros e SEM
 * interpolacao `${}` no corpo. Qualquer outro padrao (interpolacao por
 * tenant, arrow function parametrizada, etc.) e recusado, com motivo
 * explicito, para nao arriscar corromper logica condicional do spec.
 */

const fs = require('fs');
const path = require('path');

const ARQUIVOS_POR_MODULO = {
  financeiro: path.join(__dirname, '..', 'erp', 'financeiro', 'financeiro-fragmentos-spec.js'),
  faturamento: path.join(__dirname, '..', 'erp', 'faturamento', 'faturamento-fragmentos-spec.js'),
  compras: path.join(__dirname, '..', 'erp', 'compras', 'compras-fragmentos-spec.js'),
  comissao: path.join(__dirname, '..', 'erp', 'comissao', 'comissao-fragmentos-spec.js'),
};

function normalizarModulo(modulo) {
  return String(modulo || '').replace('_dinamico', '').trim();
}

// Acha o indice de fechamento do bloco que abre em openIndex (chave em source[openIndex]),
// contando aninhamento de chaves/parenteses/colchetes.
function indiceFechamento(source, openIndex, abre, fecha) {
  let nivel = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === abre) nivel++;
    else if (source[i] === fecha) { nivel--; if (nivel === 0) return i; }
  }
  return -1;
}

// Extrai o nome da funcao referenciada em `texto: nomeDaFuncao,` dentro do
// objeto FRAGMENTOS. Retorna null se o valor nao for um identificador puro
// (ex: arrow function, chamada parametrizada).
function extrairNomeFuncaoDoFragmento(source, chaveFragmento) {
  const reChave = new RegExp(`\\b${chaveFragmento}\\s*:\\s*\\{`, 'g');
  const match = reChave.exec(source);
  if (!match) return { erro: `Chave "${chaveFragmento}" nao encontrada em FRAGMENTOS.` };
  const aberturaObjeto = source.indexOf('{', match.index);
  const fechamentoObjeto = indiceFechamento(source, aberturaObjeto, '{', '}');
  if (fechamentoObjeto === -1) return { erro: 'Nao foi possivel delimitar o objeto do fragmento.' };
  const blocoFragmento = source.slice(aberturaObjeto, fechamentoObjeto + 1);

  const reTexto = /\btexto\s*:\s*([^\n,}]+)/;
  const matchTexto = blocoFragmento.match(reTexto);
  if (!matchTexto) return { erro: 'Fragmento nao possui propriedade "texto".' };
  const valor = matchTexto[1].trim();

  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(valor)) {
    return { erro: `O campo "texto" deste fragmento nao e uma referencia direta a funcao (valor: "${valor}"). Provavelmente usa parametros (ex: granularidade) ou interpolacao dinamica — edite manualmente.` };
  }
  return { nomeFuncao: valor };
}

// Localiza `function nomeFuncao(...) { return \`...\`; }` top-level e retorna
// os indices do template literal (incluindo as crases) e se ha parametros/interpolacao.
function localizarTemplateDaFuncao(source, nomeFuncao) {
  const reFuncao = new RegExp(`function\\s+${nomeFuncao}\\s*\\(([^)]*)\\)\\s*\\{`, 'g');
  const matchFuncao = reFuncao.exec(source);
  if (!matchFuncao) return { erro: `Funcao "${nomeFuncao}" nao encontrada no arquivo de spec.` };

  const parametros = matchFuncao[1].trim();
  const corpoInicio = matchFuncao.index + matchFuncao[0].length - 1; // posicao do '{'
  const corpoFim = indiceFechamento(source, corpoInicio, '{', '}');
  if (corpoFim === -1) return { erro: `Nao foi possivel delimitar o corpo da funcao "${nomeFuncao}".` };
  const corpo = source.slice(corpoInicio, corpoFim + 1);

  const crasesInicio = corpo.indexOf('`');
  const crasesFim = corpo.lastIndexOf('`');
  if (crasesInicio === -1 || crasesFim === crasesInicio) {
    return { erro: `Funcao "${nomeFuncao}" nao retorna um template literal simples — edite manualmente.` };
  }
  const textoTemplate = corpo.slice(crasesInicio + 1, crasesFim);

  if (parametros) {
    return { erro: `Funcao "${nomeFuncao}" recebe parametros (${parametros}) — pode gerar texto diferente por tenant/contexto. Edite manualmente em ${nomeFuncao}().` };
  }
  if (textoTemplate.includes('${')) {
    return { erro: `Funcao "${nomeFuncao}" usa interpolacao dinamica (\${...}) no corpo — edite manualmente em ${nomeFuncao}().` };
  }

  const inicioAbsoluto = corpoInicio + crasesInicio;
  const fimAbsoluto = corpoInicio + crasesFim;
  return { textoTemplate, inicioAbsoluto, fimAbsoluto, nomeFuncao };
}

// O texto proposto e gravado entre crases de um template literal (`...`) no arquivo
// de spec. Uma crase literal no texto fecharia o template prematuramente e corromperia
// a sintaxe JS do arquivo inteiro (derrubando o modulo no proximo require). Por isso
// textoProposto nunca pode conter crase — diagnostico/correcao tecnica nao precisa dela.
function textoPropostoEhSeguro(textoProposto) {
  return !String(textoProposto || '').includes('`');
}

// Retorna { aplicavel, motivo?, arquivo, nomeFuncao?, textoAtualArquivo?, previewSource? }
function avaliar({ modulo, fragmentoAfetado, textoProposto }) {
  const chaveModulo = normalizarModulo(modulo);
  const arquivo = ARQUIVOS_POR_MODULO[chaveModulo];
  if (!arquivo) return { aplicavel: false, motivo: `Modulo "${modulo}" nao possui arquivo de fragmentos mapeado.` };
  if (!fragmentoAfetado) return { aplicavel: false, motivo: 'Proposta nao possui fragmento identificado — nao ha onde aplicar automaticamente.', arquivo };
  if (!fs.existsSync(arquivo)) return { aplicavel: false, motivo: `Arquivo nao encontrado: ${arquivo}`, arquivo };
  if (textoProposto !== undefined && !textoPropostoEhSeguro(textoProposto)) {
    return { aplicavel: false, motivo: 'O texto proposto contem uma crase (`) — isso corromperia o template literal do arquivo de spec. Remova a crase (ex: troque `campo` por "campo") e tente novamente.', arquivo };
  }

  const source = fs.readFileSync(arquivo, 'utf8');
  const refFuncao = extrairNomeFuncaoDoFragmento(source, fragmentoAfetado);
  if (refFuncao.erro) return { aplicavel: false, motivo: refFuncao.erro, arquivo };

  const localizado = localizarTemplateDaFuncao(source, refFuncao.nomeFuncao);
  if (localizado.erro) return { aplicavel: false, motivo: localizado.erro, arquivo };

  return {
    aplicavel: true,
    arquivo,
    nomeFuncao: localizado.nomeFuncao,
    textoAtualArquivo: localizado.textoTemplate,
  };
}

// Aplica a substituicao no arquivo, escrevendo textoProposto no lugar do
// corpo do template literal. Retorna { ok, arquivo, motivo? }.
function aplicar({ modulo, fragmentoAfetado, textoProposto }) {
  if (!String(textoProposto || '').trim()) {
    return { ok: false, motivo: 'Texto proposto vazio — nada para aplicar.' };
  }
  if (!textoPropostoEhSeguro(textoProposto)) {
    return { ok: false, motivo: 'O texto proposto contem uma crase (`) — isso corromperia o template literal do arquivo de spec. Remova a crase (ex: troque `campo` por "campo") e tente novamente.' };
  }
  const chaveModulo = normalizarModulo(modulo);
  const arquivo = ARQUIVOS_POR_MODULO[chaveModulo];
  if (!arquivo) return { ok: false, motivo: `Modulo "${modulo}" nao possui arquivo de fragmentos mapeado.` };

  const source = fs.readFileSync(arquivo, 'utf8');
  const refFuncao = extrairNomeFuncaoDoFragmento(source, fragmentoAfetado);
  if (refFuncao.erro) return { ok: false, motivo: refFuncao.erro, arquivo };

  const localizado = localizarTemplateDaFuncao(source, refFuncao.nomeFuncao);
  if (localizado.erro) return { ok: false, motivo: localizado.erro, arquivo };

  const novoConteudo =
    source.slice(0, localizado.inicioAbsoluto + 1) +
    textoProposto +
    source.slice(localizado.fimAbsoluto);

  fs.writeFileSync(arquivo, novoConteudo, 'utf8');
  return { ok: true, arquivo, nomeFuncao: localizado.nomeFuncao };
}

module.exports = { avaliar, aplicar, ARQUIVOS_POR_MODULO };
