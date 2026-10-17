// Chat interno do J2A (2026-10, modelo WhatsApp Web): conversa 1 a 1 entre
// analistas logados no chat + "Enviar para todos com chamados em andamento".
// Tempo real via Socket.IO (namespace /ia-service-chat); sem socket, consulta
// a API a cada 30s. Balão no canto inferior direito, "(n)" no título da aba e
// notificação do Windows quando a aba está em segundo plano.
// Todo texto vindo de usuário é inserido escapado (nunca como HTML).
(() => {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const iniciais = (n) => String(n || '?').split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
  function quando(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const hoje = new Date();
    if (d.toDateString() === hoje.toDateString()) return hora(iso);
    const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
    if (d.toDateString() === ontem.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }
  function dia(iso) {
    const d = new Date(iso);
    const hoje = new Date();
    if (d.toDateString() === hoje.toDateString()) return 'Hoje';
    const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
    if (d.toDateString() === ontem.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  }
  function cor(id) {
    const cores = ['#0f766e', '#2563eb', '#7c3aed', '#c2410c', '#15803d', '#be185d', '#4f46e5', '#0891b2'];
    let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return cores[h % cores.length];
  }

  const ICONES = {
    chat: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.9-.9L3 20.5l1.6-4.6A8.4 8.4 0 1 1 21 11.5Z"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    voltar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
    enviar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12.4 2-12.4 2z"/></svg>',
    todos: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  };

  function mount({ anchor, getToken, request, ext }) {
    const st = {
      ativo: false, aberto: false, view: 'lista', busca: '',
      contatos: [], naoLidasTotal: 0, destinatariosTransmissao: 0,
      conversa: null, socket: null, timer: null, enviando: false,
      tituloBase: document.title.replace(/^\(\d+\)\s*/, ''),
    };
    const api = (p) => ext(`/chat-interno${p}`);

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'ci-botao';
    botao.title = 'Mensagens da equipe';
    botao.setAttribute('aria-label', 'Mensagens da equipe');
    botao.innerHTML = `${ICONES.chat}<span class="ci-botao-txt">Mensagens</span><span class="ci-badge" hidden></span>`;
    botao.hidden = true;
    anchor.prepend(botao);

    const painel = document.createElement('aside');
    painel.className = 'ci-painel';
    painel.hidden = true;
    painel.setAttribute('aria-label', 'Chat interno da equipe');
    const pilha = document.createElement('div');
    pilha.className = 'ci-toasts';
    pilha.setAttribute('aria-live', 'polite');
    document.body.append(painel, pilha);

    // ── Estado derivado ────────────────────────────────────────────────
    const contato = (id) => st.contatos.find((c) => c.consultorId === id);
    const contatoDaConversa = (id) => st.contatos.find((c) => c.conversaId === id);

    function atualizarContador() {
      const n = st.contatos.reduce((s, c) => s + (c.naoLidas || 0), 0);
      st.naoLidasTotal = n;
      const badge = botao.querySelector('.ci-badge');
      badge.hidden = n === 0;
      badge.textContent = n > 99 ? '99+' : String(n);
      document.title = n ? `(${n}) ${st.tituloBase}` : st.tituloBase;
    }

    async function carregarContatos() {
      const r = await request(api('/contatos'));
      st.contatos = r.contatos || [];
      st.destinatariosTransmissao = r.destinatariosTransmissao || 0;
      atualizarContador();
      if (st.aberto && st.view === 'lista') render();
      return r;
    }

    // ── Render ─────────────────────────────────────────────────────────
    function avatar(c, grande) {
      return `<span class="ci-avatar${grande ? ' ci-avatar-g' : ''}" style="background:${cor(c.consultorId)}">${esc(iniciais(c.nome))}${c.online ? '<i class="ci-online"></i>' : ''}</span>`;
    }

    function renderLista() {
      const q = st.busca.toLowerCase();
      const lista = st.contatos.filter((c) => !q || c.nome.toLowerCase().includes(q));
      const notif = 'Notification' in window && Notification.permission === 'default'
        ? '<button type="button" class="ci-link" data-ci="notificacoes">Ativar notificações do Windows</button>' : '';
      return `
        <header class="ci-head"><strong>Mensagens</strong>${notif}
          <button type="button" class="ci-icone" data-ci="fechar" title="Fechar" aria-label="Fechar">${ICONES.fechar}</button></header>
        <div class="ci-busca"><input type="search" id="ci-busca" placeholder="Buscar analista..." value="${esc(st.busca)}" aria-label="Buscar analista"></div>
        ${st.destinatariosTransmissao > 0 ? `<button type="button" class="ci-todos" data-ci="todos">${ICONES.todos}<span>Enviar para todos com chamados em andamento</span><b>${st.destinatariosTransmissao}</b></button>` : ''}
        <div class="ci-lista" role="list">
          ${lista.length ? lista.map((c) => `
            <button type="button" class="ci-contato" role="listitem" data-ci-contato="${esc(c.consultorId)}">
              ${avatar(c)}
              <span class="ci-contato-meio">
                <span class="ci-contato-nome">${esc(c.nome)}</span>
                <span class="ci-contato-sub">${c.ultimaMensagem
                  ? `${c.ultimaMensagem.minha ? 'Você: ' : ''}${esc(c.ultimaMensagem.texto)}`
                  : (c.chamadosEmAndamento ? `${c.chamadosEmAndamento} chamado(s) em andamento` : (c.online ? 'Online agora' : 'Sem conversa ainda'))}</span>
              </span>
              <span class="ci-contato-fim">
                <span class="ci-contato-hora${c.naoLidas ? ' ci-novo' : ''}">${c.ultimaMensagem ? quando(c.ultimaMensagem.em) : ''}</span>
                ${c.naoLidas ? `<span class="ci-nl">${c.naoLidas}</span>` : (c.chamadosEmAndamento && c.ultimaMensagem ? `<span class="ci-chip" title="Chamados em andamento">${c.chamadosEmAndamento} em andamento</span>` : '')}
              </span>
            </button>`).join('') : '<p class="ci-vazio">Nenhum analista encontrado.</p>'}
        </div>`;
    }

    function ticks(m) {
      if (!m.minha) return '';
      if (m.vistoEm) return '<span class="ci-tick ci-visto" title="Visto">✓✓</span>';
      if (m.entregueEm) return '<span class="ci-tick" title="Entregue">✓✓</span>';
      return '<span class="ci-tick" title="Enviado">✓</span>';
    }

    function renderMensagens() {
      let ultimoDia = '';
      return st.conversa.mensagens.map((m) => {
        const d = dia(m.criadoEm);
        const sep = d !== ultimoDia ? `<div class="ci-dia"><span>${esc(d)}</span></div>` : '';
        ultimoDia = d;
        return `${sep}<div class="ci-msg ${m.minha ? 'ci-minha' : 'ci-dele'}" data-msg="${esc(m.id)}">
          ${m.transmissao ? '<span class="ci-transm">Mensagem para todos</span>' : ''}
          <span class="ci-texto">${esc(m.texto)}</span>
          <span class="ci-meta">${hora(m.criadoEm)}${ticks(m)}</span></div>`;
      }).join('') || '<p class="ci-vazio">Nenhuma mensagem ainda. Diga olá 👋</p>';
    }

    function renderConversa() {
      const c = contato(st.conversa.consultorId) || { consultorId: st.conversa.consultorId, nome: st.conversa.nome };
      const status = c.online ? 'online' : (c.chamadosEmAndamento ? `${c.chamadosEmAndamento} chamado(s) em andamento` : 'offline');
      return `
        <header class="ci-head">
          <button type="button" class="ci-icone" data-ci="voltar" title="Voltar" aria-label="Voltar">${ICONES.voltar}</button>
          ${avatar(c, true)}
          <span class="ci-head-nome"><strong>${esc(c.nome)}</strong><small>${esc(status)}</small></span>
          <button type="button" class="ci-icone" data-ci="fechar" title="Fechar" aria-label="Fechar">${ICONES.fechar}</button></header>
        <div class="ci-msgs" id="ci-msgs">${renderMensagens()}</div>
        <form class="ci-compor" id="ci-form">
          <textarea id="ci-texto" rows="1" maxlength="1000" placeholder="Digite uma mensagem" aria-label="Mensagem"></textarea>
          <button type="submit" class="ci-enviar" title="Enviar" aria-label="Enviar">${ICONES.enviar}</button>
        </form>`;
    }

    function renderTodos() {
      return `
        <header class="ci-head">
          <button type="button" class="ci-icone" data-ci="voltar" title="Voltar" aria-label="Voltar">${ICONES.voltar}</button>
          <span class="ci-head-nome"><strong>Enviar para todos</strong><small>${st.destinatariosTransmissao} analista(s) com chamados em andamento</small></span>
          <button type="button" class="ci-icone" data-ci="fechar" title="Fechar" aria-label="Fechar">${ICONES.fechar}</button></header>
        <div class="ci-todos-corpo">
          <p>Cada analista recebe a mensagem na conversa com você e pode responder só para você, como numa lista de transmissão do WhatsApp.</p>
          <form id="ci-form-todos" class="ci-todos-form">
            <textarea id="ci-texto-todos" rows="5" maxlength="1000" placeholder="Ex.: Pessoal, priorizem os chamados em atraso hoje." aria-label="Mensagem para todos"></textarea>
            <button type="submit" class="ci-btn-primario">${ICONES.todos} Enviar para ${st.destinatariosTransmissao}</button>
          </form>
        </div>`;
    }

    function render() {
      if (!st.aberto) return;
      painel.innerHTML = st.view === 'conversa' && st.conversa ? renderConversa() : st.view === 'todos' ? renderTodos() : renderLista();
      if (st.view === 'conversa') {
        const box = painel.querySelector('#ci-msgs');
        box.scrollTop = box.scrollHeight;
        const ta = painel.querySelector('#ci-texto');
        if (st.rascunho) ta.value = st.rascunho;
        ajustarAltura(ta);
        ta.focus();
      }
    }

    function atualizarMensagensSemPerderTexto() {
      if (!st.aberto || st.view !== 'conversa') return;
      const box = painel.querySelector('#ci-msgs');
      if (!box) return;
      const noFim = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      box.innerHTML = renderMensagens();
      if (noFim) box.scrollTop = box.scrollHeight;
    }

    function ajustarAltura(ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
    }

    // ── Ações ──────────────────────────────────────────────────────────
    // Com o painel aberto os balões só atrapalham (ficavam por cima da lista).
    const limparBaloes = () => pilha.querySelectorAll('.ci-toast-msg').forEach((el) => el.remove());

    function abrirPainel(view = 'lista') {
      limparBaloes();
      st.aberto = true;
      st.view = view;
      painel.hidden = false;
      botao.setAttribute('aria-expanded', 'true');
      render();
      carregarContatos().catch(() => null);
    }

    function fecharPainel() {
      st.aberto = false;
      st.conversa = null;
      st.rascunho = '';
      painel.hidden = true;
      botao.setAttribute('aria-expanded', 'false');
    }

    async function abrirConversa(consultorId) {
      try {
        let c = contato(consultorId);
        let conversaId = c?.conversaId;
        if (!conversaId) conversaId = (await request(api('/conversas'), { method: 'POST', body: JSON.stringify({ consultorId }) })).conversaId;
        const r = await request(api(`/conversas/${encodeURIComponent(conversaId)}/mensagens`));
        st.conversa = { id: conversaId, consultorId, nome: r.contato?.nome || c?.nome || 'Analista', mensagens: r.mensagens || [] };
        if (c) { c.conversaId = conversaId; c.naoLidas = 0; }
        st.rascunho = '';
        limparBaloes();
        st.aberto = true;
        st.view = 'conversa';
        painel.hidden = false;
        render();
        atualizarContador();
        request(api(`/conversas/${encodeURIComponent(conversaId)}/vistas`), { method: 'POST' }).catch(() => null);
      } catch (err) {
        aviso(`Não foi possível abrir a conversa: ${err.message}`);
      }
    }

    async function enviar() {
      const ta = painel.querySelector('#ci-texto');
      const texto = ta.value.trim();
      if (!texto || st.enviando || !st.conversa) return;
      st.enviando = true;
      try {
        const m = await request(api(`/conversas/${encodeURIComponent(st.conversa.id)}/mensagens`), { method: 'POST', body: JSON.stringify({ texto }) });
        ta.value = '';
        st.rascunho = '';
        ajustarAltura(ta);
        adicionarNaConversa(m);
        const c = contato(st.conversa.consultorId);
        if (c) c.ultimaMensagem = { texto: m.texto.slice(0, 140), em: m.criadoEm, minha: true };
      } catch (err) {
        aviso(`Mensagem não enviada: ${err.message}`);
      } finally {
        st.enviando = false;
      }
    }

    async function enviarTodos() {
      const ta = painel.querySelector('#ci-texto-todos');
      const texto = ta.value.trim();
      if (!texto || st.enviando) return;
      st.enviando = true;
      const btn = painel.querySelector('#ci-form-todos button');
      btn.disabled = true;
      try {
        const r = await request(api('/para-todos'), { method: 'POST', body: JSON.stringify({ texto }) });
        aviso(`Mensagem enviada para ${r.enviados} analista(s).`);
        st.view = 'lista';
        await carregarContatos();
        render();
      } catch (err) {
        aviso(`Não foi possível enviar: ${err.message}`);
        btn.disabled = false;
      } finally {
        st.enviando = false;
      }
    }

    function adicionarNaConversa(m) {
      if (!st.conversa || st.conversa.id !== m.conversaId) return false;
      if (st.conversa.mensagens.some((x) => x.id === m.id)) return true;
      st.conversa.mensagens.push(m);
      atualizarMensagensSemPerderTexto();
      return true;
    }

    // Aviso simples (erros / confirmações) reaproveitando a pilha de balões.
    function aviso(texto) {
      const el = document.createElement('div');
      el.className = 'ci-toast ci-toast-sistema';
      el.textContent = texto;
      pilha.append(el);
      setTimeout(() => el.remove(), 4500);
    }

    function balao(c, m) {
      while (pilha.querySelectorAll('.ci-toast-msg').length >= 3) pilha.querySelector('.ci-toast-msg').remove();
      const el = document.createElement('div');
      el.className = 'ci-toast ci-toast-msg';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.innerHTML = `${avatar(c)}
        <span class="ci-toast-corpo"><span class="ci-toast-topo"><strong>${esc(c.nome)}</strong><small>${hora(m.criadoEm)}</small></span>
          ${m.transmissao ? '<span class="ci-transm">Mensagem para todos</span>' : ''}
          <span class="ci-toast-texto">${esc(m.texto)}</span>
          <span class="ci-toast-acoes"><span class="ci-link">Responder</span>${'Notification' in window && Notification.permission === 'default' ? '<button type="button" class="ci-link" data-ci="notificacoes">Ativar notificações do Windows</button>' : ''}</span></span>
        <button type="button" class="ci-icone ci-toast-x" aria-label="Dispensar">${ICONES.fechar}</button>`;
      let timer = setTimeout(() => el.remove(), 8000);
      el.addEventListener('mouseenter', () => clearTimeout(timer));
      el.addEventListener('mouseleave', () => { timer = setTimeout(() => el.remove(), 4000); });
      el.addEventListener('click', (e) => {
        if (e.target.closest('.ci-toast-x')) return el.remove();
        if (e.target.closest('[data-ci="notificacoes"]')) { pedirNotificacoes(); e.target.remove(); return; }
        el.remove();
        abrirConversa(c.consultorId);
      });
      pilha.append(el);
    }

    function notificarSistema(c, m) {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      try {
        const n = new Notification(`${c.nome} · Chat interno`, { body: m.texto.slice(0, 160), tag: `ci-${m.conversaId}` });
        n.onclick = () => { window.focus(); abrirConversa(c.consultorId); n.close(); };
      } catch (_) { /* navegador sem suporte em página não segura */ }
    }

    function pedirNotificacoes() {
      if (!('Notification' in window)) return;
      Notification.requestPermission().then(() => { if (st.aberto && st.view === 'lista') render(); }).catch(() => null);
    }

    // ── Chegada de mensagem (socket ou sincronização) ──────────────────
    async function receber(m) {
      if (m.minha) {
        adicionarNaConversa(m);
        return;
      }
      st.socket?.emit('chat:entregue', { mensagemIds: [m.id] });
      const vendoAgora = st.aberto && st.view === 'conversa' && st.conversa?.id === m.conversaId && !document.hidden;
      if (vendoAgora) {
        adicionarNaConversa(m);
        request(api(`/conversas/${encodeURIComponent(m.conversaId)}/vistas`), { method: 'POST' }).catch(() => null);
      }
      let c = contato(m.remetenteId);
      // Conversa nova: recarrega do servidor, que já conta esta mensagem como
      // não lida — não somar de novo (contador mostrava 2 para 1 mensagem).
      let recarregou = false;
      if (!c || !c.conversaId) { await carregarContatos().catch(() => null); c = contato(m.remetenteId); recarregou = true; }
      if (!c) return;
      c.conversaId = m.conversaId;
      c.ultimaMensagem = { texto: m.texto.slice(0, 140), em: m.criadoEm, minha: false };
      if (vendoAgora) c.naoLidas = 0;
      else {
        if (!recarregou) c.naoLidas = (c.naoLidas || 0) + 1;
        // Painel aberto: a lista e o contador já mostram a novidade (modelo WhatsApp Web).
        if (!st.aberto || document.hidden) balao(c, m);
        if (document.hidden) notificarSistema(c, m);
      }
      atualizarContador();
      if (st.aberto && st.view === 'lista') render();
    }

    function receberRecibo(r) {
      if (!st.conversa || st.conversa.id !== r.conversaId) return;
      const ids = new Set(r.mensagemIds);
      st.conversa.mensagens.forEach((m) => {
        if (!ids.has(m.id)) return;
        if (r.tipo === 'visto') { m.vistoEm = r.em; m.entregueEm = m.entregueEm || r.em; } else m.entregueEm = m.entregueEm || r.em;
      });
      atualizarMensagensSemPerderTexto();
    }

    // Sem socket: a cada 30s compara as não lidas e avisa o que chegou.
    async function sincronizar() {
      if (st.socket?.connected) return;
      const antes = new Map(st.contatos.map((c) => [c.consultorId, c.naoLidas || 0]));
      await carregarContatos().catch(() => null);
      for (const c of st.contatos) {
        if ((c.naoLidas || 0) > (antes.get(c.consultorId) || 0) && c.ultimaMensagem && !c.ultimaMensagem.minha) {
          const m = { conversaId: c.conversaId, texto: c.ultimaMensagem.texto, criadoEm: c.ultimaMensagem.em, transmissao: false };
          balao(c, m);
          if (document.hidden) notificarSistema(c, m);
        }
      }
      request(api('/entregues'), { method: 'POST', body: JSON.stringify({}) }).catch(() => null);
      if (st.aberto && st.view === 'conversa' && st.conversa) {
        const r = await request(api(`/conversas/${encodeURIComponent(st.conversa.id)}/mensagens`)).catch(() => null);
        if (r) { st.conversa.mensagens = r.mensagens || []; atualizarMensagensSemPerderTexto(); }
      }
    }

    function conectarSocket() {
      if (typeof window.io !== 'function') return;
      const socket = window.io('/ia-service-chat', { auth: { token: getToken() }, transports: ['websocket', 'polling'] });
      st.socket = socket;
      socket.on('connect', () => {
        carregarContatos().catch(() => null);
        request(api('/entregues'), { method: 'POST', body: JSON.stringify({}) }).catch(() => null);
      });
      socket.on('chat:mensagem', (m) => { receber(m).catch(() => null); });
      socket.on('chat:recibo', receberRecibo);
      socket.on('connect_error', (err) => { if (err?.message === 'nao_autorizado') socket.disconnect(); });
    }

    // ── Eventos ────────────────────────────────────────────────────────
    botao.addEventListener('click', () => (st.aberto ? fecharPainel() : abrirPainel('lista')));
    painel.addEventListener('click', (e) => {
      const acao = e.target.closest('[data-ci]')?.dataset.ci;
      if (acao === 'fechar') return fecharPainel();
      if (acao === 'voltar') { st.view = 'lista'; st.conversa = null; st.rascunho = ''; render(); return carregarContatos().catch(() => null); }
      if (acao === 'todos') { st.view = 'todos'; render(); return painel.querySelector('#ci-texto-todos')?.focus(); }
      if (acao === 'notificacoes') return pedirNotificacoes();
      const alvo = e.target.closest('[data-ci-contato]');
      if (alvo) abrirConversa(alvo.dataset.ciContato);
    });
    painel.addEventListener('input', (e) => {
      if (e.target.id === 'ci-busca') {
        st.busca = e.target.value;
        const pos = e.target.selectionStart;
        render();
        const campo = painel.querySelector('#ci-busca');
        campo.focus();
        campo.setSelectionRange(pos, pos);
      }
      if (e.target.id === 'ci-texto') { st.rascunho = e.target.value; ajustarAltura(e.target); }
    });
    painel.addEventListener('keydown', (e) => {
      if (e.target.id === 'ci-texto' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
      if (e.key === 'Escape') fecharPainel();
    });
    painel.addEventListener('submit', (e) => {
      e.preventDefault();
      if (e.target.id === 'ci-form') enviar();
      if (e.target.id === 'ci-form-todos') enviarTodos();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !st.aberto || st.view !== 'conversa' || !st.conversa) return;
      const c = contato(st.conversa.consultorId);
      if (c) c.naoLidas = 0;
      atualizarContador();
      request(api(`/conversas/${encodeURIComponent(st.conversa.id)}/vistas`), { method: 'POST' }).catch(() => null);
    });

    // ── Ciclo de vida (login / Sair) ───────────────────────────────────
    function start() {
      if (st.ativo) stop();
      st.ativo = true;
      botao.hidden = false;
      carregarContatos()
        .then(() => request(api('/entregues'), { method: 'POST', body: JSON.stringify({}) }))
        .catch(() => null);
      conectarSocket();
      st.timer = setInterval(() => { sincronizar().catch(() => null); }, 30 * 1000);
    }

    function stop() {
      st.ativo = false;
      st.socket?.disconnect();
      st.socket = null;
      clearInterval(st.timer);
      fecharPainel();
      st.contatos = [];
      pilha.innerHTML = '';
      botao.hidden = true;
      atualizarContador();
    }

    return { start, stop, abrirConversa };
  }

  window.IaChatInterno = { mount };
})();
