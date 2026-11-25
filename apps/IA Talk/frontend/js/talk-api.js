// IA Talk — acesso à API a partir das telas. Única forma de chamar o backend
// nas telas: TalkApi.get/post/put/del. Trata o formato de erro do Talk
// ({ erro: { codigo, mensagem, campos?, detalhe? } }), a base /app/ia-talk e
// os cenários do servidor simulado.
//
//   const pagina = await TalkApi.get('/empresas', { busca: 'plan', limite: 50 });
//   await TalkApi.put(`/empresas/${id}`, corpo);
//   try { ... } catch (err) { if (err instanceof TalkApi.ErroApi && err.campos) ... }
//
// Cenários do simulado (só para desenvolvimento): no console do navegador,
//   sessionStorage.setItem('talk_simular', 'vazio')     // ou 'lento', '403', '500', 'lento,vazio'
//   sessionStorage.removeItem('talk_simular')
(function () {
  const BASE = '/app/ia-talk';

  class ErroApi extends Error {
    constructor(status, corpoErro) {
      const e = corpoErro || {};
      super(e.mensagem || 'Não foi possível falar com o servidor. Confira a conexão e tente de novo.');
      this.name = 'ErroApi';
      this.status = status;
      this.codigo = e.codigo || (status === 0 ? 'sem_conexao' : 'erro_interno');
      this.campos = e.campos || null;
      this.detalhe = e.detalhe ?? null;
    }
  }

  function cenarioSimulado() {
    try { return sessionStorage.getItem('talk_simular') || ''; } catch (_) { return ''; }
  }

  function montarQuery(params) {
    if (!params) return '';
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      q.set(k, Array.isArray(v) ? v.join('|') : String(v));
    }
    const s = q.toString();
    return s ? `?${s}` : '';
  }

  // api: 'admin' (padrão, sessão) | 'publico' (página de entrada) | 'v1' (integradores, só no guia)
  async function chamar(metodo, caminho, { corpo, params, api = 'admin', sinal } = {}) {
    const url = `${BASE}/api/${api}${caminho}${montarQuery(params)}`;
    const headers = { Accept: 'application/json' };
    if (corpo !== undefined) headers['Content-Type'] = 'application/json';
    const sim = cenarioSimulado();
    if (sim) headers['X-Talk-Simular'] = sim;

    let resposta;
    try {
      resposta = await fetch(url, {
        method: metodo, headers, credentials: 'same-origin', cache: 'no-store', signal: sinal,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new ErroApi(0, null);
    }
    if (resposta.status === 204) return null;
    const tipo = resposta.headers.get('content-type') || '';
    const dados = tipo.includes('application/json') ? await resposta.json().catch(() => null) : await resposta.text();
    if (!resposta.ok) {
      const err = new ErroApi(resposta.status, dados && dados.erro);
      if (resposta.status === 401 && api === 'admin') {
        window.top.dispatchEvent(new CustomEvent('talk:sessao-expirada', { detail: { mensagem: err.message } }));
      }
      throw err;
    }
    return dados;
  }

  // Socket.IO do Talk: <script src="/app/ia-talk/socket.io/socket.io.js"> antes deste uso.
  function socket() {
    if (typeof window.io !== 'function') throw new Error('Cliente Socket.IO não carregado nesta tela.');
    return window.io('/talk', { path: `${BASE}/socket.io`, transports: ['websocket', 'polling'] });
  }

  window.TalkApi = {
    BASE,
    ErroApi,
    montarQuery,
    get: (caminho, params, opcoes = {}) => chamar('GET', caminho, { ...opcoes, params }),
    post: (caminho, corpo, opcoes = {}) => chamar('POST', caminho, { ...opcoes, corpo: corpo ?? {} }),
    put: (caminho, corpo, opcoes = {}) => chamar('PUT', caminho, { ...opcoes, corpo: corpo ?? {} }),
    del: (caminho, opcoes = {}) => chamar('DELETE', caminho, opcoes),
    socket,
  };
})();
