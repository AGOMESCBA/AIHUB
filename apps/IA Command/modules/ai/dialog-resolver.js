const { getDB } = require('../database');
const { normalizarTexto } = require('./local-intent-resolver');

const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

// Diálogos padrão do sistema — semeados automaticamente na primeira carga
const _DIALOGOS_SISTEMA = [
  {
    tipo: 'saudacao',
    titulo: 'Saudações',
    padroes: JSON.stringify([
      'boa noite', 'boa tarde', 'bom dia', 'olá', 'oi', 'ola', 'hello',
      'ei', 'alô', 'alo', 'hey', 'boa noite!', 'bom dia!', 'boa tarde!',
      'oi!', 'olá!',
    ]),
    resposta: 'Olá! Sou o *IA Command*, seu assistente de consultas ao ERP via WhatsApp. Como posso te ajudar hoje?',
    prioridade: 10,
    protegido: 1,
    origem: 'sistema',
  },
  {
    tipo: 'ajuda',
    titulo: 'O que você faz / Como pode me ajudar',
    padroes: JSON.stringify([
      'o que voce faz', 'o que você faz', 'como pode me ajudar', 'o que voce pode fazer',
      'como vc pode me ajudar', 'me ajuda', 'o que o sistema faz', 'quais consultas',
      'quais relatorios', 'quais relatórios', 'para que serve', 'como funciona',
      'o que posso consultar', 'what can you do', 'ajuda', 'help',
      'como vc me ajuda', 'como você me ajuda', 'no que voce ajuda',
    ]),
    resposta: 'Sou o *IA Command* — consulto dados do seu ERP em linguagem natural pelo WhatsApp! 🤖\n\nPosso te ajudar com:\n• Faturamento e vendas\n• Compras e estoque\n• Contas a pagar e a receber\n• Fluxo de caixa\n• E qualquer informação que seu ERP disponibilize!\n\nExemplo: *"faturamento de hoje"*, *"vendas do mês por produto"*, *"contas a pagar desta semana"*\n\nÉ só perguntar naturalmente! 😊',
    prioridade: 10,
    protegido: 1,
    origem: 'sistema',
  },
  {
    tipo: 'agradecimento',
    titulo: 'Agradecimentos',
    padroes: JSON.stringify([
      'obrigado', 'obrigada', 'valeu', 'muito obrigado', 'muito obrigada',
      'agradecido', 'agradecida', 'thanks', 'thx', 'brigado', 'vlw',
      'grato', 'grata', 'muito grato',
    ]),
    resposta: 'De nada! Estou aqui sempre que precisar. 😊',
    prioridade: 10,
    protegido: 1,
    origem: 'sistema',
  },
  {
    tipo: 'despedida',
    titulo: 'Despedidas',
    padroes: JSON.stringify([
      'tchau', 'até mais', 'ate mais', 'até logo', 'ate logo', 'xau', 'bye',
      'flw', 'falou', 'até amanhã', 'ate amanha', 'até depois', 'ate depois',
      'tchauzinho', 'adeus', 'até', 'até mais!', 'tchau!',
    ]),
    resposta: 'Até mais! Foi um prazer ajudar. Qualquer dúvida, é só chamar. 👋',
    prioridade: 10,
    protegido: 1,
    origem: 'sistema',
  },
  {
    tipo: 'confusao',
    titulo: 'Não entendi / Não compreendi',
    padroes: JSON.stringify([
      'nao entendi', 'não entendi', 'nao compreendi', 'não compreendi',
      'pode repetir', 'nao entendo', 'não entendo', 'confused',
      'what', 'hein', 'hã', 'ha', 'como assim', 'o que', 'que', 'oi?',
    ]),
    resposta: 'Desculpe! Tente perguntar sobre dados do seu ERP, como:\n• *"faturamento de hoje"*\n• *"vendas do mês"*\n• *"contas a pagar"*\n\nPosso ajudar com consultas de vendas, compras, financeiro e muito mais. 😊',
    prioridade: 10,
    protegido: 1,
    origem: 'sistema',
  },
];

