'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { localizarErros, analisarBuffer, MAX_BYTES } = require('../backend/services/analise-log-service');
const buffer = texto => Buffer.from(texto);
const incidente = (mensagem = 'Variable does not exist CTEST on U_TESTE(TESTE.PRW) line 42', hora = '10:00:00') =>
  `THREAD ERROR ([123], teste) 03/11/2026 ${hora}\n${mensagem}\nCalled from U_TESTE(TESTE.PRW) line 42\n`;

test('localiza erro no final de arquivo maior que limites de extração usuais', () => {
  const prefixo = 'Informação normal do ambiente\n'.repeat(45000);
  const r = localizarErros(buffer(prefixo + incidente()), 'error.log');
  assert.equal(r.cobertura.varreduraCompleta, true);
  assert.equal(r.cobertura.ocorrencias, 1);
  assert.equal(r.grupos[0].linhas[0], 45001);
  assert.match(r.grupos[0].evidencia[1].texto, /Variable does not exist/);
});

test('agrupa repetições com horários diferentes e separa mensagem e rotina diferentes', () => {
  const r = localizarErros(buffer(incidente() + incidente(undefined, '11:00:00') + incidente('Type mismatch on U_OUTRO(OUTRO.PRW) line 9')), 'ERROR.LOG');
  assert.equal(r.cobertura.ocorrencias, 3);
  assert.equal(r.grupos.length, 2);
  assert.equal(r.grupos[0].quantidade, 2);
  assert.deepEqual(r.grupos[0].linhas, [1, 4]);
});

test('incidentes genéricos consecutivos permanecem separados', () => {
  const r = localizarErros(buffer('ERROR: conexão indisponível\nERROR: falha de disco'), 'console.log');
  assert.equal(r.grupos.length, 2);
});

test('aceita .log.txt e reconhece falha de negócio dentro de INFO e erros SERVER', () => {
  const texto = '2026-10-28T14:16:44.649000-04:00 123|\r\n' +
    '----------U_TESTE(80)----------\r\n' +
    '[INFO]Msg...:[Erro ao cancelar o Workflow: WF.001/2026 | Não foi encontrado um workflow com este identificador]\r\n' +
    '[ERROR][SERVER] [Thread 456] deleting thread Pool, POOL.TESTE\r\n' +
    '[ERROR][SERVER] [Thread 456] deleting server, TESTE\r\n';
  const r = localizarErros(buffer(texto), 'error_mod1.LOG.TXT');
  assert.equal(r.cobertura.ocorrencias, 3);
  assert.equal(r.grupos.length, 3);
  assert.match(r.grupos[0].titulo, /Erro ao cancelar/);
  assert.equal(r.grupos[0].contextoAnterior[0].linha, 1);
  assert.match(r.grupos[0].contextoAnterior[1].texto, /U_TESTE/);
  assert.deepEqual(r.grupos.map(g => g.linhas[0]), [3, 4, 5]);
});

test('contexto de parada e PRX seguem para IA com horários originais e sem duplicar a mensagem de THREAD', async () => {
  let enviado;
  const conteudo = '2026-10-28T14:20:01.048000-04:00 123|\n' +
    '[INFO ][SERVER] Application Server Service Stopped...\n' +
    'THREAD ERROR ([123], TESTE) 28/10/2026 14:20:01\n' +
    'Application Server is Shutting Down. on FWTABLEDDL:OPENTABLE(FWTABLEDDL.PRX) 14/08/2026 17:28:01\n';
  const r = await analisarBuffer(1, buffer(conteudo), 'x.log.txt', {
    config: { resolverKeysEOrdem: () => ({ keys: {}, cfg: {} }) },
    client: { chamarIA: async (_keys, _cfg, _system, user) => { enviado = JSON.parse(user); return { texto: '{"analises":[]}' }; } },
  });
  assert.equal(r.cobertura.ocorrencias, 1);
  assert.match(r.grupos[0].rotina, /FWTABLEDDL\.PRX/);
  assert.equal(r.contextoArquivo.length, 1);
  assert.equal(enviado.contextoArquivo[0].linha, 2);
  assert.match(enviado.incidentes[0].contextoAnterior[0].texto, /2026-10-28/);
  assert.match(enviado.incidentes[0].evidencia[0].texto, /28\/10\/2026 14:20:01/);
});

test('detecta UTF-8, Windows-1252 e UTF-16 com BOM preservando acentos', () => {
  for (const [b, encoding] of [
    [buffer('ERROR: conexão'), 'utf-8'],
    [Buffer.from('ERROR: conex\xe3o', 'latin1'), 'windows-1252'],
    [Buffer.concat([Buffer.from([255, 254]), Buffer.from('ERROR: conexão', 'utf16le')]), 'utf-16le'],
  ]) {
    const r = localizarErros(b, 'error.log');
    assert.equal(r.arquivo.encoding, encoding);
    assert.match(r.grupos[0].titulo, /conexão/);
  }
});

