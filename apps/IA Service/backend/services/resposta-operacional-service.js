// Monta uma ficha operacional curta a partir da resposta estruturada ja
// persistida em mensagens.diagnostico_json. Nao chama LLM nem altera o texto
// original; e uma camada de apresentacao/contrato compativel.

function _limpar(texto) {
  return String(texto || '').replace(/\s+/g, ' ').trim();
}

function _primeiraLinhaUtil(texto) {
  const linhas = String(texto || '')
    .split(/\r?\n/)
    .map(l => l.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
  return linhas[0] || '';
}

function _semCodigo(texto) {
  return String(texto || '').replace(/```[\s\S]*?```/g, '').trim();
}

function _tipoDiagnostico(secoes = {}, nivelConfianca, textoCompleto = '') {
  const base = _limpar([
    nivelConfianca,
    secoes['Diagnóstico'],
    secoes['Causa provável'],
    textoCompleto,
  ].filter(Boolean).join(' ')).toLowerCase();

  if (/insuficient|sem evid[eê]ncia|n[aã]o h[aá] dados|precis[ao] de|falta(m)?\b/.test(base)) return 'evidencia_insuficiente';
  if (/causa confirmada|confirmad[ao]|diagn[oó]stico confirmado|sustentad[ao] por/.test(base)) return 'causa_confirmada';
  if (/hip[oó]tese|prov[aá]vel|poss[ií]vel|suspeit|ind[ií]cio/.test(base)) return 'hipotese_principal';
  return secoes['Diagnóstico'] || secoes['Causa provável'] ? 'hipotese_principal' : 'sem_estrutura';
}

function _rotuloDiagnostico(tipo) {
  if (tipo === 'causa_confirmada') return 'Diagnóstico';
  if (tipo === 'evidencia_insuficiente') return 'Investigação incompleta';
  if (tipo === 'sem_estrutura') return 'Resumo';
  return 'Hipótese técnica';
}

function _diagnosticoPrincipal(secoes = {}, tipo, textoCompleto = '') {
  if (tipo === 'evidencia_insuficiente') {
    return _primeiraLinhaUtil(secoes['Diagnóstico'] || secoes['Causa provável'] || secoes['Correção proposta'] || textoCompleto)
      || 'Ainda faltam evidências para fechar uma causa.';
  }
  return _primeiraLinhaUtil(secoes['Diagnóstico'])
    || _primeiraLinhaUtil(secoes['Causa provável'])
    || _primeiraLinhaUtil(textoCompleto)
    || 'Resposta registrada.';
}

function _acaoPrincipal(secoes = {}, tipo) {
  const correcao = _primeiraLinhaUtil(_semCodigo(secoes['Correção proposta']));
  if (correcao) return correcao;
  const validacao = _primeiraLinhaUtil(secoes['Validação']);
  if (tipo === 'evidencia_insuficiente') {
    return validacao || 'Coletar a evidência específica solicitada antes de concluir a causa.';
  }
  return validacao || '';
}

function _evidenciaPrincipal(secoes = {}) {
  return _primeiraLinhaUtil(secoes['Evidências']) || '';
}

function _validacaoPrincipal(secoes = {}) {
  return _primeiraLinhaUtil(secoes['Validação']) || '';
}

function _proximoPasso(secoes = {}, tipo) {
  if (tipo === 'evidencia_insuficiente') {
    return _primeiraLinhaUtil(secoes['Correção proposta'])
      || _primeiraLinhaUtil(secoes['Validação'])
      || 'Enviar o log, print, fonte ou dado que diferencie a falha.';
  }
  return _primeiraLinhaUtil(secoes['Validação']) || '';
}

function _detalhes(secoes = {}, textoCompleto = '') {
  const ordem = ['Diagnóstico', 'Causa provável', 'Evidências', 'Correção proposta', 'Fonte corrigido', 'Alterações realizadas', 'Validação'];
  const itens = ordem
    .filter(titulo => secoes[titulo])
    .map(titulo => ({ titulo, conteudo: secoes[titulo] }));
  if (!itens.length && textoCompleto) itens.push({ titulo: 'Resposta original', conteudo: textoCompleto });
  return itens;
}

function construirFichaOperacional({
  diagnostico, nivelConfianca, conteudo, fontesCorrigidos = [], avisosFonteCorrigido = [],
  validacaoSolucao = null,
} = {}) {
  const secoes = diagnostico || {};
  const tipo = _tipoDiagnostico(secoes, nivelConfianca, conteudo);
  const ficha = {
    versao: 1,
    tipo,
    rotuloDiagnostico: _rotuloDiagnostico(tipo),
    diagnostico: _diagnosticoPrincipal(secoes, tipo, conteudo),
    acaoRecomendada: _acaoPrincipal(secoes, tipo),
    evidencia: _evidenciaPrincipal(secoes),
    validacao: _validacaoPrincipal(secoes),
    proximoPasso: _proximoPasso(secoes, tipo),
    possuiArquivoCorrigido: Array.isArray(fontesCorrigidos) && fontesCorrigidos.length > 0,
    avisos: avisosFonteCorrigido || [],
    detalhes: _detalhes(secoes, conteudo),
    // Fase 3: estado atual de confirmação da orientação (RESOLVEU/NAO_RESOLVEU/
    // PARCIALMENTE/NAO_TESTADO/EVIDENCIA_EXTERNA/AGUARDANDO_VALIDACAO). Apenas
    // apresentação — nunca derivado aqui, sempre vindo já calculado de
    // validacao-solucao-repository.obterEstadoAtual (regra de precedência
    // confirmação > evidência externa é resolvida lá, não nesta camada).
    validacaoSolucao: validacaoSolucao || { status: 'AGUARDANDO_VALIDACAO', ultimaConfirmacao: null, ultimaEvidencia: null, historico: [] },
  };

  ficha.camposPreenchidos = ['diagnostico', 'acaoRecomendada', 'evidencia', 'validacao', 'proximoPasso']
    .filter(campo => _limpar(ficha[campo]));
  ficha.temEstrutura = ficha.camposPreenchidos.length > 0 || ficha.detalhes.length > 0;
  return ficha;
}

function anexarFichaOperacional(mensagem, extras = {}) {
  if (!mensagem || mensagem.papel !== 'assistant') return mensagem;
  return {
    ...mensagem,
    respostaOperacional: construirFichaOperacional({
      diagnostico: mensagem.diagnostico,
      nivelConfianca: mensagem.nivelConfianca,
      conteudo: mensagem.conteudo,
      fontesCorrigidos: extras.fontesCorrigidos || mensagem.fontesCorrigidos || [],
      avisosFonteCorrigido: extras.avisosFonteCorrigido || mensagem.avisosFonteCorrigido || [],
      validacaoSolucao: extras.validacaoSolucao || null,
    }),
  };
}

module.exports = {
  construirFichaOperacional,
  anexarFichaOperacional,
  _tipoDiagnostico,
};
