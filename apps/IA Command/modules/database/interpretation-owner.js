'use strict';

// Nome registrado no momento da interpretação; sempre resolvido na mesma empresa.
function normalizarTelefone(value) {
  const raw = String(value || '').trim();
  if (raw.includes('@') && !/@(?:c\.us|s\.whatsapp\.net)$/.test(raw)) return '';
  let digits = raw.split('@')[0].replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits;
}

function varianteTelefone(numero) {
  if (!numero.startsWith('55')) return '';
  if (numero.length === 13 && numero[4] === '9' && /[6-9]/.test(numero[5])) return numero.slice(0, 4) + numero.slice(5);
  if (numero.length === 12 && /[6-9]/.test(numero[4])) return numero.slice(0, 4) + '9' + numero.slice(4);
  return '';
}

function contatos(db, empresaId) {
  const fontes = [
    ['whatsapp_allowed_numbers', 'nome', 'numero'],
    ['protheus_web_user_permissions', 'usuario_nome', 'celular'],
  ];
  return fontes.map(([table, name, phone]) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().length) return [];
    return db.prepare(`SELECT empresa_id, ${name} AS nome, ${phone} AS numero, ativo FROM ${table}${empresaId == null ? '' : ' WHERE empresa_id = ?'}`)
      .all(...(empresaId == null ? [] : [empresaId]))
      .map(row => ({ ...row, nome: String(row.nome || '').trim(), numero: normalizarTelefone(row.numero) }))
      .filter(row => row.nome && row.numero);
  });
}

function resolver(fontes, empresaId, telefone) {
  if (empresaId == null) return null;
  const numero = normalizarTelefone(telefone);
  if (!numero) return null;
  for (const candidate of [numero, varianteTelefone(numero)].filter(Boolean)) {
    for (const fonte of fontes) {
      const matches = fonte.filter(row => String(row.empresa_id) === String(empresaId) && row.numero === candidate);
      const active = matches.filter(row => Number(row.ativo) === 1);
      const preferred = active.length ? active : matches;
      const names = new Map(preferred.map(row => [row.nome.toLocaleLowerCase('pt-BR'), row.nome]));
      if (names.size) return names.size === 1 ? names.values().next().value : null;
    }
  }
  return null;
}

function nomeDoCelular(db, empresaId, telefone) {
  if (empresaId == null || !normalizarTelefone(telefone)) return null;
  return resolver(contatos(db, empresaId), empresaId, telefone);
}

function preencherLegados(db, { dryRun = false } = {}) {
  const hasColumn = db.prepare('PRAGMA table_info(interpretation_log)').all().some(col => col.name === 'numero_wa_nome');
  const records = db.prepare(`SELECT id, empresa_id, numero_wa FROM interpretation_log${hasColumn ? " WHERE numero_wa_nome IS NULL OR trim(numero_wa_nome) = ''" : ''}`).all();
  const fontes = contatos(db);
  const updates = records.map(row => ({ id: row.id, nome: resolver(fontes, row.empresa_id, row.numero_wa) })).filter(row => row.nome);
  if (!dryRun) {
    const update = db.prepare("UPDATE interpretation_log SET numero_wa_nome = ? WHERE id = ? AND (numero_wa_nome IS NULL OR trim(numero_wa_nome) = '')");
    db.transaction(() => { for (const row of updates) update.run(row.nome, row.id); })();
  }
  return { analisados: records.length, preenchidos: updates.length, semCorrespondencia: records.length - updates.length };
}

function migrar(db) {
  return db.transaction(() => {
    if (!db.prepare('PRAGMA table_info(interpretation_log)').all().some(col => col.name === 'numero_wa_nome')) {
      db.exec('ALTER TABLE interpretation_log ADD COLUMN numero_wa_nome TEXT DEFAULT NULL');
    }
    return preencherLegados(db);
  })();
}

module.exports = { normalizarTelefone, nomeDoCelular, preencherLegados, migrar };
