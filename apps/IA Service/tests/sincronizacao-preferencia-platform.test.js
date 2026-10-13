// Bug real de producao (2026-10): "Pre-analise automatica = Manual" no cadastro
// da Platform (Numeros Autorizados > IA Service) nao chegava ao chat de quem
// ja estava com sessao ativa -- a Platform so era copiada para o consultor no
// pedido de codigo de login. Regra nova: vence a alteracao mais recente
// (Platform x toggle do proprio analista), sem exigir novo login.
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const originalLista = platformStore.listarIaServicePorTelefone;
  const originalNow = Date.now;
  let relogioExtra = 0;
  Date.now = () => originalNow() + relogioExtra;
  const avancarThrottle = () => { relogioExtra += 60 * 1000; };

  let platformPreAnalise = true;
  let platformAtualizadoEm = null;
  platformStore.listarIaServicePorTelefone = () => [{
    platformIdentityId: 'ident-1', empresaId: EMPRESA, telefone: TELEFONE, ativo: true,
    usuarioIdIahub: null, idSoftexpert: '957', preAnaliseAutomatica: platformPreAnalise,
    atualizadoEm: platformAtualizadoEm,
  }];

  try {
    const consultor = consultorRepo.upsertConsultorPlatform(EMPRESA, {
      platformIdentityId: 'ident-1', idSoftexpert: '957', telefone: TELEFONE, ativo: true, preAnaliseAutomatica: true,
    });
    assert.strictEqual(consultor.preAnaliseAutomatica, true);
    await sleep(15);

    // 1) Platform editada DEPOIS do consultor, em "Manual": o chat passa a respeitar.
    platformPreAnalise = false;
    platformAtualizadoEm = new Date().toISOString();
    assert.strictEqual(loginExternoService.sincronizarPreferenciaDaPlatform(EMPRESA, consultor.id), true);
    assert.strictEqual(consultorRepo.getConsultor(EMPRESA, consultor.id).preAnaliseAutomatica, false,
      'cadastro Manual na Platform deve desligar a pre-analise do consultor sem novo login');
    console.log('[1/4] Platform editada depois vence e desliga a pre-analise: ok');

    // 2) Analista liga o toggle no chat DEPOIS: a Platform (mais antiga) nao sobrescreve.
    await sleep(15);
    consultorRepo.atualizarConsultor(EMPRESA, consultor.id, { preAnaliseAutomatica: true });
    avancarThrottle();
    assert.strictEqual(loginExternoService.sincronizarPreferenciaDaPlatform(EMPRESA, consultor.id), false);
    assert.strictEqual(consultorRepo.getConsultor(EMPRESA, consultor.id).preAnaliseAutomatica, true,
      'toggle feito pelo analista depois do cadastro deve ser preservado');
    console.log('[2/4] Toggle do analista feito depois e preservado: ok');

    // 3) Throttle: duas chamadas seguidas sincronizam no maximo uma vez.
    await sleep(15);
    platformAtualizadoEm = new Date().toISOString();
    avancarThrottle();
    assert.strictEqual(loginExternoService.sincronizarPreferenciaDaPlatform(EMPRESA, consultor.id), true);
    assert.strictEqual(loginExternoService.sincronizarPreferenciaDaPlatform(EMPRESA, consultor.id), false,
      'segunda chamada dentro da janela nao deve repetir a consulta');
    assert.strictEqual(consultorRepo.getConsultor(EMPRESA, consultor.id).preAnaliseAutomatica, false);
    console.log('[3/4] Nova edicao da Platform volta a valer e o throttle segura repeticoes: ok');

    // 4) Platform sem data de atualizacao ou com falha nunca derruba nem altera nada.
    avancarThrottle();
    platformAtualizadoEm = null;
    platformPreAnalise = true;
    assert.strictEqual(loginExternoService.sincronizarPreferenciaDaPlatform(EMPRESA, consultor.id), false);
    platformStore.listarIaServicePorTelefone = () => { throw new Error('platform indisponivel'); };
    avancarThrottle();
    assert.strictEqual(loginExternoService.sincronizarPreferenciaDaPlatform(EMPRESA, consultor.id), false);
    assert.strictEqual(consultorRepo.getConsultor(EMPRESA, consultor.id).preAnaliseAutomatica, false);
    console.log('[4/4] Sem data ou com falha na Platform: nada muda e nunca lanca: ok');

    // 5) Dois vinculos chat-web do MESMO telefone/empresa (ex.: manual + auto da
    // importacao): vence o editado mais recente, em qualquer ordem da lista.
    // Usa a empresa real 1 porque listarEmpresasDoTelefone resolve o nome via
    // crud.buscarPorId('empresas', ...).
    const antigo = { platformIdentityId: 'ident-auto', empresaId: 1, telefone: '5565911112222', ativo: true,
      usuarioIdIahub: null, idSoftexpert: '501', preAnaliseAutomatica: true, atualizadoEm: '2026-10-13T10:00:00.000Z' };
    const recente = { ...antigo, platformIdentityId: 'ident-manual', preAnaliseAutomatica: false, atualizadoEm: '2026-10-13T12:00:00.000Z' };
    for (const ordem of [[antigo, recente], [recente, antigo]]) {
      platformStore.listarIaServicePorTelefone = () => ordem;
      const empresas = loginExternoService.listarEmpresasDoTelefone('5565911112222');
      assert.strictEqual(empresas.length, 1, 'uma entrada por empresa');
      const c = consultorRepo.getConsultor(1, empresas[0].consultorId);
      assert.strictEqual(c.preAnaliseAutomatica, false,
        'vinculo editado mais recentemente (Manual) deve vencer independente da ordem');
    }
    console.log('[5/5] Vinculos duplicados do mesmo telefone: vence o mais recente em qualquer ordem: ok');

    console.log('sincronizacao-preferencia-platform.test.js: ok (5/5 cenarios validados)');
  } finally {
    platformStore.listarIaServicePorTelefone = originalLista;
    Date.now = originalNow;
    limpar();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; limpar(); });
