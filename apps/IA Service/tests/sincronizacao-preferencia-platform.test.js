// Preferencia de pre-analise automatica (2026-10): a Platform define o PADRAO
// (copiado no login e sincronizado sem novo login) e o analista pode ter uma
// ESCOLHA PESSOAL no chat, guardada a parte no IA Service. Valor efetivo =
// pessoal ?? padrao. A escolha pessoal nunca e sobrescrita pela Platform e o
// cadastro da Platform nunca e alterado pelo chat.
// Executar: node "apps/IA Service/tests/sincronizacao-preferencia-platform.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SVC_WHATSAPP_OTP_SECRET = process.env.SVC_WHATSAPP_OTP_SECRET || 'teste-secret';

const dbTmpPath = path.join(os.tmpdir(), `ia-service-sync-pref-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const consultorRepo = require('../backend/repositories/consultor-repository');
const platformStore = require('../../IAHUB/backend/platform-store');
const loginExternoService = require('../backend/services/login-externo-service');

const EMPRESA = 98701;
const TELEFONE = '5565996677865';

function limpar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {} }
}

async function main() {
  const originalLista = platformStore.listarIaServicePorTelefone;
  const originalNow = Date.now;
  let relogioExtra = 0;
  Date.now = () => originalNow() + relogioExtra;
  const avancarThrottle = () => { relogioExtra += 60 * 1000; };

  let platformPreAnalise = true;
  platformStore.listarIaServicePorTelefone = () => [{
    platformIdentityId: 'ident-1', empresaId: EMPRESA, telefone: TELEFONE, ativo: true,
    usuarioIdIahub: null, idSoftexpert: '957', preAnaliseAutomatica: platformPreAnalise,
    atualizadoEm: new Date().toISOString(),
  }];
  const ler = (id, empresa = EMPRESA) => consultorRepo.getConsultor(empresa, id);

  try {
    const consultor = consultorRepo.upsertConsultorPlatform(EMPRESA, {
      platformIdentityId: 'ident-1', idSoftexpert: '957', telefone: TELEFONE, ativo: true, preAnaliseAutomatica: true,
    });
    assert.strictEqual(consultor.preAnaliseAutomatica, true);
    assert.strictEqual(consultor.preAnalisePessoal, null, 'sem escolha pessoal por padrao');

    // 1) Padrao da Platform muda para Manual: o efetivo acompanha, sem novo login.
    platformPreAnalise = false;
    assert.strictEqual(loginExternoService.sincronizarPreferenciaDaPlatform(EMPRESA, consultor.id), true);
    let c = ler(consultor.id);
    assert.strictEqual(c.preAnalisePadrao, false);
    assert.strictEqual(c.preAnaliseAutomatica, false, 'sem escolha pessoal, o efetivo segue o padrao');
    console.log('[1/6] Padrao da Platform (Manual) chega ao chat sem novo login: ok');

    // 2) Analista escolhe Automatica no chat: vale a escolha pessoal; o padrao nao muda.
    consultorRepo.definirPreferenciaPessoal(EMPRESA, consultor.id, true);
    c = ler(consultor.id);
    assert.strictEqual(c.preAnaliseAutomatica, true);
    assert.strictEqual(c.preAnalisePadrao, false, 'a escolha pessoal nao altera o padrao');
    console.log('[2/6] Escolha pessoal vale e nao altera o padrao: ok');

    // 3) Login e sincronizacao nunca sobrescrevem a escolha pessoal, mesmo com a Platform mudando.
    platformPreAnalise = true;
    avancarThrottle();
    loginExternoService.sincronizarPreferenciaDaPlatform(EMPRESA, consultor.id);
    platformPreAnalise = false;
    consultorRepo.upsertConsultorPlatform(EMPRESA, {
      platformIdentityId: 'ident-1', idSoftexpert: '957', telefone: TELEFONE, ativo: true, preAnaliseAutomatica: false,
    });
    c = ler(consultor.id);
    assert.strictEqual(c.preAnalisePessoal, true, 'login/sincronizacao nao tocam a escolha pessoal');
    assert.strictEqual(c.preAnaliseAutomatica, true);
    assert.strictEqual(c.preAnalisePadrao, false);
    console.log('[3/6] Login e sincronizacao preservam a escolha pessoal: ok');

    // 4) Voltar ao padrao: remove a escolha pessoal e o efetivo volta a seguir a Platform.
    consultorRepo.definirPreferenciaPessoal(EMPRESA, consultor.id, null);
    c = ler(consultor.id);
    assert.strictEqual(c.preAnalisePessoal, null);
    assert.strictEqual(c.preAnaliseAutomatica, false);
    console.log('[4/6] "Voltar ao padrao" remove a escolha pessoal: ok');

    // 5) Dois vinculos chat-web do MESMO telefone/empresa: vence o editado mais recente.
    const antigo = { platformIdentityId: 'ident-auto', empresaId: 1, telefone: '5565911112222', ativo: true,
      usuarioIdIahub: null, idSoftexpert: '501', preAnaliseAutomatica: true, atualizadoEm: '2026-10-13T10:00:00.000Z' };
    const recente = { ...antigo, platformIdentityId: 'ident-manual', preAnaliseAutomatica: false, atualizadoEm: '2026-10-13T12:00:00.000Z' };
    for (const ordem of [[antigo, recente], [recente, antigo]]) {
      platformStore.listarIaServicePorTelefone = () => ordem;
      const empresas = loginExternoService.listarEmpresasDoTelefone('5565911112222');
      assert.strictEqual(empresas.length, 1, 'uma entrada por empresa');
      assert.strictEqual(ler(empresas[0].consultorId, 1).preAnaliseAutomatica, false,
        'vinculo editado mais recentemente (Manual) deve vencer independente da ordem');
    }
    console.log('[5/6] Vinculos duplicados do mesmo telefone: vence o mais recente em qualquer ordem: ok');

    // 6) Falha ou ausencia na Platform: nada muda e nunca lanca.
    platformStore.listarIaServicePorTelefone = () => [];
    avancarThrottle();
    assert.strictEqual(loginExternoService.sincronizarPreferenciaDaPlatform(EMPRESA, consultor.id), false);
    platformStore.listarIaServicePorTelefone = () => { throw new Error('platform indisponivel'); };
    avancarThrottle();
    assert.strictEqual(loginExternoService.sincronizarPreferenciaDaPlatform(EMPRESA, consultor.id), false);
    assert.strictEqual(ler(consultor.id).preAnalisePadrao, false);
    console.log('[6/6] Platform sem vinculo ou com falha: nada muda e nunca lanca: ok');

    console.log('sincronizacao-preferencia-platform.test.js: ok (6/6 cenarios validados)');
  } finally {
    platformStore.listarIaServicePorTelefone = originalLista;
    Date.now = originalNow;
    limpar();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; limpar(); });
