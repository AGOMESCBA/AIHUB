// IA Service no celular (2026-10-30): altura visível de verdade em --iasvc-vh
// (ver css/iaservice-mobile.css). 100vh inclui a barra do navegador e ignora o
// teclado, o que escondia o fim da tela e a caixa de digitar mensagem.
(function () {
  const vv = window.visualViewport;
  if (!vv) return;
  function aplicar() {
    if (vv.scale > 1.01) return; // zoom com os dedos não é mudança de tela
    document.documentElement.style.setProperty('--iasvc-vh', `${Math.round(vv.height)}px`);
    // iPhone desloca a página inteira ao abrir o teclado, em vez de encolher.
    if (vv.offsetTop > 0 && window.top === window) window.scrollTo(0, 0);
  }
  vv.addEventListener('resize', aplicar);
  vv.addEventListener('scroll', aplicar);
  aplicar();
})();
