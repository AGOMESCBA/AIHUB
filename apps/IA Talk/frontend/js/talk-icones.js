// IA Talk · Etapa G10 — catálogo único de ícones SVG de linha (16 px).
// Padrão alinhado a shell.html e talk-ui.js: viewBox 0 0 24 24, stroke="currentColor",
// traço 1.9, pontas e junções arredondadas. Sem biblioteca externa nem CDN.
//
// Uso declarativo no HTML:
//   <button ...><span data-ico="atualizar" data-giro="1"></span> Atualizar</button>
// Uso dinâmico em JS:
//   TalkIcones.svg('atualizar', { girar: true })
//   TalkIcones.definirBotao(btn, { icone: 'menos', texto: 'Ocultar agrupamento' })
(function () {
  const PATHS = {
    atualizar: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>',
    restaurar: '<path d="M3 12a9 9 0 1 0 2.64-6.36"/><polyline points="3 3 3 9 9 9"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    menos: '<path d="M5 12h14"/>',
    voltar: '<path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/>',
    avancar: '<path d="M5 12h14"/><polyline points="12 5 19 12 12 19"/>',
    externo: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    play: '<polygon points="6 4 20 12 6 20 6 4"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 20h1M20 14h1"/>',
    lixeira: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    limpar: '<path d="m7 21-4.3-4.3a2 2 0 0 1 0-2.8L13.6 3a2 2 0 0 1 2.8 0l4.9 4.9a2 2 0 0 1 0 2.8L12 21H7z"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
    copiar: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    enviar: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    salvar: '<polyline points="20 6 9 17 4 12"/>',
    cancelar: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    painel_lateral: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/>',
    seta_baixo: '<path d="M12 5v14"/><polyline points="19 12 12 19 5 12"/>',
    pausa: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    filtro: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    agrupar: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/>',
    olho: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    olho_fechado: '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a21.8 21.8 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 5c6.5 0 10 7 10 7a21.8 21.8 0 0 1-3.17 4.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="2" y1="2" x2="22" y2="22"/>',
    chave: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
    alerta: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    ban: '<circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/>',
  };

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

  function injetarEstilo() {
    if (document.getElementById('tlk-icones-css')) return;
    const style = document.createElement('style');
    style.id = 'tlk-icones-css';
    style.textContent = [
      '.tlk-ico{width:16px;height:16px;flex:none;display:inline-block;vertical-align:middle;}',
      '.btn .tlk-ico,.tlk-pass-btn .tlk-ico{pointer-events:none;}',
      '.tlk-pass-btn{display:inline-flex;align-items:center;justify-content:center;}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function svg(nome, { girar = false, classe = '' } = {}) {
    const corpo = PATHS[nome];
    if (!corpo) return '';
    const classes = ['tlk-ico'];
    if (girar) classes.push('tlk-ico-giro');
    if (classe) classes.push(classe);
    return `<svg class="${esc(classes.join(' '))}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
  }

  function aplicar(raiz = document) {
    injetarEstilo();
    const nos = raiz.querySelectorAll('[data-ico]');
    for (const no of nos) {
      const nome = no.getAttribute('data-ico');
      const girar = no.hasAttribute('data-giro') && no.getAttribute('data-giro') !== '0';
      const classe = no.getAttribute('data-ico-classe') || '';
      const html = svg(nome, { girar, classe });
      if (!html) continue;
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      no.replaceWith(tpl.content.firstElementChild);
    }
  }

  function definirBotao(btn, { icone, texto = '', girar = false, direita = false, title, ariaLabel } = {}) {
    if (!btn) return;
    const icoHtml = icone ? svg(icone, { girar }) : '';
    const txtHtml = texto ? `<span>${esc(texto)}</span>` : '';
    btn.innerHTML = direita ? `${txtHtml}${icoHtml}` : `${icoHtml}${txtHtml}`;
    if (title !== undefined) btn.title = title;
    if (ariaLabel !== undefined) btn.setAttribute('aria-label', ariaLabel);
  }

  injetarEstilo();
  aplicar(document);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => aplicar(document), { once: true });
  }

  window.TalkIcones = {
    svg,
    aplicar,
    definirBotao,
    NOMES: Object.keys(PATHS),
  };
})();
