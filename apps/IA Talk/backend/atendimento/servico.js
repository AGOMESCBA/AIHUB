'use strict';

// Atendimento (C9): regras de quem pode o quê, entrada de mensagens, ações sobre a
// conversa e retornos para o sistema de origem. Contrato: docs/contratos.md §8.
// O servidor simulado (backend/simulado/atendimento.js) segue as mesmas regras.
//
// Quem vê: atendente vê as conversas dos setores de que é membro e as que estão com ele;
// supervisão (admin_empresa, supervisor, quem cadastra setores, plataforma) vê todas da empresa.
// Fora disso a conversa "não existe" (404). Texto da conversa nunca vai para log.

const { erro } = require('../erros');
const { agora } = require('../ids');
const telefone = require('../seguranca/telefone');
const regras = require('../canais/regras');
const { ROTINAS } = require('../acesso/papeis');
const { aceitarEnvio, TEXTO_MAXIMO } = require('../mensagens/servico');
const repo = require('./repositorio');
const horario = require('../lib/horario');

const LIMITE_NOTA = 2000;
const LIMITE_CONTEXTO = 4000;
const CODIGO_SETOR = /^[a-z0-9-]{2,30}$/;
const SISTEMA_ORIGEM = /^[a-z0-9-]{2,30}$/;
const ATALHO = /^\/[a-z0-9-]{2,30}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const SISTEMA = Object.freeze({ tipo: 'sistema', id: null, nome: 'IA Talk' });

