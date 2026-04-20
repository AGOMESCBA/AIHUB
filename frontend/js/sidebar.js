(function () {
  const STORAGE_KEY = 'iahub_sidebar_pinned';

  function getSidebar() { return document.getElementById('sidebar'); }
  function getLayout()  { return document.querySelector('.layout'); }

  function apply(pinned) {
    const sb = getSidebar();
    if (!sb) return;
    sb.classList.toggle('pinned', pinned);

    const layout = getLayout();
    if (layout) layout.classList.toggle('sidebar-pinned', pinned);

    const btn = sb.querySelector('.sidebar-pin-btn');
    if (btn) {
      btn.textContent = pinned ? '◀' : '▶';
      btn.title       = pinned ? 'Recolher menu' : 'Fixar menu';
    }
  }

  function toggle() {
    const sb = getSidebar();
    if (!sb) return;
    const pinned = !sb.classList.contains('pinned');
    apply(pinned);
    localStorage.setItem(STORAGE_KEY, pinned ? '1' : '0');
  }

  function init() {
    // Injeta botão de pin na área do logo (sem alterar nenhum HTML de página)
    const sb = getSidebar();
    if (sb && !sb.querySelector('.sidebar-pin-btn')) {
      const btn    = document.createElement('button');
      btn.className = 'sidebar-pin-btn';
      btn.onclick   = (e) => { e.stopPropagation(); toggle(); };
      const logo   = sb.querySelector('.sidebar-logo');
      if (logo) logo.appendChild(btn);
    }

    apply(localStorage.getItem(STORAGE_KEY) === '1');

    // Abre o submenu que contém a página ativa
    document.querySelectorAll('.submenu').forEach(sm => {
      if (sm.querySelector('.nav-item.active')) {
        sm.classList.add('open');
        const parent = sm.previousElementSibling;
        if (parent) parent.classList.add('open');
      }
    });
  }

  function toggleSubmenu(id) {
    const sm     = document.getElementById('sub-' + id);
    const parent = sm?.previousElementSibling;
    if (!sm) return;
    const opening = !sm.classList.contains('open');
    sm.classList.toggle('open', opening);
    parent?.classList.toggle('open', opening);
  }

  window.toggleSidebar = toggle;
  window.toggleSubmenu = toggleSubmenu;

  document.addEventListener('DOMContentLoaded', init);
})();
