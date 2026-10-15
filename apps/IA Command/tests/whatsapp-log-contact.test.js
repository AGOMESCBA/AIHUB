const assert = require('node:assert/strict');
const { test } = require('node:test');
const Database = require('better-sqlite3');
const { formatarContatoParaLog, formatarAcaoEnvioParaLog } = require('../modules/whatsapp/log-contact');

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE whatsapp_allowed_numbers (empresa_id INTEGER, nome TEXT, numero TEXT, wa_lid TEXT, ativo INTEGER);
    CREATE TABLE whatsapp_channel_companies (channel_id TEXT, empresa_id INTEGER, ativo INTEGER);
    INSERT INTO whatsapp_allowed_numbers VALUES
      (1, 'Ana', '5592999991234', '123456789', 1),
      (2, 'Bruno', '5592999991234', NULL, 1),
      (1, 'Inativo', '5592888881234', NULL, 0),
      (1, '  ', '5592777771234', NULL, 1);
    INSERT INTO whatsapp_channel_companies VALUES
      ('canal-ana', 1, 1), ('canal-bruno', 2, 1),
      ('canal-ana', 2, 0), ('compartilhado', 1, 1), ('compartilhado', 2, 1);
  `);
  return (numero, escopo) => formatarContatoParaLog(numero, escopo, () => db);
}

test('distingue aviso, codigo e encaminhamento sem registrar conteudo livre', () => {
  for (const prefixo of ['chatweb', 'iaservice']) {
    const aviso = formatarAcaoEnvioParaLog(`${prefixo}_aviso_acesso`);
    const codigo = formatarAcaoEnvioParaLog(`${prefixo}_codigo_acesso`);
    assert.match(aviso, /aviso de acesso/);
    assert.match(codigo, /código de acesso/);
    assert.notEqual(aviso, codigo);
    assert.match(aviso, prefixo === 'chatweb' ? /IA Command/ : /IA Service/);
  }
  assert.match(formatarAcaoEnvioParaLog('chatweb_encaminhamento'), /resposta do Chat Web encaminhada/);
  assert.match(formatarAcaoEnvioParaLog('servico_externo'), /serviço externo/);
  for (const desconhecido of [undefined, null, '123456', 'texto confidencial\nforjado', '__proto__']) {
    assert.equal(formatarAcaoEnvioParaLog(desconhecido), 'Mensagem enviada');
  }
});

test('mostra nome e preserva o numero original no escopo da empresa', t => {
  const formatar = fixture(t);
  assert.equal(formatar('5592999991234', { empresaId: 1 }), 'Ana (5592999991234)');
  assert.equal(formatar('5592999991234', { empresaId: 2 }), 'Bruno (5592999991234)');
  assert.equal(formatar('5592999991234', { empresaId: 3 }), '5592999991234');
});

test('aceita telefone brasileiro sem nono digito e identificador c.us', t => {
  const formatar = fixture(t);
  assert.equal(formatar('559299991234@c.us', { empresaId: 1 }), 'Ana (559299991234@c.us)');
});

test('resolve lid somente pelo wa_lid, sem confundir com um telefone', t => {
  const formatar = fixture(t);
  assert.equal(formatar('123456789@lid', { empresaId: 1 }), 'Ana (123456789@lid)');
  assert.equal(formatar('5592999991234@lid', { empresaId: 1 }), '5592999991234@lid');
});

test('respeita vinculos ativos do canal e nao escolhe nomes conflitantes', t => {
  const formatar = fixture(t);
  assert.equal(formatar('5592999991234', { channelId: 'canal-ana' }), 'Ana (5592999991234)');
  assert.equal(formatar('5592999991234', { channelId: 'canal-bruno' }), 'Bruno (5592999991234)');
  assert.equal(formatar('5592999991234', { channelId: 'compartilhado' }), '5592999991234');
  assert.equal(formatar('5592999991234', { channelId: 'outro' }), '5592999991234');
});

test('mantem numero para cadastro ausente, inativo ou sem nome', t => {
  const formatar = fixture(t);
  for (const numero of ['5592666661234', '5592888881234', '5592777771234']) {
    assert.equal(formatar(numero, { empresaId: 1 }), numero);
  }
});

test('nao consulta banco sem escopo ou numero', () => {
  const obterDB = () => { assert.fail('Nao deve consultar banco'); };
  assert.equal(formatarContatoParaLog('5592999991234', {}, obterDB), '5592999991234');
  assert.equal(formatarContatoParaLog('', { empresaId: 1 }, obterDB), '');
});

test('falha no banco nao interrompe a formatacao nem remove o numero', () => {
  const obterDB = () => { throw new Error('Banco indisponivel'); };
  assert.equal(formatarContatoParaLog('5592999991234', { empresaId: 1 }, obterDB), '5592999991234');
});

test('remove quebras de linha do nome e nao altera dados do cadastro', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE whatsapp_allowed_numbers (empresa_id INTEGER, nome TEXT, numero TEXT, wa_lid TEXT, ativo INTEGER)');
  const nome = 'Ana\r\nSilva\t';
  db.prepare('INSERT INTO whatsapp_allowed_numbers VALUES (?, ?, ?, NULL, 1)').run(1, nome, '5592999991234');
  assert.equal(formatarContatoParaLog('5592999991234', { empresaId: 1 }, () => db), 'Ana Silva (5592999991234)');
  assert.equal(db.prepare('SELECT nome FROM whatsapp_allowed_numbers').get().nome, nome);
});
