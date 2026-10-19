/* Exportação local do conteúdo completo da aba, sem alterar sua visualização. */
(() => {
  'use strict';
  const ASSETS = '/iaservice/j2a/assets/';
  let renderer;

  function loadRenderer() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (!renderer) renderer = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${ASSETS}vendor/html2canvas-1.4.1.min.js`;
      script.onload = () => resolve(window.html2canvas);
      script.onerror = () => {
        script.remove();
        renderer = null;
        reject(new Error('Não foi possível carregar a captura. Tente novamente.'));
      };
      document.head.appendChild(script);
    });
    return renderer;
  }

  function snapshot({ element, title, context, prepare }) {
    if (!element) throw new Error('Abra uma aba para exportar seu conteúdo.');
    const host = document.createElement('div');
    host.className = 'ia-export-snapshot';
    host.style.cssText = 'position:absolute;left:-100000px;top:0;padding:20px;box-sizing:border-box;';
    const base = getComputedStyle(element);
    host.style.background = base.getPropertyValue('--panel') || base.getPropertyValue('--wa-bg') || '#fff';
    host.style.color = base.color;
    host.style.font = base.font;
    host.style.width = `${Math.max(360, element.clientWidth)}px`;
    const heading = document.createElement('h2');
    heading.textContent = title || 'Chamados';
    heading.style.cssText = 'margin:0 0 8px;font:700 18px/1.4 sans-serif;';
    host.append(heading);
    if (context) {
      const subtitle = document.createElement('p');
      subtitle.textContent = context;
      subtitle.style.cssText = 'margin:0 0 16px;font:13px/1.5 sans-serif;';
      host.append(subtitle);
    }
    const clone = element.cloneNode(true);
    const sources = [element, ...element.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    // Copiar estilos computados mantém temas e formatação fora dos pais com altura fixa.
    sources.forEach((source, index) => {
      const copy = copies[index];
      const style = getComputedStyle(source);
      for (const property of style) copy.style.setProperty(property, style.getPropertyValue(property));
      copy.removeAttribute('id');
      copy.removeAttribute('onclick');
      const trailBody = source.matches('.trail-execution-body, .trail-step-details');
      if (trailBody) {
        copy.hidden = false;
        copy.style.display = source.matches('.trail-step-details') ? 'grid' : 'block';
      }
      if (index === 0 || trailBody || /(auto|scroll|hidden)/.test(`${style.overflowY} ${style.overflowX}`)) {
        copy.style.height = 'auto';
        copy.style.maxHeight = 'none';
        copy.style.minHeight = '0';
        copy.style.overflow = 'visible';
        copy.style.flex = 'none';
      }
      if (['sticky', 'fixed'].includes(style.position)) copy.style.position = 'static';
    });
    clone.style.display = 'block';
    clone.style.width = '100%';
    clone.style.gridTemplateRows = 'none';
    clone.querySelectorAll('.composer, .chat-vazio, .chat-status-row, .typing-row, script, textarea, input, select, .subtabs, .pesquisa-tabs, .risk-toolbar, .risco-filtros, .risco-grid-busca, .risco-consultores').forEach(node => node.remove());
    clone.querySelectorAll('button').forEach(button => {
      if (button.closest('table')) {
        const text = document.createElement('span');
        text.textContent = button.textContent;
        button.replaceWith(text);
      } else if (!button.matches('.trail-execution-head, .trail-step-head')) button.remove();
    });
    if (prepare) prepare(clone);
    host.append(clone);
    document.body.append(host);
    // Alargar a captura para incluir tabelas e código além da rolagem horizontal.
    host.style.width = `${Math.max(host.offsetWidth, host.scrollWidth + 40)}px`;
    return host;
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); return; } catch (_) { /* fallback */ }
    }
    const field = document.createElement('textarea');
    field.value = text;
    field.style.cssText = 'position:fixed;left:-10000px;top:0';
    document.body.append(field);
    const active = document.activeElement;
    field.select();
    try {
      if (!document.execCommand('copy')) throw new Error('Não foi possível copiar. Verifique a permissão do navegador.');
    } finally { field.remove(); active?.focus(); }
  }

  async function saveImages(host, title, report) {
    const capture = await loadRenderer();
    await document.fonts?.ready;
    const width = Math.ceil(host.getBoundingClientRect().width);
    const height = Math.ceil(host.scrollHeight);
    // Dividir conteúdos longos evita PNG vazio ou truncado por limites do canvas.
    const scale = Math.min(2, 16000 / width);
    const pageHeight = Math.max(1, Math.floor(Math.min(8000, 4000000 / (width * scale * scale))));
    const pages = Math.ceil(height / pageHeight);
    const name = (title || 'Chamados').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    for (let page = 0; page < pages; page++) {
      report(`Gerando imagem ${page + 1} de ${pages}…`);
      const canvas = await capture(host, {
        logging: false, scale, backgroundColor: getComputedStyle(host).backgroundColor,
        width, height: Math.min(pageHeight, height - page * pageHeight),
        y: page * pageHeight, scrollX: 0, scrollY: 0,
        windowWidth: Math.max(document.documentElement.clientWidth, width),
        useCORS: true,
      });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      canvas.width = canvas.height = 0;
      if (!blob) throw new Error('Não foi possível gerar a imagem. Use Copiar conteúdo.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ia-service-${name}${pages > 1 ? `-${page + 1}-de-${pages}` : ''}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    report(pages > 1 ? `${pages} imagens geradas. Permita downloads múltiplos se solicitado pelo navegador.` : 'Imagem gerada.');
  }

  // Ícones no mesmo tamanho do símbolo SoftExpert (19x17), nas cores da marca.
  const ICONE_COPIAR = '<span class="ia-export-icon"><svg viewBox="0 0 24 22" width="19" height="17" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="8" y="6" width="13" height="15" rx="2" stroke="#0075FF"/><path d="M5 16H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="#002080"/></svg></span>';
  const ICONE_IMAGEM = '<span class="ia-export-icon"><svg viewBox="0 0 24 22" width="19" height="17" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" stroke="#002080"/><path d="m3 17 5-5 4 4 2-2 7 6" stroke="#002080"/><path d="M18 2v7m-3-3 3 3 3-3" stroke="#0075FF"/></svg></span>';

  // opcoes.itens: botões da tela movidos para o topo do menu (ex.: Registrar
  // retorno no SoftExpert no J2A); opcoes.icones: ícones em Copiar/Salvar.
  function mount(container, getContent, opcoes = {}) {
    if (!container) return;
    if (!document.querySelector('link[data-ia-export-style]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = `${ASSETS}tab-export.css`;
      style.dataset.iaExportStyle = 'true';
      document.head.append(style);
    }
    const menu = document.createElement('div');
    menu.className = 'ia-export-menu';
    menu.innerHTML = `<button type="button" class="ia-export-trigger" title="Copiar ou salvar conteúdo da aba" aria-label="Exportar conteúdo da aba" aria-expanded="false">⋯</button>
      <div class="ia-export-options${opcoes.icones ? ' com-icones' : ''}" hidden>
        ${opcoes.icones
          ? `<button type="button" class="ia-export-item" role="menuitem" data-export="copy">${ICONE_COPIAR}<span>Copiar conteúdo</span></button>
        <button type="button" class="ia-export-item" role="menuitem" data-export="image">${ICONE_IMAGEM}<span>Salvar conteúdo como imagem</span></button>`
          : `<button type="button" data-export="copy">Copiar conteúdo</button>
        <button type="button" data-export="image">Salvar como imagem</button>`}
        <small>Inclui o conteúdo além da rolagem. Conteúdos longos podem gerar várias imagens.</small>
      </div>`;
    const trigger = menu.querySelector('.ia-export-trigger');
    const options = menu.querySelector('.ia-export-options');
    options.prepend(...(opcoes.itens || []).filter(Boolean));
    const status = document.createElement('div');
    status.className = 'ia-export-status';
    status.setAttribute('role', 'status');
    document.body.append(status);
    const report = message => {
      status.textContent = message;
      status.hidden = false;
      clearTimeout(report.timer);
      report.timer = setTimeout(() => { status.hidden = true; }, 6000);
    };
    status.hidden = true;
    const close = () => { options.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
    trigger.addEventListener('click', () => {
      options.hidden = !options.hidden;
      trigger.setAttribute('aria-expanded', String(!options.hidden));
      // Abre para o lado em que cabe (no celular o ⋯ fica à esquerda da tela).
      options.style.left = options.style.right = '';
      if (!options.hidden && options.getBoundingClientRect().left < 8) { options.style.left = '0'; options.style.right = 'auto'; }
      if (!options.hidden) options.querySelector('button:not(:disabled):not([hidden])')?.focus();
    });
    document.addEventListener('click', event => { if (!menu.contains(event.target)) close(); });
    menu.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); trigger.focus(); } });
    options.addEventListener('click', async event => {
      // Item da tela: a própria tela trata o clique; o menu só fecha.
      if (event.target.closest('[data-export-item]')) { close(); return; }
      const action = event.target.closest('[data-export]');
      if (!action || trigger.disabled) return;
      close();
      trigger.disabled = true;
      let host;
      try {
        const content = getContent();
        host = snapshot(content);
        if (action.dataset.export === 'copy') {
          await copyText(host.innerText.trim());
          report('Conteúdo completo da aba copiado.');
        } else await saveImages(host, content.title, report);
      } catch (error) { report(error.message || 'Não foi possível exportar a aba.'); }
      finally { host?.remove(); trigger.disabled = false; trigger.focus(); }
    });
    container.append(menu);
  }
  window.IaTabExport = { mount };
})();
