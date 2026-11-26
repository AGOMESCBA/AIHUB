'use strict';

// Rotas de canais (rotina talk-canais). Contrato: docs/contratos.md §4.
// A empresa DONA configura e conecta o canal; as empresas vinculadas só usam o
// número (e o canal "padrão" de cada uma envia o código de login dela).

const express = require('express');
const crypto = require('crypto');
const { novoId, agora } = require('../ids');
const { erro, middlewareErros } = require('../erros');
const { codificarCursor, lerPaginacao } = require('../paginacao');
const { escopo } = require('../repositorios/base');
const auditoria = require('../repositorios/auditoria');
const { ROTINAS } = require('../acesso/papeis');
const { exigirRotina, ipDe } = require('../acesso/middleware');
const telefone = require('../seguranca/telefone');
const { CAPACIDADES_WWEB } = require('../provedores/wweb');

const SQL_VISIVEIS = `SELECT c.* FROM canais c
  WHERE c.empresa_dona_id = @empresa_id
     OR c.id IN (SELECT canal_id FROM canal_empresas WHERE empresa_id = @empresa_id)`;

function criarRotasCanais({ db, supervisor, log = console }) {
  const r = express.Router();
  const exigir = exigirRotina(ROTINAS.canais);
  const auditar = (req, acao, alvoId, resumo) => auditoria.registrar(db, req.contexto, { acao, alvoTipo: 'canal', alvoId, resumo, ip: ipDe(req) });

  function canalPublico(c) {
    const dona = db.prepare('SELECT id, nome FROM empresas WHERE id = ?').get(c.empresa_dona_id);
    const vinculadas = db.prepare(`SELECT e.id, e.nome, ce.padrao FROM canal_empresas ce JOIN empresas e ON e.id = ce.empresa_id
      WHERE ce.canal_id = ? ORDER BY e.nome`).all(c.id).map(v => ({ id: v.id, nome: v.nome, padrao: !!v.padrao }));
    return {
      id: c.id, nome: c.nome, numero_mascarado: c.numero ? telefone.mascarar(c.numero) : null, provedor: c.provedor,
      estado: c.estado, estado_desde: c.estado_desde, empresa_dona: dona, empresas_vinculadas: vinculadas,
      capacidades: CAPACIDADES_WWEB, fila_pendente: 0, ultima_mensagem_em: c.ultima_mensagem_em,
      modo_teste: !!c.modo_teste, numeros_teste_mascarados: JSON.parse(c.numeros_teste || '[]').map(telefone.mascarar),
      recebidas_descartadas: c.recebidas_descartadas,
    };
  }

  const acharVisivel = (req, id) => {
    const c = escopo(db, req.contexto).um(`SELECT * FROM (${SQL_VISIVEIS}) WHERE id = @id`, { id: String(id) });
    if (!c) throw erro('nao_encontrado', 'Canal não encontrado.');
    return c;
  };
  // Número do WhatsApp do canal (como no IA Command): obrigatório, válido e só em um canal.
  function lerNumero(valor, canalIdAtual = null) {
    const numero = telefone.normalizar(valor);
    if (!telefone.valido(numero)) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { numero: 'Informe o número com DDI e DDD (ex.: 5565999990000).' } });
    const outro = db.prepare('SELECT id, numero FROM canais WHERE numero IS NOT NULL AND id IS NOT ?').all(canalIdAtual)
      .find(c => telefone.mesmoNumero(c.numero, numero));
    if (outro) throw erro('conflito', 'Este número já está cadastrado em outro canal do IA Talk. Para várias empresas no mesmo número, vincule-as na aba Empresas desse canal.');
    return numero;
  }

  const acharDono = (req, id) => {
    const c = acharVisivel(req, id);
    if (c.empresa_dona_id !== req.contexto.empresaId) throw erro('sem_permissao', 'Só a empresa dona do canal pode configurar e conectar o número.');
    return c;
  };

  r.get('/canais', exigir, (req, res) => {
    const termo = String(req.query.busca || '').trim().toLowerCase();
    const digitos = termo.replace(/\D/g, '');
    let lista = escopo(db, req.contexto).todos(SQL_VISIVEIS)
      .filter(c => !termo || c.nome.toLowerCase().includes(termo) || (digitos.length >= 4 && String(c.numero || '').includes(digitos)))
      .filter(c => !req.query.estado || c.estado === req.query.estado)
      .filter(c => !req.query.provedor || c.provedor === req.query.provedor)
      .map(canalPublico)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const { limite, cursor } = lerPaginacao(req.query);
    const inicio = cursor?.o || 0;
    const itens = lista.slice(inicio, inicio + limite);
    res.json({ itens, proximo_cursor: inicio + itens.length < lista.length ? codificarCursor({ o: inicio + itens.length }) : null, total: lista.length });
  });

  r.get('/canais/:id', exigir, (req, res) => res.json(canalPublico(acharVisivel(req, req.params.id))));

  r.post('/canais', exigir, (req, res) => {
    const nome = String(req.body?.nome || '').trim();
    const campos = {};
    if (!nome) campos.nome = 'Informe o nome.';
    if (!telefone.valido(req.body?.numero)) campos.numero = 'Informe o número com DDI e DDD (ex.: 5565999990000).';
    if (req.body?.provedor === 'meta') campos.provedor = 'A Meta Cloud API ainda não está disponível (etapa G6).';
    else if (req.body?.provedor !== 'wweb') campos.provedor = 'Escolha o provedor.';
    if (Object.keys(campos).length) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos });
    const empresaId = req.contexto.exigirEmpresa();
    const numero = lerNumero(req.body.numero);
    const id = novoId('canal');
    const t = agora();
    db.transaction(() => {
      db.prepare(`INSERT INTO canais (id, empresa_dona_id, nome, numero, provedor, estado, estado_desde, sessao_id, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, 'wweb', 'parado', ?, ?, ?, ?)`).run(id, empresaId, nome, numero, t, `talk_${crypto.randomBytes(8).toString('hex')}`, t, t);
      const jaTemPadrao = db.prepare('SELECT 1 FROM canal_empresas WHERE empresa_id = ? AND padrao = 1').get(empresaId);
      db.prepare('INSERT INTO canal_empresas (canal_id, empresa_id, padrao) VALUES (?, ?, ?)').run(id, empresaId, jaTemPadrao ? 0 : 1);
      db.prepare("INSERT INTO canal_log (canal_id, em, tipo, mensagem) VALUES (?, ?, 'system', 'Canal cadastrado. Clique em Conectar para gerar o QR Code.')").run(id, t);
    })();
    auditar(req, 'canal.criado', id, `Cadastrou o canal ${nome}`);
    res.status(201).json(canalPublico(db.prepare('SELECT * FROM canais WHERE id = ?').get(id)));
  });

  // nome; numero (só com o canal parado e sem sessão); empresas_vinculadas [{ id, padrao }];
  // modo_teste e numeros_teste (só a plataforma).
  r.put('/canais/:id', exigir, (req, res) => {
    const c = acharDono(req, req.params.id);
    const b = req.body || {};
    if (b.nome !== undefined && !String(b.nome).trim()) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { nome: 'Informe o nome.' } });
    if ((b.modo_teste !== undefined || b.numeros_teste !== undefined) && !req.contexto.plataforma) {
      throw erro('sem_permissao', 'Só a administração da plataforma altera o modo de teste.');
    }
    let numeroCanal = c.numero;
    if (b.numero !== undefined && !telefone.mesmoNumero(b.numero, c.numero || '')) {
      numeroCanal = lerNumero(b.numero, c.id);
      if (c.ligado || supervisor.temSessao(c.id)) {
        throw erro('conflito', 'Para trocar o número, pare o canal e use "Remover sessão" antes. O novo número lerá um novo QR Code.');
      }
    }
    let numeros = null;
    if (b.numeros_teste !== undefined) {
      numeros = Array.isArray(b.numeros_teste) ? b.numeros_teste.map(telefone.normalizar) : null;
      if (!numeros || numeros.some(n => !telefone.valido(n))) throw erro('requisicao_invalida', 'Números de teste inválidos.', { campos: { numeros_teste: 'Use DDI e DDD (ex.: 5565999990000).' } });
    }
    db.transaction(() => {
      db.prepare(`UPDATE canais SET nome = ?, numero = ?, modo_teste = ?, numeros_teste = ?, atualizado_em = ? WHERE id = ?`).run(
        b.nome !== undefined ? String(b.nome).trim() : c.nome, numeroCanal,
        b.modo_teste !== undefined ? (b.modo_teste ? 1 : 0) : c.modo_teste,
        numeros ? JSON.stringify(numeros) : c.numeros_teste, agora(), c.id);
      if (Array.isArray(b.empresas_vinculadas)) {
        const ids = b.empresas_vinculadas.map(v => String(v.id));
        if (!ids.includes(c.empresa_dona_id)) throw erro('requisicao_invalida', 'A empresa dona precisa continuar usando o canal.');
        const outras = ids.filter(id => id !== c.empresa_dona_id);
        if (outras.length && !req.contexto.plataforma) throw erro('sem_permissao', 'Só a administração da plataforma vincula outras empresas a um número.');
        for (const id of ids) if (!db.prepare("SELECT 1 FROM empresas WHERE id = ? AND situacao = 'ativa'").get(id)) throw erro('requisicao_invalida', 'Empresa inválida na lista.');
        db.prepare('DELETE FROM canal_empresas WHERE canal_id = ?').run(c.id);
        for (const v of b.empresas_vinculadas) {
          // Uma empresa tem no máximo um canal padrão (o que envia o código de login).
          if (v.padrao) db.prepare('UPDATE canal_empresas SET padrao = 0 WHERE empresa_id = ?').run(String(v.id));
          db.prepare('INSERT INTO canal_empresas (canal_id, empresa_id, padrao) VALUES (?, ?, ?)').run(c.id, String(v.id), v.padrao ? 1 : 0);
        }
      }
    })();
    auditar(req, 'canal.alterado', c.id, `Alterou o canal ${c.nome}`);
    res.json(canalPublico(db.prepare('SELECT * FROM canais WHERE id = ?').get(c.id)));
  });

  const acao = (nome, fn, resumo) => r.post(`/canais/:id/${nome}`, exigir, async (req, res, next) => {
    try {
      const c = acharDono(req, req.params.id);
      await fn(c, req);
      auditar(req, `canal.${nome}`, c.id, `${resumo} — ${c.nome}`);
      res.json(canalPublico(db.prepare('SELECT * FROM canais WHERE id = ?').get(c.id)));
    } catch (err) { next(err); }
  });
  const ligar = (id, v) => db.prepare('UPDATE canais SET ligado = ? WHERE id = ?').run(v ? 1 : 0, id);

  acao('conectar', async (c) => {
    if (c.provedor !== 'wweb') throw erro('recurso_nao_suportado', 'Provedor ainda não disponível.');
    if (!c.numero) throw erro('requisicao_invalida', 'Cadastre o número do WhatsApp deste canal antes de conectar (Editar canal).', { campos: { numero: 'obrigatório' } });
    ligar(c.id, true);
    if (!supervisor.iniciar(c.id)) throw erro('conflito', 'Este canal já está conectado em outro processo do IA Talk.');
  }, 'Conectou');
  acao('desconectar', async (c) => { ligar(c.id, false); await supervisor.parar(c.id); }, 'Desconectou');
  acao('reconectar', async (c) => { ligar(c.id, true); await supervisor.reiniciar(c.id); }, 'Reconectou');
  acao('novo-qr', async (c) => {
    if (c.estado === 'conectado') throw erro('conflito', 'O canal já está conectado. Para trocar de aparelho, use "Limpar sessão".');
    ligar(c.id, true);
    await supervisor.reiniciar(c.id);
  }, 'Pediu novo QR');
  acao('limpar-sessao', async (c, req) => {
    if (req.body?.confirmar !== true) {
      throw erro('requisicao_invalida', 'Confirme que deseja limpar a sessão. O celular terá de ler um novo QR Code.', { campos: { confirmar: 'obrigatório' } });
    }
    ligar(c.id, false);
    await supervisor.limparSessao(c.id);
  }, 'Limpou a sessão');

  r.get('/canais/:id/qr', exigir, (req, res) => {
    const c = acharVisivel(req, req.params.id);
    const q = c.estado === 'qr_pendente' ? supervisor.qrAtual(c.id) : null;
    res.json({ canal_id: c.id, estado: c.estado, qr: q?.qr || null, expira_em: q?.expira_em || null });
  });

  r.get('/canais/:id/log', exigir, (req, res) => {
    const c = acharVisivel(req, req.params.id);
    const { limite, cursor } = lerPaginacao(req.query);
    const linhas = db.prepare(`SELECT id, em, tipo, mensagem FROM canal_log WHERE canal_id = ? AND (? IS NULL OR id < ?)
      AND (? IS NULL OR tipo = ?) ORDER BY id DESC LIMIT ?`).all(c.id, cursor?.id ?? null, cursor?.id ?? null, req.query.tipo || null, req.query.tipo || null, limite + 1);
    const mais = linhas.length > limite;
    const itens = linhas.slice(0, limite);
    res.json({ itens: itens.map(({ em, tipo, mensagem }) => ({ em, tipo, mensagem })), proximo_cursor: mais ? codificarCursor({ id: itens[itens.length - 1].id }) : null });
  });

  r.use(middlewareErros(log));
  return r;
}

module.exports = { criarRotasCanais, SQL_VISIVEIS };
