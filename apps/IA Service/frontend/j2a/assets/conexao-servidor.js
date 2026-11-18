/* Aviso comum do IA Service. Somente leituras são repetidas: nunca reenviar
 * mensagens, uploads, exclusões, login ou outras gravações após uma queda.
 * A leitura original recebe a resposta da reconexão e atualiza sua própria UI,
 * sem recarregar a página nem perder campos em edição. */
(function () {
  'use strict';
  if (window.IaServiceConexao || document.currentScript?.hasAttribute('data-conexao-nativa')) return;
  const originalFetch = window.fetch.bind(window);
  const esperas = [5, 10, 20, 30, 60];
  const pendentes = new Map();
  const leiturasAtivas = new Set();
  let falha = null, ultimaOk = null, banner, timer, ocultar, sondando = false;
  let tentativa = 0, proxima = 0;
  const aguardando = new Set();
  const erroIcone = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>';
  const okIcone = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

  function montar() {
    if (banner || !document.body) return;
    banner = document.createElement('section');
    banner.className = 'svc-conn';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML = '<span class="conn-ic" aria-hidden="true"></span><div class="conn-corpo"><div class="conn-titulo"></div><div class="conn-texto"></div><div class="conn-tec"></div></div><div class="conn-acoes"><button class="conn-retry" type="button">Tentar agora</button></div>';
    const container = document.querySelector('.page-content') || document.querySelector('#app') || document.querySelector('.main') || document.querySelector('main') || document.body;
    const cabecalho = container.querySelector(':scope > .page-head');
    if (cabecalho) cabecalho.after(banner); else container.prepend(banner);
    banner.querySelector('button').addEventListener('click', tentarAgora);
    if (falha) renderizar();
  }

  function duracao(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m} min${s % 60 ? ` ${s % 60} s` : ''}` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  function renderizar() {
    montar();
    if (!banner || !falha) return;
    banner.classList.add('mostrar');
    banner.classList.remove('ok');
    document.documentElement.classList.add('svc-sem-conexao');
    banner.querySelector('.conn-ic').innerHTML = erroIcone;
    const offline = navigator.onLine === false;
    banner.querySelector('.conn-titulo').textContent = offline ? 'Este computador está sem internet'
      : falha.tipo === 'timeout' ? 'O servidor do IAHub não respondeu a tempo'
        : falha.tipo === 'servidor' ? 'O servidor do IAHub respondeu com erro' : 'Sem comunicação com o servidor do IAHub';
    const dados = ultimaOk ? `Os dados abaixo são da última atualização (${ultimaOk.toLocaleTimeString('pt-BR')}) e podem estar desatualizados.` : 'Ainda não foi possível confirmar os dados com o servidor.';
    const causa = offline ? 'Verifique a rede (Wi-Fi ou cabo).' : 'O serviço pode estar parado ou reiniciando.';
    banner.querySelector('.conn-texto').textContent = `${causa} ${dados} Sem resposta há ${duracao(Date.now() - falha.desde)} · nova tentativa em ${Math.max(0, Math.ceil((proxima - Date.now()) / 1000))} s.`;
    banner.querySelector('.conn-tec').textContent = `Detalhe técnico: ${falha.tecnico}`;
    banner.querySelector('button').disabled = sondando;
    banner.querySelector('button').hidden = false;
  }

  function registrar(tipo, tecnico) {
    clearTimeout(ocultar);
    if (!falha) {
      falha = { desde: Date.now(), tipo, tecnico };
      tentativa = 0;
      proxima = Date.now() + esperas[0] * 1000;
      timer = setInterval(() => {
        renderizar();
        if (Date.now() >= proxima) tentarAgora();
      }, 1000);
    } else Object.assign(falha, { tipo, tecnico });
    renderizar();
  }

  function recuperar() {
    if (!falha || leiturasAtivas.size || aguardando.size || sondando) return;
    const desde = falha.desde;
    falha = null;
    clearInterval(timer);
    document.documentElement.classList.remove('svc-sem-conexao');
    montar();
    if (!banner) return;
    banner.classList.add('mostrar', 'ok');
    banner.querySelector('.conn-ic').innerHTML = okIcone;
    banner.querySelector('.conn-titulo').textContent = `Conexão restabelecida às ${new Date().toLocaleTimeString('pt-BR')}`;
    banner.querySelector('.conn-texto').textContent = `O servidor voltou a responder após ${duracao(Date.now() - desde)}. Se uma ação falhou, confira o resultado antes de tentar novamente.`;
    banner.querySelector('.conn-tec').textContent = '';
    banner.querySelector('button').hidden = true;
    ocultar = setTimeout(() => banner.classList.remove('mostrar', 'ok'), 8000);
  }

  // Um único relógio coordena todas as consultas em falha da página.
  function esperar(signal) {
    return new Promise((resolve, reject) => {
      function concluir() { aguardando.delete(concluir); signal?.removeEventListener('abort', cancelar); resolve(); }
      function cancelar() { aguardando.delete(concluir); signal.removeEventListener('abort', cancelar); reject(signal.reason || new DOMException('Consulta cancelada', 'AbortError')); }
      aguardando.add(concluir);
      if (signal?.aborted) cancelar(); else signal?.addEventListener('abort', cancelar, { once: true });
    });
  }

  async function executar(input, options, leitura) {
    const sinal = options?.signal || (input instanceof Request ? input.signal : null);
    // Mantém o sinal original durante o consumo de corpos e streams.
    if (!leitura || sinal) return originalFetch(input, options);
    const ctrl = new AbortController();
    const prazo = setTimeout(() => ctrl.abort(new DOMException('Tempo limite de 15 s', 'TimeoutError')), 15000);
    try { return await originalFetch(input, { ...options, signal: ctrl.signal }); }
    finally { clearTimeout(prazo); }
  }

  async function consultar(input, options, leitura, atualizarDados = true) {
    const sinal = options?.signal || (input instanceof Request ? input.signal : null);
    for (;;) {
      let resposta;
      try {
        resposta = await executar(input, options, leitura);
        if (resposta.status < 500) {
          if (leitura && atualizarDados && resposta.ok) ultimaOk = new Date();
          return resposta; // 401, 403 e erros de validação seguem o tratamento da própria tela.
        }
        registrar([502, 503, 504].includes(resposta.status) ? 'gateway' : 'servidor', `HTTP ${resposta.status}`);
        if (!leitura) return resposta;
      } catch (e) {
        if (sinal?.aborted || e.name === 'AbortError') {
          if (sinal?.reason?.name === 'TimeoutError') registrar('timeout', 'Tempo limite da consulta');
          throw e;
        }
        registrar(e.name === 'TimeoutError' ? 'timeout' : 'rede', e.name === 'TimeoutError' ? 'Tempo limite de 15 s' : e.message);
        if (!leitura) throw e;
      }
      // Libera a conexão antes de aguardar outra tentativa.
      if (resposta?.body) await resposta.body.cancel().catch(() => {});
      await esperar(sinal);
    }
  }

  window.fetch = function (input, options) {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const inicial = /^\/api\/(?:me|minhas-rotinas|session\/empresa|empresas\/minhas)$/.test(url.pathname);
    const doModulo = /^\/api\/(ia-service(?:-externo|-publico)?(?:\/|$)|version$)/.test(url.pathname);
    if (url.origin !== location.origin || (!inicial && !doModulo)) return originalFetch(input, options);
    const metodo = (options?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    // A pesquisa da IA é um pedido longo: se a conexão dele cair, a tela acompanha o
    // andamento no servidor e decide sozinha (2026-11-18, #036996). Queda real do
    // servidor continua detectada pelas leituras (andamento, /api/version).
    if (metodo === 'POST' && /\/investigar$/.test(url.pathname)) return originalFetch(input, options);
    // Downloads e operações longas mantêm seus prazos explícitos e não são repetidos.
    const leitura = metodo === 'GET' && !/download|relatorio\.pdf|anexos-softexpert/.test(url.pathname);
    if (!leitura) return consultar(input, options, false);
    // Deduplica polling durante a queda. Chaves incluem headers para não misturar
    // empresas ou sessões; ficam somente em memória, sem expor credenciais na UI.
    const headers = [...new Headers(options?.headers || (input instanceof Request ? input.headers : undefined))];
    const chave = JSON.stringify([url.href, headers, options?.credentials || 'same-origin', options?.mode || 'cors']);
    const compartilhar = !options?.signal && !(input instanceof Request);
    if (falha && compartilhar && pendentes.has(chave)) return pendentes.get(chave).then(r => r.clone());
    const promessa = consultar(input, options, true, !inicial && url.pathname !== '/api/version');
    if (compartilhar) pendentes.set(chave, promessa);
    leiturasAtivas.add(promessa);
    let confirmou = false;
    return promessa.then(r => { confirmou = r.ok; return r; }).finally(() => {
      leiturasAtivas.delete(promessa);
      if (pendentes.get(chave) === promessa) pendentes.delete(chave);
      if (confirmou) recuperar();
    });
  };

  async function tentarAgora() {
    if (!falha || sondando) return;
    if (banner) banner.querySelector('button').hidden = false;
    proxima = Date.now() + esperas[Math.min(++tentativa, esperas.length - 1)] * 1000;
    if (aguardando.size) {
      for (const concluir of [...aguardando]) concluir();
    } else {
      sondando = true;
      try {
        const r = await executar('/api/version', { cache: 'no-store' }, true);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await r.body?.cancel();
        sondando = false;
        recuperar();
      } catch (e) { registrar(e.name === 'TimeoutError' ? 'timeout' : 'rede', e.message); }
      finally { sondando = false; }
    }
    renderizar();
  }

  window.IaServiceConexao = { tentarAgora };
  document.addEventListener('DOMContentLoaded', montar, { once: true });
  window.addEventListener('online', tentarAgora);
  window.addEventListener('offline', () => registrar('rede', 'Navegador sem conexão com a internet'));
  // Detecta indisponibilidade também em telas sem polling próprio.
  setInterval(() => {
    if (!falha && document.visibilityState === 'visible') window.fetch('/api/version', { cache: 'no-store' }).catch(() => {});
  }, 30000);
})();
