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
    relogio: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    todos: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  };

  // socketAuth: autenticação alternativa do tempo real (Monitor de Acessos usa
  // a sessão do IAHub: { iahub: true, empresaId }). Sem ela, o token do J2A.
  function mount({ anchor, getToken, request, ext, socketAuth = null, onSessaoEncerrada = () => {} }) {
    const st = {
      ativo: false, aberto: false, view: 'lista', busca: '',
      contatos: [], naoLidasTotal: 0, destinatariosTransmissao: 0,
      conversa: null, socket: null, timer: null, enviando: false,
      edicao: null, alterando: false,
      selecao: null, ocultas: new Map(), pedidoContatos: 0,
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
    const foiOcultada = (m) => {
      const o = st.ocultas.get(m.conversaId);
      return !!o && (o.ids.has(m.id) || (m.sequencia != null && m.sequencia <= o.ateSequencia));
    };

    function atualizarContador() {
      const n = st.contatos.reduce((s, c) => s + (c.naoLidas || 0), 0);
      st.naoLidasTotal = n;
      const badge = botao.querySelector('.ci-badge');
      badge.hidden = n === 0;
      badge.textContent = n > 99 ? '99+' : String(n);
      document.title = n ? `(${n}) ${st.tituloBase}` : st.tituloBase;
    }

    async function carregarContatos() {
      const pedido = ++st.pedidoContatos;
      const r = await request(api('/contatos'));
      if (pedido !== st.pedidoContatos) return r;
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
          ${lista.length ? lista.map((c) => c.semAcesso ? `
            <div class="ci-contato ci-sem-acesso" role="listitem" title="Este analista não tem acesso ao J2A (número não autorizado na Platform) e não recebe mensagens.">
              <span class="ci-avatar" style="background:${cor(c.tecnicoId)}">${esc(iniciais(c.nome))}</span>
              <span class="ci-contato-meio">
                <span class="ci-contato-nome">${esc(c.nome)}</span>
                <span class="ci-contato-sub">Sem acesso ao J2A · ${c.chamadosEmAndamento} chamado(s)</span>
              </span>
            </div>` : `
            <button type="button" class="ci-contato" role="listitem" data-ci-contato="${esc(c.consultorId)}">
              ${avatar(c)}
              <span class="ci-contato-meio">
                <span class="ci-contato-nome">${esc(c.nome)}${c.eu ? '' : ` <small class="ci-st ${c.online ? 'ci-st-on' : ''}">${c.online ? 'On Line' : 'Off Line'}</small>`}</span>
                <span class="ci-contato-sub">${c.ultimaMensagem
                  ? `${c.ultimaMensagem.minha ? 'Você: ' : ''}${esc(c.ultimaMensagem.texto)}`
                  : c.eu ? 'Anotações e lembretes só seus' : (c.chamadosEmAndamento ? `${c.chamadosEmAndamento} chamado(s) em andamento` : (c.online ? 'On Line agora' : 'Sem conversa ainda'))}</span>
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
      if (m.pendente) return `<span class="ci-tick ci-pendente" title="Enviando…" aria-label="Enviando">${ICONES.relogio}</span>`;
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
        return `${sep}<div class="ci-msg ${m.minha ? 'ci-minha' : 'ci-dele'}${m.pendente ? ' ci-enviando' : ''}" data-msg="${esc(m.id)}">
          ${st.selecao ? `<label class="ci-marcar"><input type="checkbox" data-ci-selecionar="${esc(m.id)}" aria-label="Selecionar mensagem: ${esc(m.texto.slice(0, 70))}" ${st.selecao.has(m.id) ? 'checked' : ''}> Selecionar</label>` : ''}
          ${m.transmissao ? '<span class="ci-transm">Mensagem para todos</span>' : ''}
          <span class="ci-texto${m.apagadoEm ? ' ci-apagada' : ''}">${esc(m.apagadoEm ? 'Mensagem apagada' : m.texto)}</span>
          <span class="ci-meta">${m.editadoEm && !m.apagadoEm ? '<span>editada</span>' : ''}${hora(m.criadoEm)}${m.apagadoEm ? '' : ticks(m)}</span>
          ${!st.selecao && !m.pendente ? `<details class="ci-acoes-msg"><summary aria-label="Opções da mensagem">Opções</summary><div>
            ${m.minha && !m.apagadoEm ? `<button type="button" data-ci="editar" data-ci-msg="${esc(m.id)}">Editar</button>
            <button type="button" data-ci="apagar" data-ci-msg="${esc(m.id)}">Apagar para todos</button>` : ''}
            <button type="button" data-ci="apagar-mim" data-ci-msg="${esc(m.id)}">Apagar para mim</button>
            <button type="button" data-ci="selecionar" data-ci-msg="${esc(m.id)}">Selecionar</button>
          </div></details>` : ''}</div>`;
      }).join('') || '<p class="ci-vazio">Nenhuma mensagem ainda. Diga olá 👋</p>';
    }

    function renderSelecao() {
      if (!st.selecao) return '';
      const selecionadas = st.conversa.mensagens.filter((m) => st.selecao.has(m.id));
      const podeTodos = selecionadas.length > 0 && selecionadas.every((m) => m.minha && !m.apagadoEm);
      return `<div class="ci-selecao">
        <div><strong role="status">${selecionadas.length} selecionada(s)</strong><button type="button" class="ci-link" data-ci="cancelar-selecao">Cancelar seleção</button></div>
        <button type="button" class="ci-link" data-ci="selecionar-exibidas">${st.conversa.mensagens.length && selecionadas.length === st.conversa.mensagens.length ? 'Desmarcar todas' : 'Marcar todas exibidas'}</button>
        <div><button type="button" data-ci="excluir-selecao-mim" ${!selecionadas.length || st.alterando ? 'disabled' : ''}>Apagar para mim</button>
        <button type="button" data-ci="excluir-selecao-todos" title="Disponível quando todas as selecionadas foram enviadas por você e ainda não foram apagadas" ${!podeTodos || st.alterando ? 'disabled' : ''}>Apagar para todos</button></div>
      </div>`;
    }

    function renderConversa() {
      const c = contato(st.conversa.consultorId) || { consultorId: st.conversa.consultorId, nome: st.conversa.nome };
      // Conversa consigo mesmo (2026-10-28): sem status de presença.
      const status = c.eu ? 'Só você vê estas mensagens' : c.online ? 'On Line' : 'Off Line · recebe quando entrar no J2A';
      return `
        <header class="ci-head">
          <button type="button" class="ci-icone" data-ci="voltar" title="Voltar" aria-label="Voltar">${ICONES.voltar}</button>
          ${avatar(c, true)}
          <span class="ci-head-nome"><strong>${esc(c.nome)}</strong><small>${esc(status)}</small></span>
          <details class="ci-menu-conversa"><summary aria-label="Opções da conversa" title="Opções da conversa">⋮</summary><div>
            <button type="button" data-ci="selecionar">Selecionar mensagens</button>
            <button type="button" data-ci="limpar-conversa">Limpar conversa (apagar tudo para mim)</button>
          </div></details>
          <button type="button" class="ci-icone" data-ci="fechar" title="Fechar" aria-label="Fechar">${ICONES.fechar}</button></header>
        <div id="ci-selecao">${renderSelecao()}</div>
        <div class="ci-msgs" id="ci-msgs">${renderMensagens()}</div>
        ${st.edicao ? `<form id="ci-form-editar" class="ci-edicao">
          <label for="ci-editar-texto">Editar mensagem${st.edicao.transmissao ? ' nesta conversa' : ''}</label>
          <textarea id="ci-editar-texto" rows="3" maxlength="1000" required>${esc(st.edicao.texto)}</textarea>
          <div><button type="button" class="ci-link" data-ci="cancelar-edicao">Cancelar</button>
          <button type="submit" class="ci-btn-primario" ${st.alterando ? 'disabled' : ''}>Salvar alteração</button></div>
        </form>` : ''}
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
      atualizarSelecao();
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
      st.edicao = null;
      st.selecao = null;
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
        st.conversa = { id: conversaId, consultorId, nome: r.contato?.nome || c?.nome || 'Analista', mensagens: (r.mensagens || []).filter((m) => !foiOcultada(m)) };
        st.edicao = null;
        st.selecao = null;
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

    // Envio como no WhatsApp (2026-10-28): o balão aparece na hora com o
    // relógio ("Enviando…") e o campo é limpo; com a resposta do servidor o
    // relógio vira ✓. Falhou: o balão sai, o texto volta para o campo.
    async function enviar() {
      const ta = painel.querySelector('#ci-texto');
      const texto = ta.value.trim();
      if (!texto || st.enviando || !st.conversa) return;
      st.enviando = true;
      const conversa = st.conversa;
      const temp = { id: `tmp-${Date.now()}`, conversaId: conversa.id, minha: true, pendente: true, texto, criadoEm: new Date().toISOString() };
      ta.value = '';
      st.rascunho = '';
      ajustarAltura(ta);
      conversa.mensagens.push(temp);
      atualizarMensagensSemPerderTexto();
      const box = painel.querySelector('#ci-msgs');
      if (box) box.scrollTop = box.scrollHeight;
      const tirarTemp = () => { conversa.mensagens = conversa.mensagens.filter((x) => x.id !== temp.id); };
      try {
        const m = await request(api(`/conversas/${encodeURIComponent(conversa.id)}/mensagens`), { method: 'POST', body: JSON.stringify({ texto }) });
        // O tempo real pode ter entregue a mesma mensagem antes desta resposta.
        if (conversa.mensagens.some((x) => x.id === m.id)) tirarTemp();
        else conversa.mensagens[conversa.mensagens.findIndex((x) => x.id === temp.id)] = m;
        atualizarMensagensSemPerderTexto();
        const c = contato(conversa.consultorId);
        if (c) c.ultimaMensagem = { texto: m.texto.slice(0, 140), em: m.criadoEm, minha: true };
      } catch (err) {
        tirarTemp();
        atualizarMensagensSemPerderTexto();
        const campo = painel.querySelector('#ci-texto');
        if (campo && !campo.value) { campo.value = texto; st.rascunho = texto; ajustarAltura(campo); }
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

    function iniciarEdicao(id) {
      if (st.alterando) return;
      const m = st.conversa?.mensagens.find((x) => x.id === id);
      if (!m?.minha || m.apagadoEm) return;
      st.edicao = { id: m.id, texto: m.texto, transmissao: m.transmissao };
      render();
      painel.querySelector('#ci-editar-texto')?.focus();
    }

    function atualizarSelecao() {
      if (st.selecao && st.conversa) {
        const visiveis = new Set(st.conversa.mensagens.map((m) => m.id));
        for (const id of st.selecao) if (!visiveis.has(id)) st.selecao.delete(id);
      }
      const barra = painel.querySelector('#ci-selecao');
      if (barra) barra.innerHTML = renderSelecao();
    }

    function selecionar(id) {
      if (!st.conversa || st.alterando) return;
      st.edicao = null;
      st.selecao = new Set(id ? [id] : []);
      render();
      painel.querySelector('[data-ci-selecionar]')?.focus();
    }

    async function excluirMensagens(modo, mensagemIds = [...(st.selecao || [])], todas = false) {
      const conversa = st.conversa;
      if (!conversa || st.alterando || (!todas && !mensagemIds.length)) return;
      const pergunta = todas
        ? 'Apagar todo o histórico desta conversa somente para você, incluindo mensagens antigas? O outro participante continuará com o histórico dele.'
        : modo === 'mim' ? `Apagar ${mensagemIds.length} mensagem(ns) somente para você? O outro participante continuará vendo essas mensagens.`
          : `Apagar ${mensagemIds.length} mensagem(ns) para todos nesta conversa? O conteúdo será substituído por "Mensagem apagada".`;
      if (!window.confirm(pergunta)) return;
      st.alterando = true;
      atualizarSelecao();
      try {
        const resultado = await request(api(`/conversas/${encodeURIComponent(conversa.id)}/excluir-mensagens`), {
          method: 'POST', body: JSON.stringify({ modo, ...(todas ? { todas: true } : { mensagemIds }) }),
        });
        if (modo === 'mim') receberExclusaoPessoal(resultado);
        else (resultado.mensagens || []).forEach(receberAlteracao);
        if (st.conversa === conversa) { st.selecao = null; render(); }
      } catch (err) {
        aviso(`Não foi possível apagar: ${err.message}`);
      } finally {
        st.alterando = false;
        atualizarSelecao();
      }
    }

    function receberExclusaoPessoal(r) {
      if (!st.ativo) return;
      const o = st.ocultas.get(r.conversaId) || { ids: new Set(), ateSequencia: 0 };
      (r.mensagemIds || []).forEach((id) => o.ids.add(id));
      o.ateSequencia = Math.max(o.ateSequencia, r.ateSequencia || 0);
      st.ocultas.set(r.conversaId, o);
      if (st.conversa?.id === r.conversaId) {
        st.conversa.mensagens = st.conversa.mensagens.filter((m) => !foiOcultada(m));
        if (st.edicao && !st.conversa.mensagens.some((m) => m.id === st.edicao.id)) {
          st.edicao = null;
          render();
        }
        atualizarMensagensSemPerderTexto();
      }
      pilha.querySelectorAll('.ci-toast-msg').forEach((el) => {
        if (el.classList.contains('ci-toast-resumo') || foiOcultada({ id: el.dataset.mensagemId, conversaId: el.dataset.conversaId, sequencia: el.dataset.sequencia ? Number(el.dataset.sequencia) : undefined })) el.remove();
      });
      carregarContatos().catch(() => null);
    }

    async function alterarMensagem(apagar = false, id = st.edicao?.id) {
      const conversa = st.conversa;
      const m = conversa?.mensagens.find((x) => x.id === id);
      if (!m?.minha || m.apagadoEm || st.alterando) return;
      const texto = st.edicao?.texto.trim();
      if (!apagar && !texto) return aviso('A mensagem está vazia.');
      if (apagar && !window.confirm('Apagar esta mensagem para todos nesta conversa? Esta ação não pode ser desfeita.')) return;
      st.alterando = true;
      const btn = painel.querySelector('#ci-form-editar button[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        const alterada = await request(api(`/conversas/${encodeURIComponent(conversa.id)}/mensagens/${encodeURIComponent(id)}`), {
          method: apagar ? 'DELETE' : 'PATCH',
          ...(!apagar ? { body: JSON.stringify({ texto }) } : {}),
        });
        if (st.conversa === conversa && st.edicao?.id === id) {
          st.edicao = null;
          render();
        }
        receberAlteracao(alterada);
      } catch (err) {
        aviso(`Não foi possível ${apagar ? 'apagar' : 'editar'}: ${err.message}`);
      } finally {
        st.alterando = false;
        const salvar = painel.querySelector('#ci-form-editar button[type="submit"]');
        if (salvar) salvar.disabled = false;
      }
    }

    function receberAlteracao(m) {
      if (foiOcultada(m)) return;
      if (st.conversa?.id === m.conversaId) {
        const atual = st.conversa.mensagens.find((x) => x.id === m.id);
        // Uma resposta HTTP atrasada não pode reexibir texto já apagado nem
        // substituir uma edição mais recente recebida pelo socket.
        if (atual && !(atual.apagadoEm && !m.apagadoEm)
          && !(!m.apagadoEm && atual.editadoEm && (!m.editadoEm || atual.editadoEm > m.editadoEm))) {
          Object.assign(atual, m);
        }
        if (m.apagadoEm && st.edicao?.id === m.id) {
          st.edicao = null;
          render();
        }
        atualizarMensagensSemPerderTexto();
      }
      // Uma alteração não é mensagem nova: sem balão ou incremento de não lidas.
      pilha.querySelectorAll('.ci-toast-msg').forEach((el) => {
        if (el.dataset.mensagemId !== m.id) return;
        if (m.apagadoEm) el.remove();
        else el.querySelector('.ci-toast-texto').textContent = m.texto;
      });
      carregarContatos().catch(() => null);
    }

    function adicionarNaConversa(m) {
      if (foiOcultada(m)) return false;
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
      el.dataset.mensagemId = m.id || '';
      el.dataset.conversaId = m.conversaId;
      el.dataset.sequencia = m.sequencia || '';
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

    function resumoNaoLidas(n) {
      const el = document.createElement('div');
      el.className = 'ci-toast ci-toast-msg ci-toast-resumo';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.innerHTML = `<span class="ci-avatar ci-avatar-resumo">${ICONES.chat}</span>
        <span class="ci-toast-corpo"><span class="ci-toast-topo"><strong>Você tem ${n} mensage${n === 1 ? 'm nova' : 'ns novas'}</strong></span>
          <span class="ci-toast-texto">Recebidas enquanto você estava fora do J2A.</span>
          <span class="ci-toast-acoes"><span class="ci-link">Ver mensagens</span></span></span>
        <button type="button" class="ci-icone ci-toast-x" aria-label="Dispensar">${ICONES.fechar}</button>`;
      const timer = setTimeout(() => el.remove(), 12000);
      el.addEventListener('click', (e) => {
        clearTimeout(timer);
        el.remove();
        if (!e.target.closest('.ci-toast-x')) abrirPainel('lista');
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
      if (foiOcultada(m)) return;
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
    async function sincronizar(forcar = false) {
      if (st.socket?.connected && !forcar) return;
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
        const conversa = st.conversa;
        const r = await request(api(`/conversas/${encodeURIComponent(conversa.id)}/mensagens`)).catch(() => null);
        if (r && st.conversa === conversa) {
          conversa.mensagens = (r.mensagens || []).filter((m) => !foiOcultada(m));
          if (st.edicao && !conversa.mensagens.some((m) => m.id === st.edicao.id && !m.apagadoEm)) {
            st.edicao = null;
            render();
          }
          atualizarMensagensSemPerderTexto();
        }
      }
    }

    function conectarSocket() {
      if (typeof window.io !== 'function') return;
      const socket = window.io('/ia-service-chat', { auth: socketAuth ? socketAuth() : { token: getToken() }, transports: ['websocket', 'polling'] });
      st.socket = socket;
      socket.on('connect', () => {
        sincronizar(true).catch(() => null);
        request(api('/entregues'), { method: 'POST', body: JSON.stringify({}) }).catch(() => null);
      });
      socket.on('chat:mensagem', (m) => { receber(m).catch(() => null); });
      socket.on('chat:mensagem-alterada', receberAlteracao);
      socket.on('chat:mensagens-ocultas', receberExclusaoPessoal);
      socket.on('chat:recibo', receberRecibo);
      // Derrubado pelo Monitor de Acessos: volta para o login na hora.
      socket.on('sessao:encerrada', (p) => onSessaoEncerrada(p?.mensagem || 'Sua sessão foi encerrada pelo administrador.'));
      socket.on('connect_error', (err) => { if (err?.message === 'nao_autorizado') socket.disconnect(); });
    }

    // ── Eventos ────────────────────────────────────────────────────────
    botao.addEventListener('click', () => (st.aberto ? fecharPainel() : abrirPainel('lista')));
    painel.addEventListener('click', (e) => {
      const acao = e.target.closest('[data-ci]')?.dataset.ci;
      if (acao === 'fechar') return fecharPainel();
      if (acao === 'voltar') { st.view = 'lista'; st.conversa = null; st.edicao = null; st.selecao = null; st.rascunho = ''; render(); return carregarContatos().catch(() => null); }
      if (acao === 'editar') return iniciarEdicao(e.target.closest('[data-ci-msg]').dataset.ciMsg);
      if (acao === 'apagar') return alterarMensagem(true, e.target.closest('[data-ci-msg]').dataset.ciMsg);
      if (acao === 'apagar-mim') return excluirMensagens('mim', [e.target.closest('[data-ci-msg]').dataset.ciMsg]);
      if (acao === 'limpar-conversa') return excluirMensagens('mim', [], true);
      if (acao === 'selecionar') return selecionar(e.target.closest('[data-ci-msg]')?.dataset.ciMsg);
      if (acao === 'cancelar-selecao') { st.selecao = null; render(); return; }
      if (acao === 'selecionar-exibidas') {
        st.selecao = new Set(st.selecao?.size === st.conversa.mensagens.length ? [] : st.conversa.mensagens.map((m) => m.id));
        render(); return;
      }
      if (acao === 'excluir-selecao-mim') return excluirMensagens('mim');
      if (acao === 'excluir-selecao-todos') return excluirMensagens('todos');
      if (acao === 'cancelar-edicao') { st.edicao = null; render(); return; }
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
      if (e.target.id === 'ci-editar-texto' && st.edicao) st.edicao.texto = e.target.value;
    });
    painel.addEventListener('change', (e) => {
      const id = e.target.dataset.ciSelecionar;
      if (!id || !st.selecao) return;
      if (e.target.checked) st.selecao.add(id); else st.selecao.delete(id);
      atualizarSelecao();
    });
    painel.addEventListener('keydown', (e) => {
      if (e.target.id === 'ci-texto' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
      if (e.key === 'Escape') fecharPainel();
    });
    painel.addEventListener('submit', (e) => {
      e.preventDefault();
      if (e.target.id === 'ci-form') enviar();
      if (e.target.id === 'ci-form-editar') alterarMensagem();
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
        .then((r) => {
          // Chegou mensagem enquanto estava offline: avisa uma vez ao entrar.
          if (r?.naoLidasTotal) resumoNaoLidas(r.naoLidasTotal);
          return request(api('/entregues'), { method: 'POST', body: JSON.stringify({}) });
        })
        .catch(() => null);
      conectarSocket();
      st.timer = setInterval(() => { sincronizar().catch(() => null); }, 30 * 1000);
    }

    function stop() {
      st.ativo = false;
      st.pedidoContatos++;
      st.socket?.disconnect();
      st.socket = null;
      clearInterval(st.timer);
      fecharPainel();
      st.contatos = [];
      st.ocultas.clear();
      pilha.innerHTML = '';
      botao.hidden = true;
      atualizarContador();
    }

    return { start, stop, abrirConversa };
  }

  window.IaChatInterno = { mount };
})();
