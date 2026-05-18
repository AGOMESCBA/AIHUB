/**
 * FileSessionStore — store de sessão em JSON.
 * Substitui o store em memória padrão do express-session.
 * Sessoes ficam em apps/IAHUB/data/sessions/, mas podem ser limpas ao iniciar o servidor.
 */
const session = require('express-session');
const fs      = require('fs');
const path    = require('path');
const { appDataDir } = require('../data-paths');

const SESSIONS_DIR    = appDataDir('sessions');
const CLEANUP_INTERVAL = 30 * 60 * 1000; // limpa expiradas a cada 30 min

class FileSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    if (options.clearOnStart) this.clearExpiredAndActive();
    this._cleanup();
    setInterval(() => this._cleanup(), CLEANUP_INTERVAL).unref();
  }

  // Converte session ID em caminho de arquivo seguro
  _file(sid) {
    return path.join(SESSIONS_DIR, sid.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
  }

  get(sid, cb) {
    try {
      const file = this._file(sid);
      if (!fs.existsSync(file)) return cb(null, null);
      const { sess, expires } = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (expires && Date.now() > expires) {
        fs.unlinkSync(file);
        return cb(null, null);
      }
      cb(null, sess);
    } catch (_) {
      cb(null, null);
    }
  }

  set(sid, sess, cb) {
    try {
      const expires = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + (sess.cookie?.maxAge ?? 8 * 60 * 60 * 1000);
      fs.writeFileSync(this._file(sid), JSON.stringify({ sess, expires }), 'utf8');
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  destroy(sid, cb) {
    try {
      const file = this._file(sid);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (_) {}
    cb(null);
  }

  touch(sid, sess, cb) {
    // Renova o TTL sem alterar o conteúdo
    this.set(sid, sess, cb);
  }

  clearExpiredAndActive() {
    try {
      fs.readdirSync(SESSIONS_DIR)
        .filter(f => f.endsWith('.json'))
        .forEach(f => {
          try { fs.unlinkSync(path.join(SESSIONS_DIR, f)); } catch (_) {}
        });
    } catch (_) {}
  }

  _cleanup() {
    try {
      const now = Date.now();
      fs.readdirSync(SESSIONS_DIR)
        .filter(f => f.endsWith('.json'))
        .forEach(f => {
          try {
            const { expires } = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
            if (expires && now > expires) fs.unlinkSync(path.join(SESSIONS_DIR, f));
          } catch (_) {}
        });
    } catch (_) {}
  }
}

module.exports = FileSessionStore;
