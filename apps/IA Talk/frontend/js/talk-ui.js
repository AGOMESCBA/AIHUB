// IA Talk — utilidades visuais comuns a todas as telas. Sem framework.
//   TalkUI.esc(texto)                          escapa HTML (use SEMPRE ao montar innerHTML)
//   TalkUI.estado(el, 'carregando'|'vazio'|'erro'|'sem_permissao', { titulo, texto, acao })
//   TalkUI.estadoDoErro(el, err, aoTentarDeNovo)   escolhe erro/sem_permissao pelo ErroApi
//   TalkUI.pill(estado)                        HTML do pill de um estado de canal/mensagem/entrega
//   TalkUI.dataHora(iso) / TalkUI.relativo(iso)
//   TalkUI.toast(texto, 'ok'|'erro'|'info')
//   TalkUI.errosNoFormulario(form, err)        marca os campos de err.campos (name="...")
//   TalkUI.limparErros(form)
//   TalkUI.abas(container)                     liga botões [role=tab] aos painéis
(function () {
  // Tema antes de pintar (mesmo mecanismo do IAHub: data-theme="dark" no <html>).
  try { if (localStorage.getItem('talk_tema') === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); } catch (_) { /* sem localStorage */ }

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const ICONES = {
    carregando: '',
    vazio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9"/><path d="M3 15h5l2 3h4l2-3h5v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    erro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
    sem_permissao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  };
  const TEXTOS = {
    carregando: { titulo: 'Carregando…', texto: '' },
    vazio: { titulo: 'Nada por aqui ainda', texto: '' },
    erro: { titulo: 'Não foi possível carregar', texto: 'Confira a conexão e tente de novo.' },
    sem_permissao: { titulo: 'Sem permissão', texto: 'Você não tem acesso a esta rotina. Fale com o administrador da empresa.' },
  };

  // acao: { rotulo, aoClicar }
  function estado(el, tipo, { titulo, texto, acao } = {}) {
    if (!el) return;
    const t = { ...TEXTOS[tipo], ...(titulo !== undefined ? { titulo } : {}), ...(texto !== undefined ? { texto } : {}) };
    el.hidden = false;
    el.innerHTML = `<div class="tlk-estado tlk-estado--${tipo}" role="${tipo === 'erro' ? 'alert' : 'status'}" aria-live="polite">
      ${tipo === 'carregando' ? '<div class="tlk-girando" aria-hidden="true"></div>' : `<div class="tlk-estado-icone" aria-hidden="true">${ICONES[tipo]}</div>`}
      <div class="tlk-estado-titulo">${esc(t.titulo)}</div>
      ${t.texto ? `<div class="tlk-estado-texto">${esc(t.texto)}</div>` : ''}
      ${acao ? `<button class="btn btn-primary" type="button">${esc(acao.rotulo)}</button>` : ''}
    </div>`;
    if (acao) el.querySelector('button').addEventListener('click', acao.aoClicar);
  }

  function estadoDoErro(el, err, aoTentarDeNovo) {
    if (err?.status === 403) return estado(el, 'sem_permissao', { texto: err.message });
    return estado(el, 'erro', { texto: err?.message, acao: aoTentarDeNovo ? { rotulo: 'Tentar de novo', aoClicar: aoTentarDeNovo } : undefined });
  }

  // Vocabulário único de estados → rótulo e cor (docs/contratos.md §Estados).
  const PILLS = {
    // canal
    conectado: ['Conectado', 'ok'], iniciando: ['Iniciando', 'info'], qr_pendente: ['QR pendente', 'aviso'],
    reconectando: ['Reconectando', 'aviso'], desconectado: ['Desconectado', 'erro'], parado: ['Parado', 'neutro'],
    // mensagem
    aceita: ['Aceita', 'neutro'], aguardando: ['Aguardando canal', 'aviso'], encaminhada: ['Encaminhada', 'info'],
    enviada: ['Enviada', 'info'], entregue: ['Entregue', 'ok'], lida: ['Lida', 'ok'], falhou: ['Falhou', 'erro'],
    desconhecida: ['Resultado desconhecido', 'erro'], recebida: ['Recebida', 'info'],
    // entrega de webhook
    pendente: ['Pendente', 'aviso'], falhando: ['Falhando', 'erro'], esgotado: ['Esgotado', 'erro'],
    // cadastro
    ativa: ['Ativa', 'ok'], inativa: ['Inativa', 'neutro'], ativo: ['Ativo', 'ok'], inativo: ['Inativo', 'neutro'],
    erro: ['Erro', 'erro'],
  };
  // 'entregue' aparece em mensagem e em webhook com o mesmo rótulo.
  function pill(valor) {
    const [rotulo, cor] = PILLS[valor] || [valor || '—', 'neutro'];
    return `<span class="tlk-pill tlk-pill--${cor}">${esc(rotulo)}</span>`;
  }

  const FMT_DATA_HORA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dataHora = (iso) => (iso ? FMT_DATA_HORA.format(new Date(iso)) : '—');
  function relativo(iso) {
    if (!iso) return '—';
    const seg = Math.round((Date.now() - Date.parse(iso)) / 1000);
    if (seg < 60) return 'agora';
    if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
    if (seg < 86400) return `há ${Math.floor(seg / 3600)} h`;
    return dataHora(iso);
  }

  function toast(texto, tipo = 'info', duracaoMs = 4200) {
    let caixa = document.querySelector('.tlk-toasts');
    if (!caixa) {
      caixa = document.createElement('div');
      caixa.className = 'tlk-toasts';
      caixa.setAttribute('aria-live', 'polite');
      document.body.appendChild(caixa);
    }
    const t = document.createElement('div');
    t.className = `tlk-toast tlk-toast--${tipo}`;
    t.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    t.textContent = texto;
    caixa.appendChild(t);
    setTimeout(() => t.remove(), duracaoMs);
  }

  function limparErros(form) {
    form.querySelectorAll('.tlk-campo.com-erro').forEach(c => c.classList.remove('com-erro'));
    form.querySelectorAll('.tlk-campo-erro').forEach(e => e.remove());
    form.querySelectorAll('[aria-invalid]').forEach(e => e.removeAttribute('aria-invalid'));
  }

  // Devolve true se marcou algum campo; o primeiro campo com erro recebe foco.
  function errosNoFormulario(form, err) {
    limparErros(form);
    if (!err?.campos) return false;
    let primeiro = null;
    for (const [nome, mensagem] of Object.entries(err.campos)) {
      const campo = form.querySelector(`[name="${CSS.escape(nome)}"]`);
      if (!campo) continue;
      const caixa = campo.closest('.tlk-campo');
      caixa?.classList.add('com-erro');
      campo.setAttribute('aria-invalid', 'true');
      const msg = document.createElement('div');
      msg.className = 'tlk-campo-erro';
      msg.id = `erro-${nome}`;
      msg.textContent = mensagem;
      campo.setAttribute('aria-describedby', msg.id);
      (caixa || campo.parentElement).appendChild(msg);
      primeiro ||= campo;
    }
    primeiro?.focus();
    return !!primeiro;
  }

  function abas(container) {
    const botoes = [...container.querySelectorAll('[role="tab"]')];
    const ativar = (b) => {
      botoes.forEach(x => {
        const sel = x === b;
        x.setAttribute('aria-selected', String(sel));
        x.tabIndex = sel ? 0 : -1;
        document.getElementById(x.getAttribute('aria-controls')).hidden = !sel;
      });
    };
    botoes.forEach((b, i) => {
      b.addEventListener('click', () => ativar(b));
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const prox = botoes[(i + (e.key === 'ArrowRight' ? 1 : botoes.length - 1)) % botoes.length];
        prox.focus();
        ativar(prox);
      });
    });
    if (botoes.length) ativar(botoes.find(b => b.getAttribute('aria-selected') === 'true') || botoes[0]);
  }

  window.TalkUI = { esc, estado, estadoDoErro, pill, dataHora, relativo, toast, errosNoFormulario, limparErros, abas };
})();
