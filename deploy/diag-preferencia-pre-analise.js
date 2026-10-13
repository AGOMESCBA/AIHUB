// Diagnostico SOMENTE LEITURA: mostra de onde vem a preferencia de pre-analise
// automatica de um telefone (Platform x consultor do IA Service).
// Uso (na raiz da instalacao): node deploy/diag-preferencia-pre-analise.js 5565996677865
const path = require('path');
const Database = require('better-sqlite3');
const raiz = path.join(__dirname, '..');
const tel = String(process.argv[2] || '').replace(/\D/g, '');
if (!tel) { console.error('Informe o telefone (somente digitos).'); process.exit(1); }

const abrir = (rel) => new Database(path.join(raiz, rel), { readonly: true, fileMustExist: true });
const j = (v) => { try { return JSON.parse(v || '{}'); } catch (_) { return {}; } };

const plat = abrir('apps/IAHUB/data/iahub-platform.db');
const ids = plat.prepare('SELECT * FROM platform_whatsapp_identities WHERE numero_normalizado = ?').all(tel);
console.log(`\n== PLATFORM: ${ids.length} identidade(s) para ${tel}`);
for (const i of ids) {
  const meta = j(i.metadata_json);
  console.log(`- identidade ${i.id} | empresa ${i.empresa_id} | ativo=${i.ativo} | origem=${i.origem_sistema} | atualizado=${i.atualizado_em}`);
  console.log(`  metadata.iaService.preAnaliseAutomatica = ${JSON.stringify(meta.iaService?.preAnaliseAutomatica)}`);
  const roles = plat.prepare("SELECT * FROM platform_identity_roles WHERE identity_id = ? AND lower(sistema) = 'ia-service'").all(i.id);
  for (const r of roles) {
    console.log(`  role ${r.sistema}/${r.modulo} | liberado=${r.liberado} | codigo=${r.codigo_identidade} | origem=${r.origem_sistema}/${r.origem_id || '-'} | atualizado=${r.atualizado_em}`);
    console.log(`    metadata.preAnaliseAutomatica = ${JSON.stringify(j(r.metadata_json).preAnaliseAutomatica)}`);
  }
}

const svc = abrir('apps/IA Service/data/ia-service.db');
const cons = svc.prepare('SELECT id, empresa_id, id_softexpert, telefone, ativo, pre_analise_automatica, atualizado_em FROM consultores').all()
  .filter((c) => String(c.telefone || '').replace(/\D/g, '') === tel);
console.log(`\n== IA SERVICE: ${cons.length} consultor(es) para ${tel}`);
for (const c of cons) {
  console.log(`- consultor ${c.id} | empresa ${c.empresa_id} | softexpert=${c.id_softexpert} | ativo=${c.ativo} | pre_analise_automatica=${c.pre_analise_automatica} | atualizado=${c.atualizado_em}`);
}
