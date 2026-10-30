// A altura do teclado muda a área visual mesmo quando o layout não encolhe.
(() => {
  const viewport = window.visualViewport;
  if (!viewport) return;
  let frame;
  function atualizar() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      // Preserva o zoom por gesto e a navegação por ampliação.
      if (Math.abs(viewport.scale - 1) > 0.01) return;
      const root = document.documentElement.style;
      root.setProperty('--chat-vh', `${viewport.height}px`);
      root.setProperty('--chat-top', `${viewport.offsetTop}px`);
      window.dispatchEvent(new Event('iaservice:viewportchange'));
    });
  }
  viewport.addEventListener('resize', atualizar);
  viewport.addEventListener('scroll', atualizar);
  window.addEventListener('resize', atualizar);
  atualizar();
})();
