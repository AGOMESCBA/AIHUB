// Limpeza das permissoes (platform_identity_roles) duplicadas pelo ciclo
// "importar do IA Command -> salvar na tela -> importar de novo" (corrigido no
// codigo em 2026-10-15). Por padrao so SIMULA e lista o que faria.
//
// Uso (na raiz da instalacao, com o servico parado ou sem ninguem editando
// numeros autorizados):
//   node deploy/limpar-duplicatas-platform-roles.js            -> simulacao
//   node deploy/limpar-duplicatas-platform-roles.js --aplicar  -> backup + remocao
//
// Regras:
// 1. Linhas identicas (mesma identidade + sistema/modulo/papel/codigo): fica UMA.
//    Preferencia: chat-web configurado na tela (nao automatico) > linha com origem
//    da importacao > liberada > mais recente. A origem da importacao e herdada
//    pela linha mantida, para a proxima importacao reconhece-la.
// 2. ia-service/chat-web automatico da importacao quando a identidade ja tem um
//    chat-web configurado na tela: o automatico sai (a aba IA Service manda).
// 3. Apenas RELATA (nao remove) chat-web cujo codigo e igual ao erp_id Protheus
//    do numero — sinal do bug antigo que gravava codigo Protheus como ID SoftExpert.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const aplicar = process.argv.includes('--aplicar');
const arquivo = path.join(__dirname, '..', 'apps', 'IAHUB', 'data', 'iahub-platform.db');
if (!fs.existsSync(arquivo)) { console.error(`Banco nao encontrado: ${arquivo}`); process.exit(1); }

const j = (v) => { try { return JSON.parse(v || '{}'); } catch (_) { return {}; } };
const low = (v) => String(v ?? '').trim().toLowerCase();
const ehChatWeb = (r) => low(r.sistema) === 'ia-service' && low(r.modulo) === 'chat-web';
const ehAuto = (r) => String(r.origem_id || '').endsWith(':ia-service-auto') || j(r.metadata_json).origem === 'auto-softexpert-chamados';

function prioridade(r) {
  return [
    ehChatWeb(r) && !ehAuto(r) ? 1 : 0,
    r.origem_id ? 1 : 0,
    Number(r.liberado) === 0 ? 0 : 1,
    String(r.atualizado_em || ''),
  ];
}
function compara(a, b) {
  const pa = prioridade(a); const pb = prioridade(b);
  for (let i = 0; i < pa.length; i++) {
    if (pa[i] > pb[i]) return -1;
    if (pa[i] < pb[i]) return 1;
  }
  return 0;
}

async function main() {
  const db = new Database(arquivo, { readonly: !aplicar, fileMustExist: true });
  const identidades = new Map(db.prepare('SELECT * FROM platform_whatsapp_identities').all().map(i => [i.id, i]));
  const roles = db.prepare('SELECT * FROM platform_identity_roles').all();

  const remover = [];      // { role, motivo }
  const herdarOrigem = []; // { manter, de }
  const alertas = [];

  const grupos = new Map();
  for (const r of roles) {
    const k = [r.empresa_id, r.identity_id, low(r.sistema), low(r.modulo), low(r.papel), low(r.codigo_identidade)].join('|');
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(r);
  }
  const sobreviventes = [];
  for (const lista of grupos.values()) {
    lista.sort(compara);
    const [manter, ...resto] = lista;
    sobreviventes.push(manter);
    for (const r of resto) remover.push({ role: r, motivo: 'duplicata identica' });
    if (!manter.origem_id) {
      const comOrigem = resto.find(r => r.origem_sistema && r.origem_id);
      if (comOrigem) herdarOrigem.push({ manter, de: comOrigem });
    }
  }

  const porIdentidade = new Map();
  for (const r of sobreviventes) {
    if (!ehChatWeb(r)) continue;
    const k = `${r.empresa_id}|${r.identity_id}`;
    if (!porIdentidade.has(k)) porIdentidade.set(k, []);
    porIdentidade.get(k).push(r);
  }
  for (const lista of porIdentidade.values()) {
    const manuais = lista.filter(r => !ehAuto(r));
    const autos = lista.filter(ehAuto);
    if (manuais.length && autos.length) {
      for (const r of autos) remover.push({ role: r, motivo: `chat-web automatico (codigo ${r.codigo_identidade}) sobrando ao lado do configurado na tela (codigo ${manuais.map(m => m.codigo_identidade).join(', ')})` });
    }
    const ident = identidades.get(lista[0].identity_id);
    const erpId = j(ident?.metadata_json).erp_id;
    for (const r of lista) {
      if (erpId && String(r.codigo_identidade || '') === String(erpId) && !(manuais.length && ehAuto(r))) {
        alertas.push(`${ident?.nome || r.identity_id}: chat-web com codigo ${r.codigo_identidade} = erp_id Protheus do numero. Conferir o ID SoftExpert na aba IA Service.`);
      }
    }
  }

  const nome = (r) => identidades.get(r.identity_id)?.nome || r.identity_id;
  const porNome = {};
  for (const { role, motivo } of remover) {
    const n = `${nome(role)} (empresa ${role.empresa_id})`;
    (porNome[n] = porNome[n] || []).push(`  - ${role.sistema}/${role.modulo}/${role.papel || '-'}/${role.codigo_identidade || '-'} [${motivo}]`);
  }
  console.log(`\nPermissoes no banco: ${roles.length}`);
  console.log(`A remover: ${remover.length} | Origem a herdar: ${herdarOrigem.length}\n`);
  for (const n of Object.keys(porNome).sort()) console.log(`${n}\n${porNome[n].join('\n')}`);
  if (alertas.length) console.log(`\nATENCAO (nao alterado):\n- ${alertas.join('\n- ')}`);

  if (!aplicar) {
    console.log('\nSIMULACAO: nada foi alterado. Rode com --aplicar para executar (faz backup antes).');
    db.close();
    return;
  }
  if (!remover.length && !herdarOrigem.length) { console.log('\nNada a fazer.'); db.close(); return; }

  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${arquivo}.antes-limpeza-${carimbo}.bak`;
  await db.backup(backup);
  console.log(`\nBackup gravado em: ${backup}`);

  const tx = db.transaction(() => {
    const del = db.prepare('DELETE FROM platform_identity_roles WHERE id = ?');
    for (const { role } of remover) del.run(role.id);
    // Remove primeiro e herda depois: o indice unico (empresa, origem_sistema,
    // origem_id) nao permite duas linhas com a mesma origem ao mesmo tempo.
    const upd = db.prepare('UPDATE platform_identity_roles SET origem_sistema = ?, origem_id = ?, importado_em = ? WHERE id = ?');
    for (const { manter, de } of herdarOrigem) upd.run(de.origem_sistema, de.origem_id, de.importado_em || null, manter.id);
  });
  tx();
  console.log(`Concluido: ${remover.length} removida(s), ${herdarOrigem.length} origem(ns) herdada(s).`);
  db.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
