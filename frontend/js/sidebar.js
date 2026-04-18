(function () {
  const STORAGE_KEY = 'iahub_sidebar_pinned';

  function getSidebar() { return document.getElementById('sidebar'); }

  function apply(pinned) {
    const sb = getSidebar();
    if (!sb) return;
    sb.classList.toggle('pinned', pinned);
  }

  function toggle() {
    const sb = getSidebar();
    if (!sb) return;
    const pinned = !sb.classList.contains('pinned');
    apply(pinned);
    localStorage.setItem(STORAGE_KEY, pinned ? '1' : '0');
  }

  function init() {
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
