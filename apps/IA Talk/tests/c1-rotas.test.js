'use strict';

// C1 no servidor REAL: login por código, link de uso único, entrada pelo IAHub,
// cadastros, tokens, isolamento entre empresas e formas do contrato (as mesmas
// que o servidor simulado cumpre — as telas da G1 funcionam sem ajuste).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const cifra = require('../backend/seguranca/cifra');
const { abrirBanco } = require('../backend/database');
const { criarApp } = require('../backend/servidor');
const { camposFaltando } = require('../backend/contratos');
const { executar: primeiroAcesso } = require('../backend/cli/primeiro-acesso');
const { assinarTicket } = require('../../IAHUB/backend/ia-talk-entrada');

cifra.definirChaveParaTeste(crypto.randomBytes(32));
const forma = (nome, obj) => assert.deepEqual(camposFaltando(nome, obj), [], `forma ${nome}`);

const enviados = [];
const parHub = crypto.generateKeyPairSync('ed25519');
let db; let base; let servidor;

test.before(async () => {
  db = abrirBanco({ arquivo: ':memory:' });
  const transportes = {
    whatsapp: async (d) => { enviados.push({ via: 'whatsapp', telefone: d.telefone, codigo: d.codigo }); return d.telefone.endsWith('9999') ? { ok: false, motivo: 'teste' } : { ok: true }; },
    email: async (d) => { if (!d.email) return { ok: false, motivo: 'sem_email' }; enviados.push({ via: 'email', codigo: d.codigo }); return { ok: true }; },
  };
  const testarEmail = async () => [{ etapa: 'dns', ok: true, mensagem: 'ok' }, { etapa: 'porta', ok: true, mensagem: 'ok' }, { etapa: 'autenticacao', ok: true, mensagem: 'ok' }, { etapa: 'envio', ok: true, mensagem: 'ok' }];
  servidor = http.createServer(criarApp({ db, log: { error() {} }, transportes, testarEmail, chavePublicaHub: () => parHub.publicKey }));
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}/app/ia-talk`;
});
test.after(() => new Promise(r => servidor.close(r)));

// Navegador mínimo: guarda o cookie da sessão.
function navegador() {
  let cookie = '';
  const ir = async (caminho, { metodo = 'GET', corpo, redirect = 'manual' } = {}) => {
    const r = await fetch(`${base}${caminho}`, {
      method: metodo, redirect,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].startsWith('talk.sid=;') || sc.startsWith('talk.sid=;') ? '' : sc.split(';')[0];
    const tipo = r.headers.get('content-type') || '';
    return { status: r.status, corpo: tipo.includes('json') ? await r.json() : await r.text(), headers: r.headers };
  };
  return { ir, temCookie: () => !!cookie };
}

async function entrarComLink(nav, dados) {
  const { link } = primeiroAcesso({ db, ...dados });
  const caminho = link.slice(link.indexOf('/api/publico'));
  const r = await nav.ir(caminho);
  assert.equal(r.status, 302, 'link redireciona para o shell');
  return r;
}

test('primeiro acesso: link de uso único cria a sessão e não serve duas vezes', async () => {
  const nav = navegador();
  const { link } = primeiroAcesso({ db, nome: 'Ana Admin', telefone: '5565999990001', empresa: 'J2A Consultoria', apelido: 'j2a' });
  const caminho = link.slice(link.indexOf('/api/publico'));
  const r = await nav.ir(caminho);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/app/ia-talk/shell.html');
  assert.match(r.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(r.headers.get('set-cookie'), /Path=\/app\/ia-talk/);
  const sessao = await nav.ir('/api/admin/sessao');
  forma('sessao', sessao.corpo);
  assert.equal(sessao.corpo.usuario.administrador_plataforma, true);
  assert.ok(sessao.corpo.rotinas.includes('talk-empresas'));
  const denovo = await navegador().ir(caminho);
  assert.equal(denovo.status, 401, 'link já usado');
});

test('login por código: pedido, confirmação, erros e limites', async () => {
  const navAdmin = navegador();
  await entrarComLink(navAdmin, { nome: 'Ana Admin', telefone: '5565999990001', apelido: 'j2a' });
  const novo = await navAdmin.ir('/api/admin/usuarios', { metodo: 'POST', corpo: { nome: 'Bruno Supervisor', telefone: '55 65 99999-0002', papel: 'supervisor' } });
  assert.equal(novo.status, 201);
  forma('usuario', novo.corpo);
  assert.doesNotMatch(JSON.stringify(novo.corpo), /5565999990002/);

  const nav = navegador();
  const empresa = await nav.ir('/api/publico/empresa/j2a');
  assert.deepEqual(Object.keys(empresa.corpo).sort(), ['apelido', 'logo_url', 'metodos', 'nome']);
  assert.equal((await nav.ir('/api/publico/empresa/nao-existe')).status, 404);

  const pedido = await nav.ir('/api/publico/login/codigo', { metodo: 'POST', corpo: { apelido: 'j2a', telefone: '5565999990002' } });
  assert.equal(pedido.status, 200);
  assert.equal(pedido.corpo.enviado_por, 'whatsapp');
  const codigo = enviados.at(-1).codigo;
  assert.match(codigo, /^\d{6}$/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM desafios_login WHERE codigo_hash = ?').get(codigo).n, 0, 'código nunca gravado puro');

  const errado = await nav.ir('/api/publico/login/confirmar', { metodo: 'POST', corpo: { desafio_id: pedido.corpo.desafio_id, codigo: codigo === '000000' ? '111111' : '000000' } });
  assert.equal(errado.status, 400);
  assert.equal(errado.corpo.erro.detalhe.tentativas_restantes, 4);
  const certo = await nav.ir('/api/publico/login/confirmar', { metodo: 'POST', corpo: { desafio_id: pedido.corpo.desafio_id, codigo } });
  assert.equal(certo.status, 200);
  assert.ok(nav.temCookie());
  const s = await nav.ir('/api/admin/sessao');
  assert.equal(s.corpo.papel, 'supervisor');
  assert.equal(s.corpo.usuario.administrador_plataforma, false);
  assert.ok(!s.corpo.rotinas.includes('talk-usuarios'));
  const reuso = await nav.ir('/api/publico/login/confirmar', { metodo: 'POST', corpo: { desafio_id: pedido.corpo.desafio_id, codigo } });
  assert.equal(reuso.status, 404, 'código não serve duas vezes');

  // Número desconhecido: mesma resposta, nada enviado.
  const antes = enviados.length;
  const fantasma = await navegador().ir('/api/publico/login/codigo', { metodo: 'POST', corpo: { apelido: 'j2a', telefone: '5565911112222' } });
  assert.equal(fantasma.status, 200);
  assert.equal(enviados.length, antes);

  // Limite por telefone (3 em 10 min).
  for (let i = 0; i < 2; i++) await navegador().ir('/api/publico/login/codigo', { metodo: 'POST', corpo: { apelido: 'j2a', telefone: '5565911112222' } });
  const bloqueado = await navegador().ir('/api/publico/login/codigo', { metodo: 'POST', corpo: { apelido: 'j2a', telefone: '5565911112222' } });
  assert.equal(bloqueado.status, 429);

  assert.equal((await navegador().ir('/api/publico/login/codigo', { metodo: 'POST', corpo: { apelido: 'j2a', telefone: '123' } })).status, 400);
});

test('login: WhatsApp falhou → e-mail de reserva; sem nenhum → aviso claro', async () => {
  const nav = navegador();
  await entrarComLink(nav, { nome: 'Ana Admin', telefone: '5565999990001', apelido: 'j2a' });
  await nav.ir('/api/admin/usuarios', { metodo: 'POST', corpo: { nome: 'Com Email', telefone: '5565988889999', papel: 'auditor', email: 'com@exemplo.com.br' } });
  await nav.ir('/api/admin/usuarios', { metodo: 'POST', corpo: { nome: 'Sem Email', telefone: '5565977779999', papel: 'auditor' } });
  const r1 = await navegador().ir('/api/publico/login/codigo', { metodo: 'POST', corpo: { apelido: 'j2a', telefone: '5565988889999' } });
  assert.equal(r1.corpo.enviado_por, 'email');
  assert.equal(r1.corpo.destino_mascarado, 'c••@exemplo.com.br');
  const r2 = await navegador().ir('/api/publico/login/codigo', { metodo: 'POST', corpo: { apelido: 'j2a', telefone: '5565977779999' } });
  assert.equal(r2.status, 503);
  assert.equal(r2.corpo.erro.detalhe, undefined, 'motivo técnico não vai para a tela');
});

test('isolamento: empresa B não vê nem altera nada da empresa A', async () => {
  const a = navegador();
  await entrarComLink(a, { nome: 'Ana Admin', telefone: '5565999990001', apelido: 'j2a' });
  const appA = await a.ir('/api/admin/aplicacoes', { metodo: 'POST', corpo: { nome: 'Sistema A', escopos: ['mensagens:enviar'] } });
  assert.equal(appA.status, 201);

  const b = navegador();
  await entrarComLink(b, { nome: 'Carlos B', telefone: '5565966660001', empresa: 'Empresa B', apelido: 'empresa-b' });
  // Carlos é administrador da plataforma (primeiro acesso), mas a sessão está na empresa B.
  const listaB = await b.ir('/api/admin/aplicacoes');
  assert.equal(listaB.corpo.itens.length, 0);
  assert.equal((await b.ir(`/api/admin/aplicacoes/${appA.corpo.id}`)).status, 404, 'de outra empresa = 404');
  assert.equal((await b.ir(`/api/admin/aplicacoes/${appA.corpo.id}/tokens`, { metodo: 'POST' })).status, 404);
  assert.equal((await b.ir(`/api/admin/aplicacoes/${appA.corpo.id}`, { metodo: 'PUT', corpo: { nome: 'Invadido' } })).status, 404);
  const usuariosB = await b.ir('/api/admin/usuarios');
  assert.ok(usuariosB.corpo.itens.every(u => u.nome !== 'Ana Admin'));
  const audB = await b.ir('/api/admin/auditoria');
  assert.ok(audB.corpo.itens.every(i => !String(i.resumo).includes('Sistema A')));
});

test('permissões: supervisor sem cadastros; só a plataforma vê empresas', async () => {
  const admin = navegador();
  await entrarComLink(admin, { nome: 'Ana Admin', telefone: '5565999990001', apelido: 'j2a' });
  const u = (await admin.ir('/api/admin/usuarios', { metodo: 'POST', corpo: { nome: 'Davi Super', telefone: '5565955550001', papel: 'supervisor' } })).corpo;
  const sup = navegador();
  const token = require('../backend/acesso/desafios').criarLink(db, { usuarioId: u.id, empresaId: db.prepare("SELECT id FROM empresas WHERE apelido = 'j2a'").get().id });
  await sup.ir(`/api/publico/link/${token}`);
  for (const rota of ['/usuarios', '/aplicacoes', '/sites-autorizados', '/email-envio', '/auditoria', '/empresas']) {
    assert.equal((await sup.ir(`/api/admin${rota}`)).status, 403, rota);
  }
  assert.equal((await sup.ir('/api/admin/papeis')).status, 200);
  assert.equal((await navegador().ir('/api/admin/sessao')).status, 401, 'sem sessão');
});

test('cadastros: formas do contrato, erros por campo, conflitos e auto-proteção', async () => {
  const nav = navegador();
  await entrarComLink(nav, { nome: 'Ana Admin', telefone: '5565999990001', apelido: 'j2a' });
  const empresas = await nav.ir('/api/admin/empresas');
  forma('pagina', empresas.corpo);
  empresas.corpo.itens.forEach(e => forma('empresa', e));
  const invalida = await nav.ir('/api/admin/empresas', { metodo: 'POST', corpo: { nome: '', apelido: 'Com Espaço' } });
  assert.equal(invalida.status, 400);
  assert.ok(invalida.corpo.erro.campos.nome && invalida.corpo.erro.campos.apelido);
  assert.equal((await nav.ir('/api/admin/empresas', { metodo: 'POST', corpo: { nome: 'Outra', apelido: 'j2a' } })).status, 409);
  const nova = await nav.ir('/api/admin/empresas', { metodo: 'POST', corpo: { nome: 'Nova Ltda', apelido: 'nova-ltda' } });
  assert.equal(nova.status, 201);

  (await nav.ir('/api/admin/usuarios')).corpo.itens.forEach(u => forma('usuario', u));
  (await nav.ir('/api/admin/papeis')).corpo.itens.forEach(p => forma('papel', p));
  const eu = (await nav.ir('/api/admin/sessao')).corpo.usuario.id;
  assert.equal((await nav.ir(`/api/admin/usuarios/${eu}`, { metodo: 'PUT', corpo: { papel: 'auditor' } })).status, 409, 'não tira o próprio acesso');
  assert.equal((await nav.ir('/api/admin/usuarios', { metodo: 'POST', corpo: { nome: 'Repetido', telefone: '5565999990001', papel: 'auditor' } })).status, 409);

  const sites = (await nav.ir('/api/admin/sites-autorizados')).corpo;
  forma('sitesAutorizados', sites);
  assert.equal((await nav.ir('/api/admin/sites-autorizados', { metodo: 'PUT', corpo: { origens: ['http://inseguro.com'], versao: sites.versao } })).status, 400);
  const salvo = await nav.ir('/api/admin/sites-autorizados', { metodo: 'PUT', corpo: { origens: ['https://softexpert.exemplo.com.br/'], versao: sites.versao } });
  assert.deepEqual(salvo.corpo.origens, ['https://softexpert.exemplo.com.br']);
  assert.equal((await nav.ir('/api/admin/sites-autorizados', { metodo: 'PUT', corpo: { origens: [], versao: sites.versao } })).status, 409, 'versão antiga');
  const pagina = await nav.ir('/j2a');
  assert.match(pagina.headers.get('content-security-policy') || '', /frame-ancestors 'self' https:\/\/softexpert\.exemplo\.com\.br/);
});

test('e-mail de envio: senha cifrada, nunca devolvida, teste em etapas', async () => {
  const nav = navegador();
  await entrarComLink(nav, { nome: 'Ana Admin', telefone: '5565999990001', apelido: 'j2a' });
  forma('emailEnvio', (await nav.ir('/api/admin/email-envio')).corpo);
  assert.equal((await nav.ir('/api/admin/email-envio/testar', { metodo: 'POST' })).status, 400, 'testar sem salvar');
  const salvo = await nav.ir('/api/admin/email-envio', { metodo: 'PUT', corpo: { tipo: 'smtp', email: 'envio@exemplo.com.br', senha: 'senha-falsa', smtp_host: 'smtp.exemplo.com.br', smtp_porta: 465 } });
  assert.equal(salvo.status, 200);
  forma('emailEnvio', salvo.corpo);
  assert.equal(salvo.corpo.senha_configurada, true);
  assert.doesNotMatch(JSON.stringify(salvo.corpo), /senha-falsa/);
  const guardada = db.prepare('SELECT senha_cifrada FROM email_envio').get().senha_cifrada;
  assert.match(guardada, /^v1:/);
  await nav.ir('/api/admin/email-envio', { metodo: 'PUT', corpo: { tipo: 'smtp', email: 'envio@exemplo.com.br', senha: '••••••', smtp_host: 'smtp.exemplo.com.br', smtp_porta: 465 } });
  assert.equal(cifra.decifrar(db.prepare('SELECT senha_cifrada FROM email_envio').get().senha_cifrada), 'senha-falsa', 'máscara não troca a senha');
  const teste = await nav.ir('/api/admin/email-envio/testar', { metodo: 'POST' });
  assert.equal(teste.corpo.ok, true);
  assert.equal(teste.corpo.etapas.length, 4);
  assert.equal((await nav.ir('/api/admin/email-envio')).corpo.situacao, 'testado');
});

test('aplicações e tokens: completo uma vez, só hash no banco, revogação e validação', async () => {
  const nav = navegador();
  await entrarComLink(nav, { nome: 'Ana Admin', telefone: '5565999990001', apelido: 'j2a' });
  assert.equal((await nav.ir('/api/admin/aplicacoes', { metodo: 'POST', corpo: { nome: 'X', escopos: ['apagar:tudo'] } })).status, 400);
  assert.equal((await nav.ir('/api/admin/aplicacoes', { metodo: 'POST', corpo: { nome: 'X', escopos: ['mensagens:enviar'], webhook: { url: 'http://externo.com/x' } } })).status, 400);
  const app = (await nav.ir('/api/admin/aplicacoes', { metodo: 'POST', corpo: { nome: 'IA Command', escopos: ['mensagens:enviar'], canais_autorizados: ['cn_teste'], webhook: { url: 'http://127.0.0.1:3000/x', ativo: true } } })).corpo;
  forma('aplicacao', app);
  const g = await nav.ir(`/api/admin/aplicacoes/${app.id}/tokens`, { metodo: 'POST' });
  assert.equal(g.status, 201);
  assert.match(g.corpo.token, /^tk_live_/);
  forma('tokenAplicacao', g.corpo.registro);
  assert.doesNotMatch(JSON.stringify((await nav.ir(`/api/admin/aplicacoes/${app.id}`)).corpo), new RegExp(g.corpo.token));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM aplicacao_tokens WHERE token_hash = ?').get(g.corpo.token).n, 0);
  const tokens = require('../backend/acesso/tokens-aplicacao');
  assert.equal(tokens.validar(db, g.corpo.token).aplicacaoId, app.id);
  assert.equal(tokens.validar(db, 'tk_live_inventado'), null);
  await nav.ir(`/api/admin/aplicacoes/${app.id}/tokens/${g.corpo.registro.id}`, { metodo: 'DELETE' });
  assert.equal(tokens.validar(db, g.corpo.token), null, 'revogado');
  const seg = await nav.ir(`/api/admin/aplicacoes/${app.id}/webhook/segredo`, { metodo: 'POST' });
  assert.match(seg.corpo.segredo, /^whsec_/);
  assert.equal((await nav.ir(`/api/admin/aplicacoes/${app.id}`)).corpo.webhook.segredo_configurado, true);
  (await nav.ir('/api/admin/auditoria')).corpo.itens.forEach(i => forma('auditoria', i));
});

test('entrada pelo IAHub: ticket válido cria empresa e sessão; replay, vencido e falso recusados', async () => {
  const ticket = (extra = {}, agoraSeg) => assinarTicket(
    { usuario: { id: 77, nome: 'Admin Hub', email: 'admin@exemplo.com.br', celular: '', role: 'admin', ...extra.usuario }, empresa: { id: 9, razao_social: 'Plantivo Agro', ...extra.empresa } },
    { chavePrivada: parHub.privateKey, agoraSeg });
  const nav = navegador();
  const t = ticket();
  const r = await nav.ir(`/api/publico/entrar-hub?ticket=${encodeURIComponent(t)}`);
  assert.equal(r.status, 302);
  const s = (await nav.ir('/api/admin/sessao')).corpo;
  assert.equal(s.empresa.nome, 'Plantivo Agro');
  assert.equal(s.empresa.apelido, 'plantivo-agro');
  assert.equal(s.origem, 'hub');
  assert.equal(s.usuario.administrador_plataforma, true);
  assert.equal(db.prepare('SELECT hub_empresa_id FROM empresas WHERE apelido = ?').get('plantivo-agro').hub_empresa_id, 9);

  assert.equal((await navegador().ir(`/api/publico/entrar-hub?ticket=${encodeURIComponent(t)}`)).status, 401, 'replay');
  assert.equal((await navegador().ir(`/api/publico/entrar-hub?ticket=${encodeURIComponent(ticket({}, Math.floor(Date.now() / 1000) - 120))}`)).status, 401, 'vencido');
  const outroPar = crypto.generateKeyPairSync('ed25519');
  const falso = assinarTicket({ usuario: { id: 1, role: 'admin' }, empresa: { id: 9 } }, { chavePrivada: outroPar.privateKey });
  assert.equal((await navegador().ir(`/api/publico/entrar-hub?ticket=${encodeURIComponent(falso)}`)).status, 401, 'assinado por outra chave');
  const semRotinas = await navegador().ir(`/api/publico/entrar-hub?ticket=${encodeURIComponent(ticket({ usuario: { id: 88, role: 'usuario' } }))}`);
  assert.equal(semRotinas.status, 403, 'usuário comum sem rotinas do Talk na IA Gestão');
  assert.match(semRotinas.corpo, /ainda não tem acesso/);

  // Usuário comum com rotinas liberadas na IA Gestão: entra e vê só elas.
  const comRotinas = assinarTicket(
    { usuario: { id: 89, nome: 'Atendente Hub', role: 'usuario' }, empresa: { id: 9, razao_social: 'Plantivo Agro' }, rotinas: ['talk-painel', 'talk-canais', 'svc-radar', 'talk-empresas'] },
    { chavePrivada: parHub.privateKey });
  const navComum = navegador();
  assert.equal((await navComum.ir(`/api/publico/entrar-hub?ticket=${encodeURIComponent(comRotinas)}`)).status, 302);
  const sComum = (await navComum.ir('/api/admin/sessao')).corpo;
  assert.deepEqual(sComum.rotinas.sort(), ['talk-canais', 'talk-painel'], 'só as rotinas talk-* liberadas; empresas nunca');
  assert.equal((await navComum.ir('/api/admin/usuarios')).status, 403, 'rotina não liberada = sem acesso também no backend');
});

test('sair: revoga a sessão no servidor', async () => {
  const nav = navegador();
  await entrarComLink(nav, { nome: 'Ana Admin', telefone: '5565999990001', apelido: 'j2a' });
  const sair = await nav.ir('/api/admin/sair', { metodo: 'POST' });
  assert.equal(sair.corpo.redirecionar, '/app/ia-talk/j2a');
  assert.equal((await nav.ir('/api/admin/sessao')).status, 401);
});