function _semear() {
  const db = getDB();
  const existing = db.prepare(`SELECT COUNT(*) as c FROM conversational_dialogs WHERE origem = 'sistema' AND empresa_id IS NULL`).get();
  if (existing?.c > 0) return;

  const agora = new Date().toISOString();
  const uuid = () => require('crypto').randomUUID ? require('crypto').randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

  const stmt = db.prepare(`
    INSERT INTO conversational_dialogs (id, empresa_id, tipo, titulo, padroes, resposta, prioridade, protegido, origem, ativo, criado_em, atualizado_em)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);

  for (const d of _DIALOGOS_SISTEMA) {
    stmt.run(uuid(), d.tipo, d.titulo, d.padroes, d.resposta, d.prioridade, d.protegido, d.origem, agora, agora);
  }
  console.log(`[IA Command] ${_DIALOGOS_SISTEMA.length} diálogos padrão semeados.`);
}

function _carregarDialogos(empresaId) {
  const cacheKey = `${empresaId}`;
  const cached = _cache.get(cacheKey);
  if (cached && cached.expiraEm > Date.now()) return cached.dados;

  try {
    const db = getDB();
    // Carrega globais (empresa_id IS NULL) + da empresa, ordenados por prioridade desc
    const rows = db.prepare(`
      SELECT * FROM conversational_dialogs
      WHERE ativo = 1 AND (empresa_id IS NULL OR empresa_id = ?)
      ORDER BY prioridade DESC, rowid ASC
    `).all(empresaId);

    _cache.set(cacheKey, { dados: rows, expiraEm: Date.now() + CACHE_TTL });
    return rows;
  } catch (_) {
    return [];
  }
}

function _matchPadroes(padroes, textoNorm) {
  let lista;
  try { lista = JSON.parse(padroes); } catch (_) { lista = []; }
  for (const p of lista) {
    const padNorm = normalizarTexto(String(p));
    if (padNorm && (textoNorm === padNorm || textoNorm.startsWith(padNorm) || textoNorm.endsWith(padNorm) || textoNorm.includes(padNorm))) {
      return true;
    }
  }
  return false;
}

function resolver(mensagem, empresaId) {
  try {
    _semear();
    const textoNorm = normalizarTexto(mensagem);
    const dialogos  = _carregarDialogos(empresaId);

    for (const d of dialogos) {
      if (_matchPadroes(d.padroes, textoNorm)) {
        return { matched: true, resposta: d.resposta, dialogo_id: d.id, tipo: d.tipo };
      }
    }
  } catch (_) {}
  return { matched: false };
}

function logarNaoRespondida(mensagem, empresaId, sender) {
  try {
    const db  = getDB();
    const id  = require('crypto').randomUUID ? require('crypto').randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    db.prepare(`
      INSERT INTO unmatched_messages (id, empresa_id, sender, mensagem, promovido, criado_em)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(id, empresaId, sender || null, mensagem, new Date().toISOString());
  } catch (_) {}
}

function invalidateCache(empresaId = null) {
  if (empresaId == null) { _cache.clear(); return; }
  _cache.delete(String(empresaId));
  _cache.delete('null');
}

function restaurarSistema() {
  const db = getDB();
  const agora = new Date().toISOString();
  const uuid = () => require('crypto').randomUUID ? require('crypto').randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  let restaurados = 0;

  for (const d of _DIALOGOS_SISTEMA) {
    const existing = db.prepare(`SELECT id FROM conversational_dialogs WHERE titulo = ? AND origem = 'sistema' AND empresa_id IS NULL`).get(d.titulo);
    if (!existing) {
      db.prepare(`
        INSERT INTO conversational_dialogs (id, empresa_id, tipo, titulo, padroes, resposta, prioridade, protegido, origem, ativo, criado_em, atualizado_em)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(uuid(), d.tipo, d.titulo, d.padroes, d.resposta, d.prioridade, d.protegido, d.origem, agora, agora);
      restaurados++;
    } else {
      db.prepare(`UPDATE conversational_dialogs SET padroes = ?, resposta = ?, prioridade = ?, ativo = 1, atualizado_em = ? WHERE id = ?`)
        .run(d.padroes, d.resposta, d.prioridade, agora, existing.id);
      restaurados++;
    }
  }

  invalidateCache();
  return restaurados;
}

module.exports = { resolver, logarNaoRespondida, invalidateCache, restaurarSistema, _DIALOGOS_SISTEMA };
