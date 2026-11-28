'use strict';

// Monta o menu de setores, interpreta respostas e decide quando usar o setor padrão.
// Biblioteca pura, sem acesso a banco de dados ou rede.

function normalizar(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim().replace(/\s+/g, ' ');
}

function montarMenu({ saudacao, setores }) {
  const ordenados = [...setores].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));
  const opcoes = ordenados.map((setor, indice) => ({
    numero: indice + 1,
    setor_id: setor.id,
    rotulo: typeof setor.opcao_texto === 'string' && setor.opcao_texto.trim() ? setor.opcao_texto : setor.nome,
  }));
  const abertura = typeof saudacao === 'string' && saudacao.trim() ? saudacao.trim() : 'Olá! Escolha um setor:';
  const texto = [abertura, ...opcoes.map(({ numero, rotulo }) => `${numero} – ${rotulo}`), 'Responda com o número da opção.'].join('\n');
  return { texto, opcoes };
}

function interpretarResposta(texto, opcoes) {
  if (typeof texto !== 'string' || !texto.trim()) return { invalida: true };
  const resposta = normalizar(texto);
  if (['0', 'menu', 'voltar'].includes(resposta)) return { ajuda: true };

  const numero = resposta.match(/^(?:opcao\s+)?(\d+)(?:\.|\uFE0F?\u20E3)?$/u);
  if (numero) {
    const encontradas = opcoes.filter((opcao) => opcao.numero === Number(numero[1]));
    const rotulosNumericos = opcoes.filter((opcao) => normalizar(opcao.rotulo) === resposta);
    if (encontradas.length !== 1 || rotulosNumericos.some((opcao) => opcao !== encontradas[0])) {
      return { invalida: true };
    }
    return { setor_id: encontradas[0].setor_id };
  }

  const exatas = opcoes.filter((opcao) => normalizar(opcao.rotulo) === resposta);
  if (exatas.length === 1) return { setor_id: exatas[0].setor_id };
  if (exatas.length > 1) return { invalida: true };

  // Aceita pontuação comum, mas não ignora emojis ou outros símbolos.
  if (!/^[\p{L}\p{N}\s,.!?]+$/u.test(resposta)) return { invalida: true };
  const semCortesia = resposta.replace(/[,.!?]/g, ' ')
    .replace(/\b(?:por\s+favor|bom\s+dia|boa\s+tarde|boa\s+noite)\b/g, ' ');
  const cortesias = new Set(['quero', 'queria', 'gostaria', 'falar', 'com', 'o', 'a', 'os', 'as', 'de', 'do', 'da', 'setor', 'favor', 'pfv', 'oi', 'ola']);
  const palavras = semCortesia.trim().split(/\s+/).filter((palavra) => palavra && !cortesias.has(palavra));
  if (!palavras.length) return { invalida: true };
  if (palavras.length === 1 && /^\d+$/.test(palavras[0])) return interpretarResposta(palavras[0], opcoes);
  if (palavras.some((palavra) => /^\d+$/.test(palavra))) return { invalida: true };
  const parecidas = opcoes.filter((opcao) => {
    const palavrasRotulo = normalizar(opcao.rotulo).match(/[\p{L}\p{N}]+/gu) || [];
    return palavras.every((palavra) => palavrasRotulo.includes(palavra));
  });
  return parecidas.length === 1 ? { setor_id: parecidas[0].setor_id } : { invalida: true };
}

function proximaAcao({ tentativas, maxTentativas = 2 }) {
  return tentativas >= maxTentativas ? 'setor_padrao' : 'repetir';
}

module.exports = { montarMenu, interpretarResposta, proximaAcao };
