// IA Talk — abas internas do shell (mesmo visual e classes .mdi-* do IA
// Service/IA Command). Versão enxuta: abrir, ativar, fechar, reordenar
// arrastando e lembrar as abas na sessão do navegador. Não há troca de
// empresa por aba: a sessão do Talk já pertence a uma empresa; trocar de
// empresa recarrega todas as abas.
//
// Dentro de uma tela (iframe): window.top.TalkAbas.abrir(url, rotulo, icone)
(function () {
  const CHAVE = 'talk_abas';
  const abas = [];   // { url, rotulo, icone, iframe, botao }
  let ativa = null;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function salvar() {
    try {
      sessionStorage.setItem(CHAVE, JSON.stringify({ abas: abas.map(a => ({ url: a.url, rotulo: a.rotulo, icone: a.icone })), ativa: ativa?.url || null }));
    } catch (_) { /* sem sessionStorage */ }
  }

  function tema(iframe) {
    try {
      const escuro = document.documentElement.getAttribute('data-theme') === 'dark';
      const doc = iframe.contentDocument;
      if (escuro) doc.documentElement.setAttribute('data-theme', 'dark');
      else doc.documentElement.removeAttribute('data-theme');
    } catch (_) { /* outra origem: não ocorre no Talk */ }
  }

  // Sem aba ativa = tela Início (cards do menu, packages/ui/frontend/js/inicio-sistemas.js).
  function atualizarVazio() {
    $('mdi-empty').hidden = !!ativa;
    const tit = $('shell-title');
    if (tit) tit.textContent = ativa ? ativa.rotulo : 'Início';
    document.title = ativa ? `${ativa.rotulo} · IA Talk` : 'IA Talk';
    atualizarRolagem();
  }

  function mostrarInicio() { ativar(null); }

  function ativar(aba) {
    ativa = aba;
    for (const a of abas) {
      const sel = a === aba;
      a.iframe.classList.toggle('active', sel);
      a.botao.classList.toggle('active', sel);
      a.botao.setAttribute('aria-selected', String(sel));
    }
    aba?.botao.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    document.querySelectorAll('#sidebar a.nav-item').forEach(l => l.classList.toggle('active', !!aba && new URL(l.href, location.origin).pathname + new URL(l.href, location.origin).search === aba.url));
    atualizarVazio();
    salvar();
  }

  function fechar(aba) {
    const i = abas.indexOf(aba);
    if (i < 0) return;
    abas.splice(i, 1);
    aba.iframe.remove();
    aba.botao.remove();
    if (ativa === aba) ativar(abas[i] || abas[i - 1] || null);
    else { atualizarVazio(); salvar(); }
  }

  function abrir(url, rotulo, icone = '📄', { ativarAba = true } = {}) {
    const existente = abas.find(a => a.url === url);
    if (existente) { if (ativarAba) ativar(existente); return existente; }

    const iframe = document.createElement('iframe');
    iframe.className = 'mdi-iframe';
    iframe.title = rotulo;
    iframe.src = url;
    iframe.addEventListener('load', () => tema(iframe));
    $('mdi-content').appendChild(iframe);

    const botao = document.createElement('div');
    botao.className = 'mdi-tab';
    botao.setAttribute('role', 'tab');
    botao.tabIndex = 0;
    botao.draggable = true;
    botao.innerHTML = `<span class="mdi-tab-icon" aria-hidden="true">${esc(icone)}</span><span class="mdi-tab-label">${esc(rotulo)}</span>
      <span class="mdi-tab-close" role="button" aria-label="Fechar ${esc(rotulo)}" title="Fechar">×</span>`;
    $('mdi-tabbar').appendChild(botao);

    const aba = { url, rotulo, icone, iframe, botao };
    abas.push(aba);
    botao.addEventListener('click', (e) => { if (e.target.closest('.mdi-tab-close')) fechar(aba); else ativar(aba); });
    botao.addEventListener('auxclick', (e) => { if (e.button === 1) fechar(aba); });
    botao.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ativar(aba); }
      if (e.key === 'Delete') fechar(aba);
    });
    botao.addEventListener('dragstart', () => { botao.classList.add('dragging'); });
    botao.addEventListener('dragend', () => {
      botao.classList.remove('dragging');
      const ordem = [...$('mdi-tabbar').children];
      abas.sort((a, b) => ordem.indexOf(a.botao) - ordem.indexOf(b.botao));
      salvar();
    });
    if (ativarAba) ativar(aba); else { atualizarVazio(); salvar(); }
    return aba;
  }

  function atualizarRolagem() {
    const barra = $('mdi-tabbar');
    const sobra = barra.scrollWidth > barra.clientWidth + 1;
    $('mdi-scroll-left').style.display = sobra ? 'flex' : 'none';
    $('mdi-scroll-right').style.display = sobra ? 'flex' : 'none';
  }

  function iniciar({ inicial } = {}) {
    const barra = $('mdi-tabbar');
    barra.addEventListener('dragover', (e) => {
      e.preventDefault();
      const arrastando = barra.querySelector('.dragging');
      const depois = [...barra.querySelectorAll('.mdi-tab:not(.dragging)')].find(t => e.clientX < t.getBoundingClientRect().left + t.offsetWidth / 2);
      if (arrastando) barra.insertBefore(arrastando, depois || null);
    });
    $('mdi-scroll-left').addEventListener('click', () => barra.scrollBy({ left: -240, behavior: 'smooth' }));
    $('mdi-scroll-right').addEventListener('click', () => barra.scrollBy({ left: 240, behavior: 'smooth' }));
    window.addEventListener('resize', atualizarRolagem);

    // Clique no menu abre aba (em vez de navegar a janela).
    document.getElementById('sidebar').addEventListener('click', (e) => {
      const link = e.target.closest('a.nav-item');
      if (!link) return;
      e.preventDefault();
      const u = new URL(link.href, location.origin);
      abrir(u.pathname + u.search, link.querySelector('.nav-label')?.textContent.trim() || u.pathname, link.querySelector('.nav-icon')?.textContent.trim());
      window.closeSidebarDrawer?.();
    });

    let salvo = null;
    try { salvo = JSON.parse(sessionStorage.getItem(CHAVE) || 'null'); } catch (_) { /* nada salvo */ }
    if (salvo?.abas?.length) {
      salvo.abas.forEach(a => abrir(a.url, a.rotulo, a.icone, { ativarAba: false }));
      ativar(salvo.ativa ? (abas.find(a => a.url === salvo.ativa) || null) : null);
    } else if (inicial) {
      abrir(inicial.url, inicial.rotulo, inicial.icone);
    }
    atualizarVazio();
  }

  function recarregarTodas() { abas.forEach(a => { a.iframe.src = a.url; }); }
  function propagarTema() { abas.forEach(a => tema(a.iframe)); }

  window.mostrarInicio = mostrarInicio; // mesmo nome dos outros produtos
  window.TalkAbas = { iniciar, abrir, mostrarInicio, fechar: (url) => { const a = abas.find(x => x.url === url); if (a) fechar(a); }, recarregarTodas, propagarTema };
})();