const invalido = (campos) => erro('requisicao_invalida', 'Confira os campos destacados.', { campos });
const codigoDoNome = (nome) => String(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const textoEntre = (rotulo, max) => (v) => {
  const t = String(v ?? '').trim();
  return !t ? `Escreva ${rotulo}.` : t.length > max ? `Use no máximo ${max} caracteres.` : null;
};
function exigirCampos(corpo, validadores) {
  const campos = {};
  for (const [campo, fn] of Object.entries(validadores)) {
    const msg = fn(corpo?.[campo]);
    if (msg) campos[campo] = msg;
  }
  if (Object.keys(campos).length) throw invalido(campos);
}

// Validação do horário (§8.3): a mesma regra da biblioteca L1 (fuso válido, intervalos sem sobreposição…).
function validarHorario(h) {
  return h === undefined ? null : horario.validarHorario(h);
}
function validarForaHorario(f) {
  if (f === undefined) return null;
  if (!f || typeof f !== 'object' || typeof f.ligado !== 'boolean') return 'Informe ligado e texto.';
  const t = String(f.texto || '').trim();
  if (f.ligado && !t) return 'Escreva a mensagem de fora do horário.';
  return t.length > 1000 ? 'Use no máximo 1000 caracteres.' : null;
}

class Atendimento {
  // aoMudar(conversaId, { antes }) e aoItem(conversaId, item): avisos para o tempo real.
  // iaCommand: cliente das rotas internas do IA Command (número compartilhado, atendimento/ia-command.js).
  // aoAviso(canalId, texto): linha de aviso no Terminal do canal (sem texto de mensagem).
  constructor({ db, despachante = null, iaCommand = null, aoMudar = () => {}, aoItem = () => {}, aoEstadoItem = () => {}, aoAviso = () => {}, log = console }) {
    this.db = db;
    this.despachante = despachante;
    this.iaCommand = iaCommand;
    this.aoAviso = aoAviso;
    this._filas = new Map();       // canal → fila de mensagens (mantém a ordem na conferência com o IA Command)
    this._avisados = new Map();    // canal|motivo → quando avisou (no máximo 1 aviso a cada 10 min)
    this._sinc = new Map();        // conversa → fila de marcar/desmarcar no IA Command (mantém a ordem)
    this.esperasSincronizacao = [0, 2000, 10000]; // novas tentativas ao avisar o IA Command
    this.aoMudar = aoMudar;
    this.aoItem = aoItem;
    this.aoEstadoItem = aoEstadoItem;
    this.log = log;
  }

  // ── Acesso ────────────────────────────────────────────────────────────────
  // acesso = { empresaId, usuarioId, veTudo } (montado da sessão ou do socket).
  static acessoDe(contexto, rotinas = []) {
    return {
      empresaId: contexto.empresaId, usuarioId: contexto.usuarioId,
      veTudo: !!contexto.plataforma || ['admin_empresa', 'supervisor'].includes(contexto.papel) || rotinas.includes(ROTINAS.setores),
    };
  }

  podeVer(acesso, cv) {
    if (!cv || cv.empresa_id !== acesso.empresaId) return false;
    if (acesso.veTudo || cv.responsavel_id === acesso.usuarioId) return true;
    return repo.setoresDoUsuario(this.db, acesso.empresaId, acesso.usuarioId).includes(cv.setor_id);
  }

  conversa(acesso, id) {
    const cv = repo.buscarConversa(this.db, acesso.empresaId, id);
    if (!this.podeVer(acesso, cv)) throw erro('nao_encontrado', 'Conversa não encontrada.');
    return cv;
  }

  // Trecho SQL de visibilidade (lista e contadores).
  filtroVisivel(acesso, p) {
    p.empresa = acesso.empresaId;
    if (acesso.veTudo) return 'cv.empresa_id = @empresa';
    p.usuario = acesso.usuarioId;
    return '(cv.empresa_id = @empresa AND (cv.responsavel_id = @usuario OR cv.setor_id IN (SELECT setor_id FROM setor_membros WHERE usuario_id = @usuario)))';
  }

  contadores(acesso) {
    const p = {};
    const visivel = this.filtroVisivel(acesso, p);
    p.eu = acesso.usuarioId;
    const r = this.db.prepare(`SELECT COUNT(*) AS abertas, SUM(CASE WHEN cv.responsavel_id IS NULL THEN 1 ELSE 0 END) AS fila,
        SUM(CASE WHEN cv.responsavel_id = @eu THEN 1 ELSE 0 END) AS minhas FROM conversas cv WHERE ${visivel} AND cv.situacao = 'aberta'`).get(p);
    const setores = this.db.prepare(`SELECT s.id, s.nome FROM setores s WHERE s.empresa_id = @empresa AND s.situacao = 'ativo'
        ${acesso.veTudo ? '' : 'AND s.id IN (SELECT setor_id FROM setor_membros WHERE usuario_id = @usuario)'} ORDER BY s.nome`).all(p);
    const porSetor = this.db.prepare(`SELECT cv.setor_id, COUNT(*) AS abertas, SUM(CASE WHEN cv.responsavel_id IS NULL THEN 1 ELSE 0 END) AS na_fila
        FROM conversas cv WHERE ${visivel} AND cv.situacao = 'aberta' GROUP BY cv.setor_id`).all(p);
    const mapa = new Map(porSetor.map(x => [x.setor_id, x]));
    return {
      minhas: r.minhas || 0, fila: r.fila || 0, abertas: r.abertas || 0,
      por_setor: setores.map(s => ({ id: s.id, nome: s.nome, abertas: mapa.get(s.id)?.abertas || 0, na_fila: mapa.get(s.id)?.na_fila || 0 })),
      atualizado_em: agora(),
    };
  }

  // Por que a resposta não sai (a tela desabilita o campo e mostra o motivo).
  bloqueioDoCanal(cv) {
    const canal = this.db.prepare('SELECT envio_modo, ligado, numeros_teste FROM canais WHERE id = ?').get(cv.canal_id);
    if (!canal || canal.envio_modo === 'desligado') return { codigo: 'envio_desligado', motivo: 'O envio está desligado neste canal.' };
    if (!canal.ligado) return { codigo: 'canal_desconectado', motivo: 'O canal está parado. A resposta sai quando ele for conectado.' };
    if (!regras.podeEnviarPara(canal, cv.contato_telefone)) return { codigo: 'sem_permissao', motivo: 'Este canal ainda envia só para os números de teste.' };
    return null;
  }

  envio(acesso, cv) {
    const motivo = cv.situacao === 'encerrada' ? 'Conversa encerrada. Reabra para responder.'
      : cv.responsavel_id && cv.responsavel_id !== acesso.usuarioId ? `Esta conversa está com ${cv.responsavel_nome}. Peça a transferência para responder.`
        : this.bloqueioDoCanal(cv)?.motivo || null;
    return { pode_responder: !motivo, motivo, limite_caracteres: TEXTO_MAXIMO };
  }

  detalhe(acesso, cv) {
    const contato = repo.buscarContato(this.db, cv.empresa_id, cv.contato_id);
    return { ...repo.paraConversaResumo(this.db, cv), contato: repo.paraContato(this.db, contato), motivo_encerramento: cv.motivo_encerramento, envio: this.envio(acesso, cv) };
  }

  // ── Registro e avisos (um ponto só) ───────────────────────────────────────
  _item(cv, dados) {
    const it = repo.adicionarItem(this.db, cv.id, dados);
    this.aoItem(cv.id, repo.paraItem(it));
    return it;
  }
  _evento(cv, texto) { return this._item(cv, { categoria: 'evento', autor: SISTEMA, texto }); }
  _recarregar(cv) { return repo.buscarConversa(this.db, cv.empresa_id, cv.id); }
  _avisar(cv, antes = null) { this.aoMudar(cv.id, { empresaId: cv.empresa_id, antes }); }
  _quem(acesso) {
    const u = this.db.prepare('SELECT id, nome FROM usuarios WHERE id = ?').get(acesso.usuarioId);
    return u ? { id: u.id, nome: u.nome } : { id: acesso.usuarioId, nome: 'Administração' };
  }
  _setorPublico(setorId) {
    const s = this.db.prepare('SELECT codigo, nome FROM setores WHERE id = ?').get(setorId);
    return s ? { codigo: s.codigo, nome: s.nome } : null;
  }

  // ── Entrada (mensagem do WhatsApp num número em atendimento) ──────────────
  // Chamado pelo supervisor depois das regras de recebimento do canal. Grupos não viram conversa.
  // Número compartilhado: a mensagem só é do Talk se a pessoa NÃO é autorizada no IA Command ou
  // está em atendimento humano. Na dúvida (IA Command fora, sem canal, chave desligada) não grava:
  // a conversa pode ser do assistente do ERP. Devolve uma Promise (resolvida na ordem de chegada).
  receber(canalId, m) {
    const canal = this.db.prepare('SELECT id, uso, numero, atendimento_empresa_id, setor_padrao_id FROM canais WHERE id = ?').get(canalId);
    if (!canal || !['atendimento', 'compartilhado'].includes(canal.uso) || !canal.atendimento_empresa_id || !canal.setor_padrao_id) return null;
    if (m?.de?.tipo !== 'telefone' || !telefone.valido(m.de.valor)) return null;
    if (canal.uso === 'atendimento') return this._gravarEntrada(canal, m);
    const fila = (this._filas.get(canal.id) || Promise.resolve()).then(async () => {
      const estado = this.iaCommand && canal.numero ? await this.iaCommand.mensagem(canal.numero, m.de.valor, m.tipo === 'texto' ? m.texto : '', { em: m.em }) : null;
      const motivo = !estado ? 'sem_resposta' : !estado.canal_encontrado ? 'sem_canal' : !estado.repassar_ligado ? 'chave_desligada'
        : (estado.autorizado && !estado.em_atendimento) ? 'do_assistente' : null;
      if (!motivo) {
        const gravada = this._gravarEntrada(canal, m);
        if (gravada && m.id_provedor) {
          const r = await this.iaCommand.recibo(canal.numero, m.de.valor, m.id_provedor, m.tipo === 'texto' ? m.texto : '');
          if (!r?.registrado) this.aoAviso(canal.id, 'N\u00e3o foi poss\u00edvel confirmar ao IA Command o recebimento de uma mensagem.');
        }
        return gravada;
      }
      if (motivo !== 'do_assistente') this._avisarUmaVez(canal.id, motivo);
      return null;
    });
    this._filas.set(canal.id, fila.catch(() => {}));
    return fila;
  }

  _avisarUmaVez(canalId, motivo) {
    const TEXTOS = {
      sem_resposta: 'Número compartilhado: o IA Command não respondeu à conferência. A mensagem não foi gravada (pode ser do assistente).',
      sem_canal: 'Número compartilhado: o IA Command não tem um canal com este número. Cadastre o número no canal do IA Command.',
      chave_desligada: 'Número compartilhado: no IA Command, "Deixar para o IA Talk atender" está desligado neste canal. Nenhuma conversa é gravada até ligar.',
    };
    const chave = `${canalId}|${motivo}`;
    if (Date.now() - (this._avisados.get(chave) || 0) < 10 * 60 * 1000) return;
    this._avisados.set(chave, Date.now());
    this.aoAviso(canalId, TEXTOS[motivo]);
  }

  // Grava a mensagem recebida na conversa aberta do contato (ou abre uma nova no setor padrão).
  _gravarEntrada(canal, m) {
    const canalId = canal.id;
    if (m.id_provedor && this.db.prepare(`SELECT 1 FROM conversa_itens i JOIN conversas cv ON cv.id = i.conversa_id
        WHERE cv.canal_id = ? AND i.id_provedor = ?`).get(canalId, m.id_provedor)) return null; // repetida
    const empresaId = canal.atendimento_empresa_id;
    const cv = this.db.transaction(() => {
      const contato = repo.acharOuCriarContato(this.db, empresaId, m.de.valor, { nomeWhatsapp: m.nome || null });
      let aberta = repo.conversaAbertaDoContato(this.db, canalId, contato.id);
      const itens = [];
      if (!aberta) {
        const setor = this.db.prepare("SELECT id, nome FROM setores WHERE id = ? AND situacao = 'ativo'").get(canal.setor_padrao_id);
        if (!setor) return null;
        aberta = { id: repo.criarConversa(this.db, { empresaId, canalId, contatoId: contato.id, setorId: setor.id }) };
        itens.push(repo.adicionarItem(this.db, aberta.id, { categoria: 'evento', autor: SISTEMA, texto: `Conversa aberta no setor ${setor.nome}.`, em: m.em || agora() }));
      }
      itens.push(repo.adicionarItem(this.db, aberta.id, { categoria: 'mensagem', direcao: 'entrada', autor: { tipo: 'contato', id: contato.id, nome: contato.nome },
        tipo: m.tipo || 'texto', texto: m.texto || null, idProvedor: m.id_provedor || null, em: m.em || agora() }));
      this.db.prepare('UPDATE conversas SET nao_lidas = nao_lidas + 1 WHERE id = ?').run(aberta.id);
      return { id: aberta.id, empresa_id: empresaId, itens };
    })();
    if (!cv) return null;
    // Avisos só depois de gravado (a tela nunca vê o que não está no banco).
    for (const it of cv.itens) this.aoItem(cv.id, repo.paraItem(it));
    this._avisoForaDoHorario(cv.id, cv.empresa_id, m.em || agora());
    this._avisar(cv);
    return { id: cv.id, empresa_id: cv.empresa_id };
  }

  // Fora do horário do setor, com a mensagem ligada: UMA resposta automática por conversa a cada
  // 12 h (§8.6), respeitando as regras de envio do canal. A janela é gravada de forma atômica
  // (duas mensagens chegando juntas não disparam dois avisos). Nada mais responde sozinho.
  _avisoForaDoHorario(conversaId, empresaId, instante) {
    try {
      const cv = repo.buscarConversa(this.db, empresaId, conversaId);
      const setor = cv && this.db.prepare('SELECT horario, fora_horario FROM setores WHERE id = ?').get(cv.setor_id);
      if (!setor) return null;
      const fora = repo.json(setor.fora_horario, {});
      const texto = String(fora.texto || '').trim();
      if (!fora.ligado || !texto) return null;
      if (horario.dentroDoHorario(repo.json(setor.horario, {}), instante)) return null;
      if (this.bloqueioDoCanal(cv)) return null;
      const limite = new Date(Date.parse(instante) - horario.JANELA_AVISO_PADRAO_MS).toISOString();
      // Reserva da janela + mensagem na fila + item na conversa: tudo ou nada (falha = janela livre).
      const it = this.db.transaction(() => {
        const r = this.db.prepare(`UPDATE conversas SET ultimo_aviso_fora_horario_em = ? WHERE id = ?
            AND (ultimo_aviso_fora_horario_em IS NULL OR ultimo_aviso_fora_horario_em <= ?)`).run(instante, cv.id, limite);
        if (!r.changes) return null;
        const m = aceitarEnvio(this.db, { empresaId: cv.empresa_id, canalId: cv.canal_id, para: cv.contato_telefone, texto, origem: 'automatica',
          correlacaoId: cv.protocolo, metadados: { conversa_id: cv.id } });
        return repo.adicionarItem(this.db, cv.id, { categoria: 'mensagem', direcao: 'saida', autor: SISTEMA, tipo: 'texto', texto: m.conteudo, mensagemId: m.id });
      })();
      if (!it) return null;
      this.aoItem(cv.id, repo.paraItem(it));
      this.despachante?.acordar();
      return it;
    } catch (err) {
      this.log?.error?.(`[IA Talk] Aviso de fora do horário não enviado (conversa ${conversaId}): ${err.message}`);
      return null;
    }
  }

  // ── Ações ─────────────────────────────────────────────────────────────────
  _exigirAberta(cv) { if (cv.situacao !== 'aberta') throw erro('conflito', 'Conversa encerrada. Reabra para continuar.'); }
  _exigirDonoOuSupervisao(acesso, cv) {
    if (cv.responsavel_id && cv.responsavel_id !== acesso.usuarioId && !acesso.veTudo) {
      throw erro('sem_permissao', `Esta conversa está com ${cv.responsavel_nome}. Só quem está com ela ou a supervisão pode fazer isso.`);
    }
  }

  assumir(acesso, id) {
    const cv = this.conversa(acesso, id);
    this._exigirAberta(cv);
    if (cv.responsavel_id === acesso.usuarioId) return cv; // repetir não muda nada
    const quem = this._quem(acesso);
    // Disputa: só um UPDATE vence (responsavel_id ainda nulo).
    const ok = this.db.transaction(() => {
      const r = this.db.prepare(`UPDATE conversas SET responsavel_id = ?, atualizada_em = ? WHERE id = ? AND situacao = 'aberta' AND responsavel_id IS NULL`)
        .run(quem.id, agora(), cv.id);
      if (!r.changes) return false;
      repo.registrarRetornos(this.db, cv, 'conversa.assumida', { responsavel: quem });
      return true;
    })();
    if (!ok) {
      const atual = this._recarregar(cv);
      throw erro('conflito', atual.responsavel_id ? `${atual.responsavel_nome} já assumiu esta conversa.` : 'A conversa mudou. Recarregue e tente de novo.');
    }
    this._evento(cv, `${quem.nome} assumiu a conversa.`);
    const nova = this._recarregar(cv);
    this._avisar(nova);
    return nova;
  }

  devolver(acesso, id) {
    const cv = this.conversa(acesso, id);
    this._exigirAberta(cv);
    if (!cv.responsavel_id) throw erro('conflito', 'Esta conversa já está na fila.');
    this._exigirDonoOuSupervisao(acesso, cv);
    this.db.transaction(() => {
      repo.atualizarConversa(this.db, cv.id, { responsavel_id: null });
      repo.registrarRetornos(this.db, cv, 'conversa.devolvida', { setor: this._setorPublico(cv.setor_id) });
    })();
    this._evento(cv, `${this._quem(acesso).nome} devolveu a conversa para a fila do setor ${cv.setor_nome}.`);
    const nova = this._recarregar(cv);
    this._avisar(nova, cv);
    return nova;
  }

  transferir(acesso, id, b = {}) {
    const cv = this.conversa(acesso, id);
    this._exigirAberta(cv);
    this._exigirDonoOuSupervisao(acesso, cv);
    if (!b.setor_id && !b.responsavel_id) throw erro('requisicao_invalida', 'Escolha o setor ou a pessoa que vai receber a conversa.', { campos: { setor_id: 'Escolha o setor ou a pessoa.' } });
    const destino = b.setor_id ? repo.buscarSetor(this.db, acesso.empresaId, b.setor_id) : repo.buscarSetor(this.db, acesso.empresaId, cv.setor_id);
    if (!destino) throw erro('nao_encontrado', 'Setor não encontrado.');
    if (destino.situacao !== 'ativo') throw invalido({ setor_id: 'Este setor está inativo.' });
    let pessoa = null;
    if (b.responsavel_id) {
      pessoa = this.db.prepare(`SELECT u.id, u.nome FROM setor_membros sm JOIN usuarios u ON u.id = sm.usuario_id
          JOIN membros mb ON mb.usuario_id = u.id AND mb.empresa_id = ? AND mb.situacao = 'ativo'
          WHERE sm.setor_id = ? AND u.id = ? AND u.situacao = 'ativo'`).get(acesso.empresaId, destino.id, String(b.responsavel_id));
      if (!pessoa) throw invalido({ responsavel_id: `Escolha alguém do setor ${destino.nome} ou troque o setor.` });
    }
    if (b.nota !== undefined) exigirCampos(b, { nota: textoEntre('a nota', LIMITE_NOTA) });
    const quem = this._quem(acesso);
    this.db.transaction(() => {
      repo.atualizarConversa(this.db, cv.id, { setor_id: destino.id, responsavel_id: pessoa?.id || null });
      repo.registrarRetornos(this.db, cv, 'conversa.transferida', { setor: { codigo: destino.codigo, nome: destino.nome }, responsavel: pessoa });
    })();
    this._evento(cv, pessoa ? `${quem.nome} transferiu para ${pessoa.nome} (${destino.nome}).` : `${quem.nome} transferiu para o setor ${destino.nome}.`);
    if (b.nota) this._item(cv, { categoria: 'nota', autor: { tipo: 'atendente', ...quem }, texto: String(b.nota).trim() });
    const nova = this._recarregar(cv);
    this._avisar(nova, cv);
    return nova;
  }

  encerrar(acesso, id, { motivo } = {}) {
    const cv = this.conversa(acesso, id);
    this._exigirAberta(cv);
    this._exigirDonoOuSupervisao(acesso, cv);
    const m = String(motivo || '').trim();
    if (m.length > 200) throw invalido({ motivo: 'Use no máximo 200 caracteres.' });
    const quem = this._quem(acesso);
    const t = agora();
    this.db.transaction(() => {
      repo.atualizarConversa(this.db, cv.id, { situacao: 'encerrada', responsavel_id: cv.responsavel_id || quem.id, motivo_encerramento: m || null,
        nao_lidas: 0, encerrada_em: t, atualizada_em: t });
      repo.registrarRetornos(this.db, { ...cv, situacao: 'encerrada' }, 'conversa.encerrada', {
        motivo: m || null, responsavel: cv.responsavel_id ? { id: cv.responsavel_id, nome: cv.responsavel_nome } : quem, encerrada_em: t });
    })();
    this._evento(cv, `${quem.nome} encerrou a conversa${m ? `: ${m}` : ''}.`);
    this.sincronizacao = this._desmarcarNoIaCommand(cv);
    const nova = this._recarregar(cv);
    this._avisar(nova);
    return nova;
  }

  reabrir(acesso, id) {
    const cv = this.conversa(acesso, id);
    if (cv.situacao !== 'encerrada') throw erro('conflito', 'Esta conversa já está aberta.');
    const outra = repo.conversaAbertaDoContato(this.db, cv.canal_id, cv.contato_id);
    if (outra) {
      const p = this.db.prepare('SELECT protocolo FROM conversas WHERE id = ?').get(outra.id);
      throw erro('conflito', `Já existe uma conversa aberta com este contato (protocolo ${p.protocolo}).`, { detalhe: { conversa_id: outra.id } });
    }
    const quem = this._quem(acesso);
    this.db.transaction(() => {
      repo.atualizarConversa(this.db, cv.id, { situacao: 'aberta', responsavel_id: quem.id, encerrada_em: null, motivo_encerramento: null });
      repo.registrarRetornos(this.db, { ...cv, situacao: 'aberta' }, 'conversa.reaberta', { responsavel: quem });
    })();
    this._evento(cv, `${quem.nome} reabriu a conversa.`);
    const nova = this._recarregar(cv);
    this._avisar(nova);
    return nova;
  }

  marcarLida(acesso, id) {
    const cv = this.conversa(acesso, id);
    repo.atualizarConversa(this.db, cv.id, { nao_lidas: 0, atualizada_em: cv.atualizada_em });
    const nova = this._recarregar(cv);
    this._avisar(nova);
    return nova;
  }

  etiquetas(acesso, id, lista) {
    const cv = this.conversa(acesso, id);
    const limpas = Array.isArray(lista) ? [...new Set(lista.map(e => String(e).trim()).filter(Boolean))] : null;
    if (!limpas || limpas.length > 10 || limpas.some(e => e.length > 30)) throw invalido({ etiquetas: 'Até 10 etiquetas, cada uma com até 30 caracteres.' });
    repo.atualizarConversa(this.db, cv.id, { etiquetas: JSON.stringify(limpas) });
    const nova = this._recarregar(cv);
    this._avisar(nova);
    return nova;
  }

  nota(acesso, id, texto) {
    const cv = this.conversa(acesso, id);
    exigirCampos({ texto }, { texto: textoEntre('a nota', LIMITE_NOTA) });
    const it = this._item(cv, { categoria: 'nota', autor: { tipo: 'atendente', ...this._quem(acesso) }, texto: String(texto).trim() });
    this._avisar(this._recarregar(cv));
    return repo.paraItem(it);
  }

  // Envio para o contato pela fila da C3 (mesmos estados, ritmo e regras do canal).
  _enviar(cv, texto, { autor, origem, usuarioId = null, aplicacaoId = null, marcar = true }) {
    const m = aceitarEnvio(this.db, { empresaId: cv.empresa_id, canalId: cv.canal_id, para: cv.contato_telefone, texto, origem,
      usuarioId, aplicacaoId, correlacaoId: cv.protocolo, metadados: { conversa_id: cv.id } });
    const it = this._item(cv, { categoria: 'mensagem', direcao: 'saida', autor, tipo: 'texto', texto: m.conteudo, mensagemId: m.id });
    if (marcar) this.sincronizacao = this._marcarNoIaCommand(cv);
    this.despachante?.acordar();
    return it;
  }

  // ── Número compartilhado com o IA Command (melhor esforço; nunca derruba a ação) ──
  // Pessoa AUTORIZADA no IA Command que o Talk está atendendo: o IA Command precisa saber,
  // senão o assistente responderia a resposta dela. Quem não é autorizado já é do Talk.
  _compartilhado(cv) {
    const c = this.db.prepare('SELECT uso, numero FROM canais WHERE id = ?').get(cv.canal_id);
    return c?.uso === 'compartilhado' && c.numero && this.iaCommand ? c.numero : null;
  }

  // Fila por PESSOA no número (o estado no IA Command é por canal + telefone, não por conversa):
  // marcar e desmarcar chegam na ordem em que aconteceram, mesmo vindos de conversas diferentes.
  _naFila(cv, operacao) {
    const chave = `${cv.canal_id}|${cv.contato_id}`;
    const anterior = this._sinc.get(chave) || Promise.resolve();
    const p = anterior.then(operacao).catch(() => null);
    this._sinc.set(chave, p);
    p.then(() => { if (this._sinc.get(chave) === p) this._sinc.delete(chave); });
    return p;
  }

  // Tenta de novo enquanto a resposta não for um sucesso DE VERDADE (aceito(r)), e não só HTTP 200.
  async _tentar(fn, aceito = (r) => !!r) {
    let ultima = null;
    for (const espera of this.esperasSincronizacao) {
      if (espera) await new Promise(r => setTimeout(r, espera).unref?.());
      ultima = await fn().catch(() => null);
      if (aceito(ultima)) return { ok: true, r: ultima };
      if (ultima && ultima.canal_encontrado === false) break; // cadastro: tentar de novo não resolve
    }
    return { ok: false, r: ultima };
  }

  // Não deu para avisar o IA Command: fica registrado na conversa e no Terminal (sem texto de mensagem).
  // A reconciliação (a cada 5 min e ao iniciar) tenta de novo sozinha.
  _falhaDeSincronizacao(cv, oque, r) {
    const motivo = r?.canal_encontrado === false ? 'o IA Command não tem um canal com este número'
      : r && r.repassar_ligado === false ? 'no IA Command, "Deixar para o IA Talk atender" está desligado neste canal' : 'sem resposta do IA Command';
    const texto = `Não foi possível avisar o IA Command (${oque}: ${motivo}). ${oque === 'atendimento iniciado'
      ? 'A resposta desta pessoa pode ir para o assistente; o IA Talk tenta de novo em alguns minutos.'
      : 'O assistente pode continuar em silêncio para esta pessoa por até 4 h; o IA Talk tenta de novo em alguns minutos.'}`;
    this._evento(cv, texto);
    this.aoAviso(cv.canal_id, `Conversa ${cv.protocolo}: ${texto}`);
  }

  _marcarNoIaCommand(cv, { avisarFalha = true, reconciliacao = false } = {}) {
    const numeroCanal = this._compartilhado(cv);
    if (!numeroCanal) return Promise.resolve(null);
    return this._naFila(cv, async () => {
      // Só consulta (não vale como recibo de mensagem).
      const e = await this._tentar(() => this.iaCommand.mensagem(numeroCanal, cv.contato_telefone, '', { apenasConsulta: true }), (r) => r?.canal_encontrado === true);
      if (!e.ok) { if (avisarFalha) this._falhaDeSincronizacao(cv, 'atendimento iniciado', e.r); return null; }
      if (!e.r.autorizado) return e.r; // quem não é autorizado já é do Talk
      const r = await this._tentar(() => this.iaCommand.iniciado(numeroCanal, cv.contato_telefone, cv.atualizada_em, reconciliacao), (x) => x?.canal_encontrado === true && x.repassar_ligado === true);
      if (!r.ok && avisarFalha) this._falhaDeSincronizacao(cv, 'atendimento iniciado', r.r);
      return r.ok ? r.r : null;
    });
  }

  // Encerrou: a pessoa autorizada volta para o assistente, e o Talk avisa por uma mensagem fixa.
  _desmarcarNoIaCommand(cv, { avisar = true } = {}) {
    const numeroCanal = this._compartilhado(cv);
    if (!numeroCanal) return Promise.resolve(null);
    return this._naFila(cv, async () => {
      const r = await this._tentar(() => this.iaCommand.encerrado(numeroCanal, cv.contato_telefone), (x) => x?.canal_encontrado === true);
      if (!r.ok) { if (avisar) this._falhaDeSincronizacao(cv, 'atendimento encerrado', r.r); return null; }
      if (avisar && r.r.encerrados > 0 && !this.bloqueioDoCanal(cv)) {
        this._enviar(this._recarregar(cv), 'O atendimento foi encerrado. O assistente voltou a responder por aqui.',
          { autor: SISTEMA, origem: 'automatica', marcar: false });
      }
      return r.r;
    });
  }

  // Reconciliação (ao iniciar e a cada 5 min): refaz no IA Command o que o Talk sabe, porque uma
  // marcação pendente se perde se o Talk reiniciar. Idempotente e sem mensagem para a pessoa:
  //  - conversa aberta com atividade nas últimas 4 h → marcar (se a pessoa é autorizada lá);
  //  - encerrada nas últimas 24 h, sem outra aberta do mesmo contato no número → desmarcar.
  async reconciliar(agoraMs = Date.now()) {
    if (!this.iaCommand) return { marcadas: 0, desmarcadas: 0 };
    const desde4h = new Date(agoraMs - 4 * 60 * 60 * 1000).toISOString();
    const desde24h = new Date(agoraMs - 24 * 60 * 60 * 1000).toISOString();
    const base = `${repo.SELECT_CONVERSA} WHERE cn.uso = 'compartilhado' AND cn.numero IS NOT NULL`;
    const abertas = this.db.prepare(`${base} AND cv.situacao = 'aberta' AND cv.atualizada_em >= ?`).all(desde4h);
    const encerradas = this.db.prepare(`${base} AND cv.situacao = 'encerrada' AND cv.encerrada_em >= ?
        AND NOT EXISTS (SELECT 1 FROM conversas o WHERE o.canal_id = cv.canal_id AND o.contato_id = cv.contato_id AND o.situacao = 'aberta')`).all(desde24h);
    let marcadas = 0;
    let desmarcadas = 0;
    for (const cv of abertas) if (await this._marcarNoIaCommand(cv, { avisarFalha: false, reconciliacao: true })) marcadas++;
    for (const cv of encerradas) if (await this._desmarcarNoIaCommand(cv, { avisar: false })) desmarcadas++;
    return { marcadas, desmarcadas };
  }

  // "Estou vivo" para o IA Command, por número compartilhado conectado (sem ele o IA Command
  // responde como sempre, mesmo com a chave ligada). Chamado a cada minuto pelo servidor.
  async enviarBatimentos() {
    if (!this.iaCommand) return 0;
    const canais = this.db.prepare("SELECT numero FROM canais WHERE uso = 'compartilhado' AND ligado = 1 AND estado = 'conectado' AND numero IS NOT NULL").all();
    let ok = 0;
    for (const c of canais) if ((await this.iaCommand.batimento(c.numero))?.canal_encontrado) ok++;
    return ok;
  }

  iniciarBatimentos(intervaloMs = 60_000, reconciliarMs = 5 * 60_000) {
    this.pararBatimentos();
    const rodar = () => this.enviarBatimentos().catch(() => 0);
    const acertar = () => this.reconciliar().catch(() => null);
    rodar();
    acertar();
    this._timerBatimento = setInterval(rodar, intervaloMs);
    this._timerReconciliar = setInterval(acertar, reconciliarMs);
    this._timerBatimento.unref?.();
    this._timerReconciliar.unref?.();
  }

  pararBatimentos() {
    if (this._timerBatimento) clearInterval(this._timerBatimento);
    if (this._timerReconciliar) clearInterval(this._timerReconciliar);
    this._timerBatimento = null;
    this._timerReconciliar = null;
  }

  responder(acesso, id, texto) {
    const cv = this.conversa(acesso, id);
    exigirCampos({ texto }, { texto: textoEntre('a resposta', TEXTO_MAXIMO) });
    if (cv.situacao === 'encerrada' || (cv.responsavel_id && cv.responsavel_id !== acesso.usuarioId)) throw erro('conflito', this.envio(acesso, cv).motivo);
    const bloqueio = this.bloqueioDoCanal(cv);
    if (bloqueio) throw erro(bloqueio.codigo, bloqueio.motivo);
    const quem = this._quem(acesso);
    if (!cv.responsavel_id) this.assumir(acesso, id); // responder da fila já assume (ou 409 se alguém levou antes)
    const it = this._enviar(cv, String(texto).trim(), { autor: { tipo: 'atendente', ...quem }, origem: 'atendimento', usuarioId: quem.id });
    repo.atualizarConversa(this.db, cv.id, { nao_lidas: 0, atualizada_em: it.em });
    this._avisar(this._recarregar(cv));
    return repo.paraItem(it);
  }

  // Estado de uma mensagem da fila mudou: se ela é de uma conversa, avisa quem está nela.
  aoEstadoMensagem(m) {
    const it = repo.itemDaMensagem(this.db, m.id);
    if (it) this.aoEstadoItem(it.conversa_id, { conversa_id: it.conversa_id, item_id: it.id, estado: m.estado, em: m.atualizada_em });
  }

  // ── Contatos ──────────────────────────────────────────────────────────────
  contato(acesso, id) {
    const ct = repo.buscarContato(this.db, acesso.empresaId, id);
    if (!ct) throw erro('nao_encontrado', 'Contato não encontrado.');
    if (!acesso.veTudo) {
      const p = {};
      const vis = this.filtroVisivel(acesso, p);
      p.ct = ct.id;
      if (!this.db.prepare(`SELECT 1 FROM conversas cv WHERE ${vis} AND cv.contato_id = @ct LIMIT 1`).get(p)) throw erro('nao_encontrado', 'Contato não encontrado.');
    }
    return ct;
  }

  renomearContato(acesso, id, nome) {
    const ct = this.contato(acesso, id);
    exigirCampos({ nome }, { nome: textoEntre('o nome', 80) });
    this.db.prepare('UPDATE contatos SET nome = ?, atualizado_em = ? WHERE id = ?').run(String(nome).trim(), agora(), ct.id);
    for (const c of this.db.prepare("SELECT id FROM conversas WHERE contato_id = ? AND situacao = 'aberta'").all(ct.id)) this.aoMudar(c.id, { empresaId: ct.empresa_id });
    return repo.buscarContato(this.db, acesso.empresaId, ct.id);
  }

  // ── Setores ───────────────────────────────────────────────────────────────
  _membrosValidos(empresaId, lista) {
    if (lista === undefined) return undefined;
    const ids = Array.isArray(lista) ? [...new Set(lista.map(String))] : null;
    const validos = ids && ids.every(u => this.db.prepare(`SELECT 1 FROM membros mb JOIN usuarios u ON u.id = mb.usuario_id
        WHERE mb.empresa_id = ? AND mb.usuario_id = ? AND mb.situacao = 'ativo' AND u.situacao = 'ativo'`).get(empresaId, u));
    if (!validos) throw invalido({ membros: 'Escolha usuários ativos da empresa.' });
    return ids;
  }

  criarSetor(acesso, b = {}) {
    exigirCampos(b, {
      nome: textoEntre('o nome', 60), horario: validarHorario, fora_horario: validarForaHorario,
      codigo: (v) => (v === undefined || CODIGO_SETOR.test(String(v)) ? null : 'Use de 2 a 30 letras minúsculas, números e hífen (ex.: suporte).'),
    });
    const nome = String(b.nome).trim();
    const codigo = b.codigo ?? codigoDoNome(nome);
    if (!CODIGO_SETOR.test(codigo)) throw invalido({ codigo: 'Informe um código de 2 a 30 letras minúsculas, números e hífen.' });
    if (this.db.prepare('SELECT 1 FROM setores WHERE empresa_id = ? AND nome = ? COLLATE NOCASE').get(acesso.empresaId, nome)) throw erro('conflito', 'Já existe um setor com este nome.');
    if (repo.setorPorCodigo(this.db, acesso.empresaId, codigo)) throw erro('conflito', `Já existe um setor com o código ${codigo}.`);
    const membros = this._membrosValidos(acesso.empresaId, b.membros) || [];
    const id = require('../ids').novoId('setor');
    const t = agora();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO setores (id, empresa_id, codigo, nome, descricao, horario, fora_horario, criado_em, atualizado_em)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, acesso.empresaId, codigo, nome, String(b.descricao || '').trim().slice(0, 200),
        JSON.stringify(b.horario || { ligado: false, fuso: 'America/Cuiaba', dias: [] }), JSON.stringify(b.fora_horario || { ligado: false, texto: '' }), t, t);
      repo.trocarMembros(this.db, id, membros);
    })();
    return repo.buscarSetor(this.db, acesso.empresaId, id);
  }

  atualizarSetor(acesso, id, b = {}) {
    const s = repo.buscarSetor(this.db, acesso.empresaId, id);
    if (!s) throw erro('nao_encontrado', 'Setor não encontrado.');
    if (b.versao !== s.versao) throw erro('conflito', 'Este setor foi alterado em outra sessão. Recarregue antes de salvar.');
    if (b.codigo !== undefined && b.codigo !== s.codigo) throw invalido({ codigo: 'O código não muda depois de criado: os sistemas de origem usam ele.' });
    exigirCampos(b, {
      nome: (v) => (v === undefined ? null : textoEntre('o nome', 60)(v)), horario: validarHorario, fora_horario: validarForaHorario,
      situacao: (v) => (v === undefined || ['ativo', 'inativo'].includes(v) ? null : 'Use ativo ou inativo.'),
    });
    if (b.nome !== undefined && this.db.prepare('SELECT 1 FROM setores WHERE empresa_id = ? AND nome = ? COLLATE NOCASE AND id <> ?').get(acesso.empresaId, String(b.nome).trim(), s.id)) {
      throw erro('conflito', 'Já existe um setor com este nome.');
    }
    if (b.situacao === 'inativo' && s.situacao === 'ativo') {
      if (this.db.prepare("SELECT 1 FROM conversas WHERE setor_id = ? AND situacao = 'aberta' LIMIT 1").get(s.id)) throw erro('conflito', 'Este setor tem conversas abertas. Transfira-as antes de inativar.');
      if (this.db.prepare('SELECT 1 FROM canais WHERE setor_padrao_id = ? LIMIT 1').get(s.id)) throw erro('conflito', 'Este setor recebe as conversas novas de um canal. Troque o setor padrão do canal antes de inativar.');
    }
    const membros = this._membrosValidos(acesso.empresaId, b.membros);
    this.db.transaction(() => {
      // Versão conferida de novo no UPDATE: duas pessoas salvando juntas, só uma passa.
      const r = this.db.prepare(`UPDATE setores SET nome = ?, descricao = ?, horario = ?, fora_horario = ?, situacao = ?, versao = versao + 1, atualizado_em = ?
          WHERE id = ? AND versao = ?`).run(
        b.nome !== undefined ? String(b.nome).trim() : s.nome, b.descricao !== undefined ? String(b.descricao).trim().slice(0, 200) : s.descricao,
        b.horario ? JSON.stringify(b.horario) : s.horario, b.fora_horario ? JSON.stringify(b.fora_horario) : s.fora_horario,
        b.situacao || s.situacao, agora(), s.id, s.versao);
      if (!r.changes) throw erro('conflito', 'Este setor foi alterado em outra sessão. Recarregue antes de salvar.');
      if (membros) repo.trocarMembros(this.db, s.id, membros);
    })();
    return repo.buscarSetor(this.db, acesso.empresaId, s.id);
  }

  // ── Respostas rápidas ─────────────────────────────────────────────────────
  _validarResposta(b, parcial) {
    exigirCampos(b, {
      atalho: (v) => (parcial && v === undefined ? null : ATALHO.test(String(v || '')) ? null : 'Comece com / e use letras minúsculas, números e hífen (ex.: /boleto).'),
      titulo: (v) => (parcial && v === undefined ? null : textoEntre('o título', 60)(v)),
      texto: (v) => (parcial && v === undefined ? null : textoEntre('o texto', 1000)(v)),
      situacao: (v) => (v === undefined || ['ativa', 'inativa'].includes(v) ? null : 'Use ativa ou inativa.'),
    });
  }
  _setorDaResposta(empresaId, setorId) {
    if (setorId === undefined || setorId === null) return setorId;
    const s = repo.buscarSetor(this.db, empresaId, setorId);
    if (!s) throw erro('nao_encontrado', 'Setor não encontrado.');
    return s.id;
  }

  criarResposta(acesso, b = {}) {
    this._validarResposta(b, false);
    if (this.db.prepare('SELECT 1 FROM respostas_rapidas WHERE empresa_id = ? AND atalho = ?').get(acesso.empresaId, b.atalho)) throw erro('conflito', 'Já existe uma resposta rápida com este atalho.');
    const id = require('../ids').novoId('resposta_rapida');
    this.db.prepare(`INSERT INTO respostas_rapidas (id, empresa_id, atalho, titulo, texto, setor_id, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, acesso.empresaId, b.atalho, String(b.titulo).trim(), String(b.texto).trim(), this._setorDaResposta(acesso.empresaId, b.setor_id ?? null), agora());
    return id;
  }

  atualizarResposta(acesso, id, b = {}) {
    const r = this.db.prepare('SELECT * FROM respostas_rapidas WHERE id = ? AND empresa_id = ?').get(String(id || ''), acesso.empresaId);
    if (!r) throw erro('nao_encontrado', 'Resposta rápida não encontrada.');
    this._validarResposta(b, true);
    if (b.atalho !== undefined && this.db.prepare('SELECT 1 FROM respostas_rapidas WHERE empresa_id = ? AND atalho = ? AND id <> ?').get(acesso.empresaId, b.atalho, r.id)) {
      throw erro('conflito', 'Já existe uma resposta rápida com este atalho.');
    }
    const setor = this._setorDaResposta(acesso.empresaId, b.setor_id);
    this.db.prepare(`UPDATE respostas_rapidas SET atalho = ?, titulo = ?, texto = ?, setor_id = ?, situacao = ?, atualizado_em = ? WHERE id = ?`).run(
      b.atalho ?? r.atalho, b.titulo !== undefined ? String(b.titulo).trim() : r.titulo, b.texto !== undefined ? String(b.texto).trim() : r.texto,
      setor === undefined ? r.setor_id : setor, b.situacao || r.situacao, agora(), r.id);
    return r.id;
  }

  // ── Sistema de origem (API v1, §8.9) ──────────────────────────────────────
  // app = { aplicacaoId, empresaId, nome }. Devolve { cv, resultado, mensagem_inicial }.
  abrirPorChamado(app, b = {}) {
    const canal = this.db.prepare('SELECT * FROM canais WHERE id = ?').get(String(b.canal || ''));
    const autorizado = canal && this.db.prepare('SELECT 1 FROM aplicacao_canais WHERE aplicacao_id = ? AND canal_id = ?').get(app.aplicacaoId, canal.id);
    if (!autorizado) throw erro('canal_nao_autorizado', 'Este canal não está autorizado para a aplicação.');
    exigirCampos(b, {
      contato: (v) => (!telefone.valido(v?.telefone) ? 'Informe contato.telefone com DDI e DDD (ex.: 5565999990000).'
        : String(v.nome || '').trim().length > 80 ? 'Use no máximo 80 caracteres em contato.nome.' : null),
      referencia: (v) => (!v || typeof v !== 'object' || !SISTEMA_ORIGEM.test(String(v.sistema || '')) ? 'Informe referencia.sistema (ex.: softexpert).'
        : !String(v.id ?? '').trim() || String(v.id).length > 64 ? 'Informe referencia.id (até 64 caracteres).'
          : String(v.titulo || '').length > 200 ? 'Use no máximo 200 caracteres em referencia.titulo.'
            : v.link !== undefined && v.link !== null && !/^https:\/\/\S{1,490}$/.test(String(v.link)) ? 'O link precisa começar com https://.' : null),
      contexto: (v) => (v === undefined || String(v).length <= LIMITE_CONTEXTO ? null : `Use no máximo ${LIMITE_CONTEXTO} caracteres.`),
      prioridade: (v) => (v === undefined || ['normal', 'alta'].includes(v) ? null : 'Use normal ou alta.'),
      setor: (v) => (v === undefined || CODIGO_SETOR.test(String(v)) ? null : 'Use o código do setor (ex.: suporte).'),
      mensagem_inicial: (v) => (v === undefined ? null : textoEntre('a mensagem inicial', TEXTO_MAXIMO)(v)),
    });
    if (!['atendimento', 'compartilhado'].includes(canal.uso) || !canal.atendimento_empresa_id) {
      throw erro('recurso_nao_suportado', 'Este número não está em atendimento. Peça à administração do IA Talk para ligar o atendimento no canal.');
    }
    // O chamado entra no atendimento da empresa da aplicação: ela precisa ser a que atende o número.
    if (canal.atendimento_empresa_id !== app.empresaId) throw erro('canal_nao_autorizado', 'Outra empresa atende este número.');
    const setor = b.setor === undefined ? this.db.prepare('SELECT * FROM setores WHERE id = ?').get(canal.setor_padrao_id)
      : repo.setorPorCodigo(this.db, app.empresaId, b.setor);
    if (!setor || setor.situacao !== 'ativo') throw invalido({ setor: 'Setor inexistente ou inativo neste atendimento.' });
    const sistema = String(b.referencia.sistema);
    const refId = String(b.referencia.id).trim();
    const ref = { sistema, id: refId, titulo: String(b.referencia.titulo || '').trim() || null, link: b.referencia.link || null };

    const mesma = repo.conversaAbertaDoChamado(this.db, app.aplicacaoId, sistema, refId);
    if (mesma) return { cv: repo.buscarConversa(this.db, app.empresaId, mesma.id), resultado: 'existente', mensagem_inicial: null };

    const r = this.db.transaction(() => {
      const contato = repo.acharOuCriarContato(this.db, app.empresaId, b.contato.telefone, { nome: b.contato.nome });
      const aberta = repo.conversaAbertaDoContato(this.db, canal.id, contato.id);
      const resultado = aberta ? 'vinculada' : 'criada';
      const id = aberta ? aberta.id : repo.criarConversa(this.db, { empresaId: app.empresaId, canalId: canal.id, contatoId: contato.id, setorId: setor.id });
      repo.ligarReferencia(this.db, id, app.aplicacaoId, ref);
      const itens = [repo.adicionarItem(this.db, id, { categoria: 'evento', autor: SISTEMA, texto: aberta
        ? `Chamado ${sistema} #${refId} vinculado pelo ${app.nome}.` : `Conversa aberta pelo ${app.nome} (chamado ${sistema} #${refId}) no setor ${setor.nome}.` })];
      if (b.prioridade === 'alta') repo.atualizarConversa(this.db, id, { prioridade: 'alta' });
      const contexto = String(b.contexto || '').trim();
      if (contexto) itens.push(repo.adicionarItem(this.db, id, { categoria: 'nota', autor: { tipo: 'sistema', id: null, nome: app.nome }, texto: contexto }));
      const cv = repo.buscarConversa(this.db, app.empresaId, id);
      repo.registrarRetornos(this.db, cv, `conversa.${resultado}`, { setor: { codigo: cv.setor_codigo, nome: cv.setor_nome }, na_fila: !cv.responsavel_id, referencia: { sistema, id: refId } });
      return { cv, resultado, itens };
    })();
    for (const it of r.itens) this.aoItem(r.cv.id, repo.paraItem(it));

    // Mensagem inicial: opcional, só em conversa nova, respeitando as regras do canal.
    let inicial = null;
    if (b.mensagem_inicial !== undefined) {
      const bloqueio = r.resultado === 'criada' ? this.bloqueioDoCanal(r.cv) : { motivo: 'O contato já estava em atendimento; a mensagem inicial não foi enviada.' };
      if (bloqueio) inicial = { estado: 'nao_enviada', motivo: bloqueio.motivo, item_id: null };
      else {
        const it = this._enviar(r.cv, String(b.mensagem_inicial).trim(), { autor: { tipo: 'sistema', id: null, nome: app.nome }, origem: 'api', aplicacaoId: app.aplicacaoId });
        inicial = { estado: 'aceita', motivo: null, item_id: it.id };
      }
    }
    const cv = repo.buscarConversa(this.db, app.empresaId, r.cv.id);
    // Sem mensagem inicial, a pessoa autorizada no IA Command responderia ao assistente: marca o atendimento.
    if (!inicial || inicial.estado !== 'aceita') this.sincronizacao = this._marcarNoIaCommand(cv);
    this._avisar(cv);
    return { cv, resultado: r.resultado, mensagem_inicial: inicial };
  }
}

module.exports = { Atendimento, validarHorario, validarForaHorario };
