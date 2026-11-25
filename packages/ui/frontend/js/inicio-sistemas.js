(function () {
  const chave = 'inicio-grupos-fechados:' + location.pathname;
  function fechados() {
    try { return new Set(JSON.parse(localStorage.getItem(chave) || '[]')); } catch (_) { return new Set(); }
  }
  function guardar(ids) {
    try { localStorage.setItem(chave, JSON.stringify([...ids])); } catch (_) {}
  }
  function desenhar() {
    const painel = document.getElementById('mdi-empty');
    const nav = document.querySelector('.sidebar-nav');
    if (!painel || !nav) return;
    painel.replaceChildren();
    const estado = fechados();
    const barra = document.createElement('div');
    barra.className = 'inicio-barra';
    const titulo = document.createElement('h1');
    titulo.textContent = 'Início';
    barra.appendChild(titulo);
    const todos = document.createElement('button');
    todos.type = 'button';
    todos.className = 'inicio-todos';
    barra.appendChild(todos);
    painel.appendChild(barra);
    const grupos = [];
    function atualizarTodos() {
      todos.hidden = !grupos.length;
      todos.textContent = grupos.every(g => g.fechado) ? '⇕ Expandir tudo' : '⇳ Recolher tudo';
    }
    let total = 0;
    nav.querySelectorAll('.nav-section-body').forEach(body => {
      const links = [...body.querySelectorAll('a.nav-item')];
      if (!links.length) return;
      total += links.length;
      const section = document.createElement('section');
      section.className = 'inicio-grupo';
      const id = body.id;
      const grupo = { id, fechado: estado.has(id) };
      grupos.push(grupo);
      const heading = document.createElement('button');
      heading.type = 'button';
      heading.className = 'inicio-grupo-cab';
      const cabecalho = body.previousElementSibling;
      heading.textContent = (cabecalho?.querySelector('.nav-icon')?.textContent || '') + ' ' + (cabecalho?.querySelector('.nav-label')?.textContent || '');
      section.appendChild(heading);
      const grid = document.createElement('div');
      grid.className = 'inicio-cards';
      function atualizarGrupo() {
        grid.hidden = grupo.fechado;
        heading.setAttribute('aria-expanded', String(!grupo.fechado));
      }
      heading.addEventListener('click', () => {
        grupo.fechado = !grupo.fechado;
        if (grupo.fechado) estado.add(id); else estado.delete(id);
        guardar(estado);
        atualizarGrupo();
        atualizarTodos();
      });
      atualizarGrupo();
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
    todos.addEventListener('click', () => {
      const recolher = grupos.some(g => !g.fechado);
      grupos.forEach(g => { if (recolher) estado.add(g.id); else estado.delete(g.id); });
      guardar(estado);
      desenhar();
    });
    atualizarTodos();
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
