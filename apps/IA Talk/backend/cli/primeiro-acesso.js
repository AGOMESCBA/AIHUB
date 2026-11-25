'use strict';

// Gera um link de acesso de uso único (15 min) para entrar no IA Talk sem
// código. Uso: primeiro administrador da plataforma e suporte. Roda só no
// servidor (quem tem acesso à máquina); o link não é gravado em lugar nenhum.
//
//   node "apps/IA Talk/backend/cli/primeiro-acesso.js" --nome "Fulano" --telefone 5565999990000 \
//        [--email fulano@empresa.com.br] [--empresa "J2A Consultoria"] [--apelido j2a] \
//        [--url http://127.0.0.1:3050]
//
// Cria (se não existir) a empresa e o usuário administrador da plataforma,
// vinculado à empresa como administrador. Pode rodar de novo: só gera outro link.

const path = require('path');
const config = require('../config');

function lerArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return args;
}

function executar({ db, nome, telefone: tel, email = null, empresa = 'Minha empresa', apelido = null, url = null }) {
  const { novoId, agora } = require('../ids');
  const telefone = require('../seguranca/telefone');
  const desafios = require('../acesso/desafios');
  const { apelidoLivre } = require('../rotas/publico');
  if (!nome || !telefone.valido(tel)) throw new Error('Informe --nome e --telefone (com DDI e DDD, ex.: 5565999990000).');

  const t = agora();
  const numero = telefone.normalizar(tel);
  return db.transaction(() => {
    const apel = (apelido || '').toLowerCase() || null;
    let e = apel ? db.prepare('SELECT * FROM empresas WHERE apelido = ?').get(apel) : db.prepare('SELECT * FROM empresas WHERE nome = ?').get(empresa);
    if (!e) {
      const id = novoId('empresa');
      db.prepare("INSERT INTO empresas (id, nome, apelido, situacao, criado_em, atualizado_em) VALUES (?, ?, ?, 'ativa', ?, ?)")
        .run(id, empresa, apel || apelidoLivre(db, empresa), t, t);
      e = db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
    }
    let u = db.prepare('SELECT * FROM usuarios WHERE telefone = ?').get(numero);
    if (!u) {
      const id = novoId('usuario');
      db.prepare('INSERT INTO usuarios (id, nome, telefone, email, administrador_plataforma, criado_em, atualizado_em) VALUES (?, ?, ?, ?, 1, ?, ?)')
        .run(id, nome, numero, email, t, t);
      u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    } else {
      db.prepare("UPDATE usuarios SET administrador_plataforma = 1, situacao = 'ativo' WHERE id = ?").run(u.id);
    }
    if (!db.prepare('SELECT 1 FROM membros WHERE empresa_id = ? AND usuario_id = ?').get(e.id, u.id)) {
      db.prepare("INSERT INTO membros (id, empresa_id, usuario_id, papel, criado_em, atualizado_em) VALUES (?, ?, ?, 'admin_empresa', ?, ?)")
        .run(novoId('membro'), e.id, u.id, t, t);
    }
    const token = desafios.criarLink(db, { usuarioId: u.id, empresaId: e.id });
    const base = String(url || `http://127.0.0.1:${config.porta()}`).replace(/\/+$/, '');
    return { link: `${base}${config.API_PUBLICA}/link/${token}`, empresa: e, usuarioId: u.id };
  })();
}

module.exports = { executar };

if (require.main === module) {
  require('dotenv').config({ path: path.join(config.RAIZ_REPO, '.env') });
  const args = lerArgs(process.argv.slice(2));
  const { abrirBanco } = require('../database');
  const db = abrirBanco();
  try {
    const r = executar({ db, nome: args.nome, telefone: args.telefone, email: args.email || null, empresa: args.empresa || undefined, apelido: args.apelido || null, url: args.url || null });
    console.log('\nLink de acesso (uso único, vale 15 minutos). Abra no navegador:\n');
    console.log(`  ${r.link}\n`);
    console.log(`Empresa: ${r.empresa.nome}  ·  link de entrada: ${config.BASE_PATH}/${r.empresa.apelido}\n`);
  } catch (err) {
    console.error(`Não foi possível gerar o link: ${err.message}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
