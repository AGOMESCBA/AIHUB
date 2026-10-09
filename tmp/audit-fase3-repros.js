const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-audit-fase3-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../apps/IA Service/backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../apps/IA Service/backend/repositories/atendimento-repository');
const mensagemRepo = require('../apps/IA Service/backend/repositories/mensagem-repository');
const validacaoRepo = require('../apps/IA Service/backend/repositories/validacao-solucao-repository');
const validacaoService = require('../apps/IA Service/backend/services/validacao-solucao-service');
const dossieRepo = require('../apps/IA Service/backend/repositories/investigacao-dossie-repository');
const registrarRotas = require('../apps/IA Service/backend/routes');

const EMPRESA = 99031;

async function iniciarAppTeste() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user_id: 123 };
    next();
  });
  registrarRotas(app, {
    requireAuth: (_req, _res, next) => next(),
    requireIaService: (req, _res, next) => {
      req.svcEmpresaId = Number(req.query?.empresa_id || EMPRESA);
      next();
    },
  });
  const server = await new Promise(resolve => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function criarAtendimentoComAssistente(conteudo) {
  const atendimento = atendimentoRepo.criarAtendimento(EMPRESA, {
    origem: 'manual',
    canalEntrada: 'web',
    conteudoBruto: conteudo,
  });
  const mensagem = mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, {
    papel: 'assistant',
    conteudo,
  });
  return { atendimento, mensagem };
}

async function main() {
  const resultados = [];

  const a = criarAtendimentoComAssistente('Orientacao do atendimento A.');
  const b = criarAtendimentoComAssistente('Orientacao do atendimento B.');
  validacaoService.confirmarSolucao(EMPRESA, {
    atendimentoId: b.atendimento.id,
    mensagemAssistenteId: b.mensagem.id,
    resultado: 'RESOLVEU',
    comentario: 'Confirmado no atendimento B.',
    usuarioId: 123,
  });
  const { server, baseUrl } = await iniciarAppTeste();
  try {
    const resp = await fetch(`${baseUrl}/api/ia-service/atendimentos/${a.atendimento.id}/mensagens/${b.mensagem.id}/validacao?empresa_id=${EMPRESA}`);
    resultados.push({
      teste: 'GET validacao ignora atendimentoId da rota',
      esperado: '404 ou rejeicao por mensagem fora do atendimento',
      observado: `${resp.status} ${JSON.stringify(await resp.json())}`,
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  const pendente = criarAtendimentoComAssistente('Orientacao sem validacao ainda.');
  const resumo = validacaoRepo.obterResumoPorEmpresa(EMPRESA);
  resultados.push({
    teste: 'Resumo agregado conta orientacao sem evento',
    esperado: 'AGUARDANDO_VALIDACAO >= 1',
    observado: JSON.stringify({ aguardando: resumo.AGUARDANDO_VALIDACAO, mensagemSemEvento: pendente.mensagem.id, resumo }),
  });

  const multi = atendimentoRepo.criarAtendimento(EMPRESA, {
    origem: 'manual',
    canalEntrada: 'web',
    conteudoBruto: 'Atendimento com tres orientacoes.',
  });
  const msg1 = mensagemRepo.salvarMensagem(EMPRESA, multi.id, { papel: 'assistant', conteudo: 'Primeira orientacao antiga.' });
  mensagemRepo.salvarMensagem(EMPRESA, multi.id, { papel: 'assistant', conteudo: 'Segunda orientacao ainda sem validacao.' });
  mensagemRepo.salvarMensagem(EMPRESA, multi.id, { papel: 'assistant', conteudo: 'Terceira orientacao ainda sem validacao.' });
  validacaoService.confirmarSolucao(EMPRESA, {
    atendimentoId: multi.id,
    mensagemAssistenteId: msg1.id,
    resultado: 'RESOLVEU',
    comentario: 'Confirmando apenas a primeira orientacao.',
    usuarioId: 123,
  });
  const dossie = dossieRepo.getDossiePorAtendimento(EMPRESA, multi.id);
  resultados.push({
    teste: 'Confirmar primeira orientacao em atendimento com varias orientacoes',
    esperado: 'estado global nao deveria resolver todo o atendimento sem considerar orientacoes posteriores',
    observado: JSON.stringify({ statusDossie: dossie.status, solucaoAplicada: dossie.solucaoAplicada, atualizadoPorMensagemId: dossie.atualizadoPorMensagemId }),
  });

  const dup = validacaoService.registrarEvidenciaExternaDeChamado(EMPRESA, {
    atendimentoId: b.atendimento.id,
    mensagemAssistenteId: b.mensagem.id,
    chamadoId: 'CH-1',
    statusEncerramentoTransicao: { de: 'Andamento', para: 'Encerrado', reabertura: false },
  });
  const dup2 = validacaoService.registrarEvidenciaExternaDeChamado(EMPRESA, {
    atendimentoId: b.atendimento.id,
    mensagemAssistenteId: b.mensagem.id,
    chamadoId: 'CH-1',
    statusEncerramentoTransicao: { de: 'Andamento', para: 'Encerrado', reabertura: false },
  });
  resultados.push({
    teste: 'Idempotencia de evidencia externa sem timestamp/evento de origem',
    esperado: 'eventos iguais em momentos distintos precisariam chavear tambem pelo evento externo',
    observado: JSON.stringify({ primeiroDuplicado: dup.duplicado, segundoDuplicado: dup2.duplicado }),
  });

  const db = database.getDB();
  const mesmaHora = '2026-10-08T12:00:00.000Z';
  const tie = criarAtendimentoComAssistente('Orientacao com empate temporal.');
  db.prepare(`
    INSERT INTO validacoes_solucao (
      id, empresa_id, atendimento_id, mensagem_assistente_id, origem, resultado, comentario, criado_em
    ) VALUES (?, ?, ?, ?, 'confirmacao_analista', ?, ?, ?)
  `).run('tie-1', EMPRESA, tie.atendimento.id, tie.mensagem.id, 'NAO_RESOLVEU', 'primeiro', mesmaHora);
  db.prepare(`
    INSERT INTO validacoes_solucao (
      id, empresa_id, atendimento_id, mensagem_assistente_id, origem, resultado, comentario, criado_em
    ) VALUES (?, ?, ?, ?, 'confirmacao_analista', ?, ?, ?)
  `).run('tie-2', EMPRESA, tie.atendimento.id, tie.mensagem.id, 'RESOLVEU', 'segundo', mesmaHora);
  resultados.push({
    teste: 'Empate de criado_em em eventos da mesma mensagem',
    esperado: 'ordenacao deterministica por criado_em + id/rowid',
    observado: JSON.stringify(validacaoRepo.obterEstadoAtual(EMPRESA, tie.mensagem.id)),
  });

  console.log(JSON.stringify(resultados, null, 2));
}

function limpar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(limpar);
