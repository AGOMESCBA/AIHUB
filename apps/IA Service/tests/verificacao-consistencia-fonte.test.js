'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const provider = require('../backend/services/ai-provider-client');
const config = require('../backend/services/ai-config-service');
const { verificar } = require('../backend/services/verificacao-consistencia-fonte-service');

test('verificador exige prova causal rastreável; citação literal isolada e nova regra não bloqueiam', async () => {
  const chamar = provider.chamarIA, resolver = config.resolverKeysEOrdem;
  const cfg = { provedorPrimario: 'primario-platform', fallbackOrdem: 'fallback-platform' };
  const textoOriginal = `User Function Teste()\nLocal lRet := .T.\nIf !Empty(cUser)\n${'// contexto\n'.repeat(50)}    MsSeek(cUser)\nEndIf\nReturn lRet`;
  // Exercita o contrato do verificador IA para casos fora da prova ADVPL local.
  const args = { empresaId: 1, pedido: 'Evite buscar usuário vazio.', diagnostico: 'A busca executa mesmo com usuário vazio.', arquivo: 'Teste.cs', textoOriginal, alteracoes: [{ original: '    MsSeek(cUser)', substituto: '    MsSeek(Alltrim(cUser))', justificativa: 'Evita buscar usuário vazio.' }] };
  const prova = { status: 'contradicao', motivo: 'A busca já é protegida.', afirmacao: args.diagnostico, evidencia: 'If !Empty(cUser)', demonstracao: 'O If envolve o MsSeek. Quando cUser é vazio, a condição é falsa e a busca não executa. O pedido é somente evitar a busca vazia.', novaRegraSolicitada: false };
  let resposta;
  try {
    config.resolverKeysEOrdem = () => ({ keys: {}, cfg });
    provider.chamarIA = async (_keys, ordem, _system, user) => {
      assert.strictEqual(ordem, cfg, 'mesma configuração resolvida pela Platform');
      assert.ok(JSON.parse(user).alteracoes[0].contextoDoOriginal.includes('Local lRet := .T.'), 'rotina completa, além das antigas 30 linhas');
      if (resposta instanceof Error) throw resposta;
      return { texto: typeof resposta === 'string' ? resposta : JSON.stringify(resposta), provider: 'fixture', model: 'fixture' };
    };
    for (const [v, status] of [
      [prova, 'contradicao'],
      [{ contradicao: true, evidencia: prova.evidencia, motivo: 'Há If' }, 'inconclusiva'],
      [{ ...prova, novaRegraSolicitada: true }, 'inconclusiva'],
      [{ ...prova, demonstracao: '' }, 'inconclusiva'],
      [{ ...prova, afirmacao: 'Afirmação inexistente no diagnóstico' }, 'inconclusiva'],
      [{ ...prova, evidencia: 'If !Empty(variavelInventada)' }, 'inconclusiva'],
      [{ ...prova, status: 'inconclusiva' }, 'inconclusiva'],
      [{ status: 'consistente' }, 'consistente'],
      ['não é JSON', 'indisponivel'],
      [new Error('provider indisponível'), 'indisponivel'],
    ]) {
      resposta = v;
      assert.equal((await verificar(args)).status, status, JSON.stringify(v));
    }
  } finally { provider.chamarIA = chamar; config.resolverKeysEOrdem = resolver; }
});

test('fallback vazio cadastrado na Platform permanece vazio', () => {
  const platform = require('../../IAHUB/backend/platform-store');
  const repo = require('../backend/repositories/ai-config-repository');
  const getPlatform = platform.getAiConfig, getLegado = repo.getConfig;
  try {
    repo.getConfig = () => null;
    platform.getAiConfig = () => ({ provedorPrimario: 'claude', fallbackOrdem: '', claudeModelo: 'modelo-cadastrado' });
    const { cfg } = config.resolverKeysEOrdem(1);
    assert.equal(cfg.fallbackOrdem, ''); assert.equal(cfg.provedorPrimario, 'claude');
    assert.equal(cfg.modelos.claude, 'modelo-cadastrado');
    platform.getAiConfig = () => null;
    const semConfig = config.resolverKeysEOrdem(1).cfg;
    assert.equal(semConfig.provedorPrimario, null);
    assert.equal(semConfig.fallbackOrdem, '');
  } finally { platform.getAiConfig = getPlatform; repo.getConfig = getLegado; }
});
