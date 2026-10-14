'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const migrations = require('../modules/database/migrations');
const owner = require('../modules/database/interpretation-owner');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

test('migração, legados e novos logs gravam titular isolado por empresa', () => {
  const db = new Database(':memory:');
  try {
    for (const migration of migrations.filter(item => item.version < 95)) db.exec(migration.sql);
    const insert = db.prepare('INSERT INTO whatsapp_allowed_numbers (id, empresa_id, nome, numero, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const now = '2026-10-14T12:00:00Z';
    insert.run('n1', 1, 'Maria', '5565998006964', 1, now, now);
    insert.run('n2', 2, 'José', '5565998006964', 1, now, now);
    insert.run('n3', 1, 'Cadastro inativo', '5565993572735', 0, now, now);
    const permission = db.prepare('INSERT INTO protheus_web_user_permissions (id, empresa_id, usuario_id, usuario_nome, celular, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    permission.run('p1', 1, 'u1', 'Nome Protheus', '5565996677865', 1, now, now);
    permission.run('p2', 1, 'u2', 'Ambíguo A', '5565991211234', 1, now, now);
    permission.run('p3', 1, 'u3', 'Ambíguo B', '5565991211234', 1, now, now);
    assert.equal(owner.nomeDoCelular(db, 1, '5565998006964@c.us'), 'Maria');
    assert.equal(owner.nomeDoCelular(db, 2, '(65) 99800-6964'), 'José');
    assert.equal(owner.nomeDoCelular(db, 1, '556598006964'), 'Maria', 'aceita variante WhatsApp sem nono dígito');
    assert.equal(owner.nomeDoCelular(db, 1, '5565996677865'), 'Nome Protheus');
    assert.equal(owner.nomeDoCelular(db, 3, '5565998006964'), null, 'não usa cadastro de outra empresa');
    assert.equal(owner.nomeDoCelular(db, 1, '5565991211234'), null, 'não escolhe nome ambíguo');
    assert.equal(owner.nomeDoCelular(db, 1, '5565998006964@lid'), null, 'LID não representa telefone');
    assert.equal(owner.nomeDoCelular(db, 1, ''), null);
    const legacy = db.prepare('INSERT INTO interpretation_log (id, empresa_id, numero_wa, texto_original, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?)');
    legacy.run('l1', 1, '5565998006964', 'Pergunta histórica', now, now);
    legacy.run('l2', 2, '5565998006964', 'Outra empresa', now, now);
    legacy.run('l3', 1, '5565991211234', 'Ambíguo', now, now);
    legacy.run('l4', 1, '', 'Sem celular', now, now);
    const migration = migrations.find(item => item.version === 95);
    assert.deepEqual(migration.run(db), { analisados: 4, preenchidos: 2, semCorrespondencia: 2 });
    assert.equal(db.prepare("SELECT numero_wa_nome FROM interpretation_log WHERE id = 'l1'").get().numero_wa_nome, 'Maria');
    assert.equal(db.prepare("SELECT numero_wa_nome FROM interpretation_log WHERE id = 'l2'").get().numero_wa_nome, 'José');
    assert.equal(db.prepare("SELECT atualizado_em FROM interpretation_log WHERE id = 'l1'").get().atualizado_em, now);
    db.prepare("UPDATE whatsapp_allowed_numbers SET nome = 'Maria atualizada' WHERE id = 'n1'").run();
    assert.equal(migration.run(db).preenchidos, 0, 'idempotente e preserva nomes já gravados');
    assert.equal(db.prepare("SELECT numero_wa_nome FROM interpretation_log WHERE id = 'l1'").get().numero_wa_nome, 'Maria');

    const databasePath = require.resolve('../modules/database');
    const previous = require.cache[databasePath];
    require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { getDB: () => db } };
    try {
      const logger = require('../modules/ai/interpretation-log');
      const row = logger.registrar({ empresa_id: 1, numero_wa: '5565998006964', texto_original: 'Novo log', canal_origem: 'whatsapp' });
      assert.equal(row.numero_wa_nome, 'Maria atualizada');
      assert.equal(logger.listarResumo(1).find(item => item.id === row.id).numero_wa_nome, 'Maria atualizada');
      assert.equal(logger.obterPorId(row.id, 1).numero_wa_nome, 'Maria atualizada');
    } finally {
      if (previous) require.cache[databasePath] = previous;
      else delete require.cache[databasePath];
    }
  } finally { db.close(); }
});

test('grade exibe nome ao lado do celular e permite filtrar, ordenar e agrupar', async () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../frontend/admin-interpretacoes-v2.html'), 'utf8');
  const rows = [
    { id: '1', numero_wa: '5565998006964', numero_wa_nome: 'Maria <Teste>', criado_em: '2026-10-14T12:00:00Z', texto_original: 'Pergunta 1' },
    { id: '2', numero_wa: '5565993572735', numero_wa_nome: 'José', criado_em: '2026-10-14T13:00:00Z', texto_original: 'Pergunta 2' },
  ];
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('.html')) return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname.endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: 'window._iahubAuthReady = Promise.resolve();' });
      if (url.pathname.endsWith('/interpretacoes')) return route.fulfill({ json: rows });
      return route.fulfill({ body: '', contentType: 'text/css' });
    });
    await page.goto('http://iahub.test/admin-interpretacoes-v2.html');
    await page.locator('.data-row').first().waitFor();
    assert.equal(await page.locator('thead > tr').first().locator('th').nth(4).textContent(), 'Nome');
    assert.equal(await page.locator('.data-row[data-id="1"] td').nth(4).textContent(), 'Maria <Teste>');
    assert.equal(await page.locator('.data-row[data-id="1"] td').nth(4).locator('teste').count(), 0, 'nome é escapado');
    await page.locator('[data-filter="numero_wa_nome"]').click();
    await page.locator('[data-filter="numero_wa_nome"]').fill('maria');
    assert.equal(await page.locator('.data-row').count(), 1);
    await page.locator('[data-filter="numero_wa_nome"]').fill('');
    await page.locator('[data-sort="numero_wa_nome"]').click();
    assert.equal(await page.locator('.data-row').first().getAttribute('data-id'), '2');
    await page.locator('#group-toggle').click();
    await page.locator('.group-chip[data-group-field="numero_wa"]').click();
    assert.ok((await page.locator('.group-row-label').allTextContents()).some(text => text.includes('Maria <Teste>')));
    assert.equal(await page.locator('.group-row td').first().getAttribute('colspan'), '12');
    await page.locator('.group-chip[data-group-field="numero_wa_nome"]').click();
    assert.ok((await page.locator('.group-row-label').allTextContents()).some(text => text.includes('Nome: Maria <Teste>')));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
