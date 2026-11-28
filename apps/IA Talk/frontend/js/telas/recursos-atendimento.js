// IA Talk · Etapa G22 — leitura única de GET /atendimento/recursos (§9.12) e aplicação
// uniforme do selo discreto "Ainda não ativo" nas telas de atendimento e configuração.
// Se a rota falhar, não exibe selos nem mensagens de erro.
(function () {
  const ROTULO = 'Ainda não ativo';
  const DICA = 'Já pode configurar; passa a valer numa próxima atualização.';

  /**
   * Consulta GET /atendimento/recursos uma única vez na abertura da tela.
   * @param {(caminho: string) => Promise<Record<string, boolean>>} [buscar] Função de leitura da API da tela.
   * @returns {Promise<{ ok: boolean, dados: Record<string, boolean> | null }>} Estado carregado sem propagar erro.
   */
  async function carregar(buscar) {
    const leitor = typeof buscar === 'function' ? buscar : (caminho) => window.TalkApi.get(caminho);
    try {
      const resposta = await leitor('/atendimento/recursos');
      if (resposta && typeof resposta === 'object' && !Array.isArray(resposta)) {
        return { ok: true, dados: resposta };
      }
      return { ok: false, dados: null };
    } catch (_) {
      return { ok: false, dados: null };
    }
  }

  /**
   * Informa se um recurso foi explicitamente declarado como inativo (false) pelo servidor.
   * Quando a rota falha (ok === false), retorna false para não exibir selo indevido.
   * @param {{ ok: boolean, dados: Record<string, boolean> | null } | null} estado Resultado de carregar().
   * @param {string} chave Nome do recurso em RECURSOS_ATENDIMENTO.
   * @returns {boolean}
   */
  function inativo(estado, chave) {
    if (!estado || !estado.ok || !estado.dados) return false;
    return estado.dados[chave] === false;
  }

  /**
   * Informa se um recurso está ativo (true) no servidor.
   * @param {{ ok: boolean, dados: Record<string, boolean> | null } | null} estado Resultado de carregar().
   * @param {string} chave Nome do recurso em RECURSOS_ATENDIMENTO.
   * @returns {boolean}
   */
  function ativo(estado, chave) {
    if (!estado || !estado.ok || !estado.dados) return false;
    return estado.dados[chave] === true;
  }

  /**
   * Renderiza ou oculta todos os selos [data-selo-recurso] dentro da raiz informada.
   * @param {ParentNode} [raiz=document] Elemento raiz onde procurar marcadores de selo.
   * @param {{ ok: boolean, dados: Record<string, boolean> | null } | null} estado Resultado de carregar().
   */
  function aplicarSelos(raiz, estado) {
    const escopo = raiz || document;
    const marcadores = escopo.querySelectorAll('[data-selo-recurso]');
    for (const el of marcadores) {
      const chave = el.getAttribute('data-selo-recurso');
      el.classList.add('tlk-selo-futuro');
      el.textContent = ROTULO;
      el.title = DICA;
      el.hidden = !inativo(estado, chave);
    }
  }

  window.TalkRecursos = {
    ROTULO,
    DICA,
    carregar,
    inativo,
    ativo,
    aplicarSelos,
  };
})();
