(function () {
  function desenhar() {
    const painel = document.getElementById('mdi-empty');
    const nav = document.querySelector('.sidebar-nav');
    if (!painel || !nav) return;
    painel.replaceChildren();
    const titulo = document.createElement('h1');
    titulo.textContent = 'Início';
    painel.appendChild(titulo);
    let total = 0;
    nav.querySelectorAll('.nav-section-body').forEach(body => {
      const links = [...body.querySelectorAll('a.nav-item')];
      if (!links.length) return;
      total += links.length;
      const section = document.createElement('section');
      section.className = 'inicio-grupo';
      const heading = document.createElement('h2');
      const cabecalho = body.previousElementSibling;
      heading.textContent = (cabecalho?.querySelector('.nav-icon')?.textContent || '') + ' ' + (cabecalho?.querySelector('.nav-label')?.textContent || '');
      section.appendChild(heading);
      const grid = document.createElement('div');
      grid.className = 'inicio-cards';
      links.forEach(link => {
        const card = document.createElement('a');
        card.className = 'inicio-card';
        card.href = link.href;
        if (link.target) { card.target = link.target; card.rel = 'noopener'; }
        const icon = document.createElement('span');
        icon.className = 'inicio-card-icon';
        icon.textContent = link.querySelector('.nav-icon')?.textContent || '';
        const text = document.createElement('span');
        text.className = 'inicio-card-text';
        const nome = document.createElement('strong');
        nome.textContent = link.querySelector('.nav-label')?.textContent || '';
        text.appendChild(nome);
        const submenu = link.closest('.submenu');
        if (submenu) {
          const sub = document.createElement('small');
          sub.textContent = submenu.previousElementSibling?.querySelector('.nav-label')?.textContent || '';
          text.appendChild(sub);
        }
        const arrow = document.createElement('span');
        arrow.textContent = '→';
        arrow.setAttribute('aria-hidden', 'true');
        card.append(icon, text, arrow);
        if (!link.target) card.addEventListener('click', e => { e.preventDefault(); link.click(); });
        grid.appendChild(card);
      });
      section.appendChild(grid);
      painel.appendChild(section);
    });
    if (!total) {
      const vazio = document.createElement('p');
      vazio.textContent = 'Nenhuma rotina disponível. Contate o administrador.';
      painel.appendChild(vazio);
    }
  }
  document.addEventListener('DOMContentLoaded', async () => {
    await (window._iahubRotinasReady || Promise.resolve());
    const nav = document.querySelector('.sidebar-nav');
    if (nav) { new MutationObserver(desenhar).observe(nav, { childList: true }); desenhar(); }
  });
})();