test('recusa arquivo inválido, vazio, binário ou acima do limite', () => {
  assert.throws(() => localizarErros(buffer('error'), 'x.txt'), /extensão/);
  assert.throws(() => localizarErros(Buffer.alloc(0), 'x.log'), /vazio/);
  assert.throws(() => localizarErros(Buffer.from([0, 1, 2]), 'x.log'), /textual/);
  assert.throws(() => localizarErros(Buffer.alloc(MAX_BYTES + 1), 'x.log'), /20 MB/);
  assert.throws(() => localizarErros(buffer('%PDF-1.7'), 'x.log'), /textual/);
  assert.throws(() => localizarErros(Buffer.from([255, 254, 65]), 'x.log'), /codificação/);
});

test('limites de grupos e localizações não reduzem contagem de ocorrências', () => {
  const r = localizarErros(buffer(incidente().repeat(55) + Array.from({ length: 110 }, (_, i) => incidente(`Erro específico ${i}`)).join('')), 'x.log');
  assert.equal(r.cobertura.ocorrencias, 165);
  assert.equal(r.grupos.length, 100);
  assert.equal(r.grupos[0].linhas.length, 40);
  assert.equal(r.grupos[0].quantidade, 55);
  assert.equal(r.cobertura.ocorrenciasNaoRetidas, 11);
});

test('mascara credenciais nas evidências e no contexto enviado à IA', async () => {
  let prompt;
  const r = await analisarBuffer(1, buffer(incidente('ERROR: token=SEGREDO123 senha=SENHA123')), 'x.log', {
    config: { resolverKeysEOrdem: () => ({ keys: {}, cfg: {} }) },
    client: { chamarIA: async (_keys, _cfg, _system, user) => {
      prompt = user;
      return { texto: JSON.stringify({ analises: [{ id: 'erro-1', explicacao: 'Falha observada.', causaProvavel: 'Precisa confirmar.', solucoes: 'Consultar suporte.', validacao: 'Repetir operação.', informacoesFaltantes: 'Fonte.' }] }) };
    } },
  });
  assert.doesNotMatch(JSON.stringify(r), /SEGREDO123|SENHA123/);
  assert.doesNotMatch(prompt, /SEGREDO123|SENHA123/);
  assert.equal(r.ia.gruposAnalisados, 1);
  assert.equal(r.grupos[0].analise.explicacao, 'Falha observada.');
});

test('sem erro reconhecido não chama IA', async () => {
  const r = await analisarBuffer(1, buffer('Ambiente iniciado\nOperação concluída'), 'x.log', {
    config: { resolverKeysEOrdem: () => { throw new Error('não deve chamar'); } },
  });
  assert.equal(r.grupos.length, 0);
  assert.equal(r.ia, undefined);
});

test('falha, JSON inválido e resposta truncada da IA preservam evidências', async () => {
  for (const resposta of [new Error('chave secreta interna'), { texto: 'inválido' }, { texto: '{}', truncado: true }]) {
    const r = await analisarBuffer(1, buffer(incidente()), 'x.log', {
      config: { resolverKeysEOrdem: () => ({ keys: {}, cfg: {} }) },
      client: { chamarIA: async () => { if (resposta instanceof Error) throw resposta; return resposta; } },
    });
    assert.equal(r.ia.indisponivel, true);
    assert.equal(r.grupos.length, 1);
    assert.doesNotMatch(JSON.stringify(r), /chave secreta interna/);
  }
});

test('IDs desconhecidos e respostas incompletas não viram diagnósticos', async () => {
  const r = await analisarBuffer(1, buffer(incidente()), 'x.log', {
    config: { resolverKeysEOrdem: () => ({ keys: {}, cfg: {} }) },
    client: { chamarIA: async () => ({ texto: JSON.stringify({ analises: [{ id: 'erro-999' }, { id: 'erro-1', explicacao: 'não basta' }] }) }) },
  });
  assert.equal(r.ia.gruposAnalisados, 0);
  assert.equal(r.grupos[0].analise, undefined);
  assert.ok(r.avisos.some(a => /não retornou/.test(a)));
});

test('permite analisar individualmente grupo além dos oito iniciais', async () => {
  let prompt;
  const conteudo = buffer(Array.from({ length: 10 }, (_, i) => incidente(`Erro distinto ${i}`)).join(''));
  const r = await analisarBuffer(1, conteudo, 'x.log', {
    config: { resolverKeysEOrdem: () => ({ keys: {}, cfg: {} }) },
    client: { chamarIA: async (_keys, _cfg, _system, user) => {
      prompt = JSON.parse(user);
      return { texto: JSON.stringify({ analises: [{ id: 'erro-10', explicacao: 'Falha.', causaProvavel: 'A confirmar.', solucoes: 'Consultar suporte.', validacao: 'Repetir operação.', informacoesFaltantes: 'Fonte.' }] }) };
    } },
  }, 'erro-10');
  assert.equal(prompt.incidentes.length, 1);
  assert.equal(prompt.incidentes[0].id, 'erro-10');
  assert.equal(r.grupos[9].analise.explicacao, 'Falha.');
  assert.equal(r.grupos[0].analise, undefined);
  await assert.rejects(analisarBuffer(1, conteudo, 'x.log', {}, 'erro-99'), /não encontrado/);
});
