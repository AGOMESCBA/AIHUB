// Gerencia estado da sidebar (expandida/retraída)
(function () {
  const STORAGE_KEY = 'iahub_sidebar';

  function getSidebar() { return document.getElementById('sidebar'); }

  function apply(collapsed) {
    const sb = getSidebar();
    if (!sb) return;
    if (collapsed) sb.classList.add('collapsed');
    else           sb.classList.remove('collapsed');
  }

  function toggle() {
    const collapsed = !getSidebar().classList.contains('collapsed');
    apply(collapsed);
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  }

  function init() {
    apply(localStorage.getItem(STORAGE_KEY) === '1');

    // Abre submenu que contém a página ativa
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

  // Expõe globalmente
  window.toggleSidebar  = toggle;
  window.toggleSubmenu  = toggleSubmenu;

  document.addEventListener('DOMContentLoaded', init);
})();
