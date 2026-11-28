// IA Talk · Central de Atendimento compartilhada (G13 + G15).
// Usada por frontend/atendimento.html (administração) e frontend/portal.html (portal do atendente).
// Contrato: docs/contratos.md §8 (conversas, setores, respostas rápidas, socket) e §9.4 (oferta/rodízio).
(function () {
  function iniciar(opcoes = {}) {
    const $ = (id) => document.getElementById(id);
    const { esc, pill, dataHora, relativo } = TalkUI;

    const POLL_FALLBACK_MS = 5000;
    const LIMITE_NOTA = 2000;
    const ROTULO_VISAO = { minhas: 'Minhas', fila: 'Fila', abertas: 'Abertas', encerradas: 'Encerradas' };
    const KEY_RESUMO_RECOLHIDO = 'talk_atd_resumo_recolhido';
    const KEY_LATERAL_RECOLHIDA = 'talk_atd_lateral_recolhida';
    const KEY_LISTA_COMPACTA = 'talk_atd_lista_compacta';
    const mqDesktopGrande = window.matchMedia('(min-width: 1280px)');

    const qs = new URLSearchParams(location.search);
    const simularUrl = qs.get('simular') || '';
    const conversaInicialUrl = qs.get('conversa') || '';

    const ao401 = typeof opcoes.ao401 === 'function' ? opcoes.ao401 : null;
    const aoSessao = typeof opcoes.aoSessao === 'function' ? opcoes.aoSessao : null;
    const aoSocket = typeof opcoes.aoSocket === 'function' ? opcoes.aoSocket : null;
    const aoRecarregar = typeof opcoes.aoRecarregar === 'function' ? opcoes.aoRecarregar : null;

    // Encaminha ?simular=... (ex.: ?simular=atendente) sem poluir sessionStorage de outras abas.
    const comSimular = (params = {}) => (simularUrl ? { ...params, simular: simularUrl } : params);
    async function comTratamento(promessa) {
      try {
        return await promessa;
      } catch (err) {
        if (err?.status === 401 && ao401) ao401(err);
        throw err;
      }
    }
    const api = {
      get: (caminho, params) => comTratamento(TalkApi.get(caminho, comSimular(params))),
      post: (caminho, corpo) => comTratamento(TalkApi.post(caminho, corpo, simularUrl ? { params: { simular: simularUrl } } : {})),
      put: (caminho, corpo) => comTratamento(TalkApi.put(caminho, corpo, simularUrl ? { params: { simular: simularUrl } } : {})),
    };

    function modoAtendenteSimulado() {
      if (simularUrl.split(',').includes('atendente')) return true;
      try { return (sessionStorage.getItem('talk_simular') || '').split(',').includes('atendente'); } catch (_) { return false; }
    }

    let sessao = null;
    let usuarioEfetivo = { id: null, nome: '' };
    let setoresAtivos = [];
    let contadores = { minhas: 0, fila: 0, abertas: 0, por_setor: [] };

    let visaoAtual = 'abertas';
    let setorAtualId = '';
    let buscaAtual = '';
    let conversas = [];
    let proximoCursorConversas = null;
    let listaSeq = 0;
    let respostasSeq = 0;

    let conversaAtual = null;
    let itensConversa = [];
    let proximoCursorItens = null;
    let historicoContato = [];
    let respostasRapidas = [];

    const rascunhos = new Map();
    let envioEmAndamento = false;
    let modoCompositor = 'cliente'; // 'cliente' | 'nota'
    let slashIndice = 0;
    let slashLista = [];
    let conflitoConversaId = null;

    let socket = null;
    let conversaAssinadaId = null;
    let timerFallback = null;
    let timerBusca = null;
    let timerOferta = null;

    // Cor do avatar pelo nome (a mesma pessoa tem sempre a mesma cor): matiz de 0 a 359.
    function matiz(nome) {
      let h = 0;
      for (const ch of String(nome || '?')) h = (h * 31 + ch.charCodeAt(0)) % 360;
      return h;
    }

    function iniciais(nome) {
      return String(nome || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
    }

    function formatarContagem(ms) {
      const segTotal = Math.max(0, Math.ceil(ms / 1000));
      const min = Math.floor(segTotal / 60);
      const seg = segTotal % 60;
      return `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
    }

    function pararTimerOferta() {
      if (timerOferta) clearInterval(timerOferta);
      timerOferta = null;
    }

    function resolverUsuarioEfetivo() {
      if (sessao?.usuario) {
        usuarioEfetivo = { id: sessao.usuario.id, nome: sessao.usuario.nome };
      } else if (modoAtendenteSimulado()) {
        const carla = setoresAtivos.flatMap((s) => s.membros || []).find((m) => m.id === 'usr_carla');
        usuarioEfetivo = carla ? { id: carla.id, nome: carla.nome } : { id: 'usr_carla', nome: 'Carla Souza' };
      }
      const el = $('usuario-ativo');
      if (el) {
        if (usuarioEfetivo.nome) {
          el.innerHTML = `Atendente: <strong>${esc(usuarioEfetivo.nome)}</strong>`;
        } else {
          el.textContent = '';
        }
      }
    }

    function expandirVariaveis(texto) {
      const nomeContato = conversaAtual?.contato?.nome || '';
      const nomeAtendente = usuarioEfetivo.nome || sessao?.usuario?.nome || '';
      return String(texto || '')
        .replace(/\{nome_contato\}/g, nomeContato)
        .replace(/\{nome_atendente\}/g, nomeAtendente);
    }

    function definirPassoMobile(passo) {
      $('workspace').dataset.passo = passo;
      const app = $('atd-app');
      if (app) app.dataset.passo = passo;
    }

    function fecharPopovers() {
      $('popover-transferir').hidden = true;
      $('btn-transferir').setAttribute('aria-expanded', 'false');
      $('popover-encerrar').hidden = true;
      $('btn-encerrar').setAttribute('aria-expanded', 'false');
    }

    function mostrarAlertaConversa(mensagem, { conversaId = null } = {}) {
      conflitoConversaId = conversaId;
      $('alerta-conversa-texto').textContent = mensagem;
      $('btn-abrir-conflito').hidden = !conversaId;
      $('alerta-conversa').hidden = false;
    }

    function limparAlertaConversa() {
      conflitoConversaId = null;
      $('alerta-conversa').hidden = true;
      $('alerta-conversa-texto').textContent = '';
      $('btn-abrir-conflito').hidden = true;
    }

    // ── Contadores e cartões numéricos retráteis no cabeçalho ──────────
    function renderizarContadores() {
      $('cnt-minhas').textContent = String(contadores.minhas ?? 0);
      $('cnt-fila').textContent = String(contadores.fila ?? 0);
      $('cnt-abertas').textContent = String(contadores.abertas ?? 0);

      document.querySelectorAll('#lista-visoes [data-visao]').forEach((btn) => {
        const ativo = btn.dataset.visao === visaoAtual;
        btn.classList.toggle('ativo', ativo);
        btn.setAttribute('aria-pressed', String(ativo));
      });
      const btnFila = document.querySelector('#lista-visoes [data-visao="fila"]');
      if (btnFila) btnFila.classList.toggle('tem-alerta', (contadores.fila ?? 0) > 0);

      const ul = $('lista-setores');
      const porSetor = Array.isArray(contadores.por_setor) ? contadores.por_setor : [];
      const totalTodos = visaoAtual === 'fila' ? (contadores.fila ?? 0) : (contadores.abertas ?? 0);

      const itensHtml = [
        `<li><button class="atd-nav-btn atd-kpi-card atd-kpi-card--setor ${setorAtualId === '' ? 'ativo' : ''}" type="button" data-setor="" aria-pressed="${setorAtualId === ''}" title="Todos os setores visíveis" aria-label="Todos os setores visíveis">
          <span class="atd-nav-nome atd-kpi-rotulo">Todos</span>
          <span class="atd-contador atd-kpi-valor">${esc(totalTodos)}</span>
        </button></li>`,
        ...porSetor.map((s) => {
          const valor = visaoAtual === 'fila' ? (s.na_fila ?? 0) : (s.abertas ?? 0);
          const filaTag = visaoAtual !== 'fila' && (s.na_fila ?? 0) > 0
            ? `<span class="atd-kpi-fila-tag">${esc(s.na_fila)} fila</span>`
            : '';
          const dica = `${s.nome}: ${s.abertas ?? 0} aberta(s), ${s.na_fila ?? 0} na fila`;
          return `<li><button class="atd-nav-btn atd-kpi-card atd-kpi-card--setor ${setorAtualId === s.id ? 'ativo' : ''}" type="button" data-setor="${esc(s.id)}" aria-pressed="${setorAtualId === s.id}" title="${esc(dica)}" aria-label="${esc(dica)}">
            <span class="atd-nav-nome atd-kpi-rotulo">${esc(s.nome)}</span>
            <span class="atd-kpi-valor-wrap">
              <span class="atd-contador atd-kpi-valor">${esc(valor)}</span>
              ${filaTag}
            </span>
          </button></li>`;
        }),
      ];
      ul.innerHTML = itensHtml.join('');

      const setorObj = porSetor.find((s) => s.id === setorAtualId);
      const rotuloVisao = ROTULO_VISAO[visaoAtual] || 'Conversas';
      $('titulo-lista-conv').textContent = setorObj ? `${rotuloVisao} · ${setorObj.nome}` : rotuloVisao;

      const pillResumo = $('btn-resumo-inline');
      if (pillResumo) {
        const partes = [];
        if (visaoAtual === 'encerradas') partes.push('Encerradas');
        partes.push(
          `Abertas ${contadores.abertas ?? 0}`,
          `Fila ${contadores.fila ?? 0}`,
          `Minhas ${contadores.minhas ?? 0}`,
          setorObj ? setorObj.nome : 'Todos os setores'
        );
        pillResumo.textContent = partes.join(' · ');
      }
    }

    async function carregarContadores() {
      contadores = await api.get('/conversas/contadores');
      renderizarContadores();
    }

    async function carregarSetores() {
      try {
        const pag = await api.get('/setores', { situacao: 'ativo', limite: 100 });
        setoresAtivos = Array.isArray(pag?.itens) ? pag.itens : [];
      } catch (err) {
        if (err?.status === 401) throw err;
        setoresAtivos = [];
      }
      resolverUsuarioEfetivo();
    }

    // ── Lista de conversas ──────────────────────────────────────────────
    function conversaPertenceAFiltroAtual(cv) {
      if (setorAtualId && cv.setor?.id !== setorAtualId) return false;
      if (visaoAtual === 'minhas') return cv.situacao === 'aberta' && cv.responsavel?.id === usuarioEfetivo.id;
      if (visaoAtual === 'fila') return cv.situacao === 'aberta' && !!cv.na_fila;
      if (visaoAtual === 'abertas') return cv.situacao === 'aberta';
      if (visaoAtual === 'encerradas') return cv.situacao === 'encerrada';
      return true;
    }

    function ordenarConversas() {
      if (visaoAtual === 'fila') {
        conversas.sort((a, b) => {
          if (a.prioridade !== b.prioridade) return a.prioridade === 'alta' ? -1 : 1;
          return String(a.aguardando_desde || a.aberta_em || '').localeCompare(String(b.aguardando_desde || b.aberta_em || ''));
        });
      } else {
        conversas.sort((a, b) => String(b.atualizada_em || '').localeCompare(String(a.atualizada_em || '')));
      }
    }

    function renderizarListaConversas() {
      const ul = $('lista-conversas');
      const boxEstado = $('estado-lista');
      $('wrap-mais-conversas').hidden = !proximoCursorConversas;

      if (!conversas.length) {
        ul.innerHTML = '';
        TalkUI.estado(boxEstado, 'vazio', {
          titulo: 'Nenhuma conversa aqui',
          texto: buscaAtual
            ? 'Nenhuma conversa corresponde à busca atual.'
            : 'Não há conversas nesta visão ou setor no momento.',
        });
        return;
      }

      boxEstado.hidden = true;
      ul.innerHTML = conversas.map((c) => {
        const ativa = conversaAtual?.id === c.id;
        const previa = c.ultima_mensagem?.previa || 'Sem mensagens registradas';
        const hora = c.atualizada_em ? relativo(c.atualizada_em) : '';
        const espera = visaoAtual === 'fila' && c.aguardando_desde ? `Esperando ${relativo(c.aguardando_desde)}` : '';
        const dono = c.responsavel ? c.responsavel.nome : 'Na fila';
        const etiquetas = (c.etiquetas || []).slice(0, 2).map((e) => `<span class="atd-tag-mini">${esc(e)}</span>`).join('');
        const temOferta = c.situacao === 'aberta' && !c.responsavel && !!c.oferta;
        const ofertaMinha = temOferta && c.oferta.para?.id === usuarioEfetivo.id;
        const ofertaTag = temOferta
          ? `<span class="atd-tag-mini atd-tag-mini--oferta">${ofertaMinha ? 'Oferecida a você' : 'Rodízio'}</span>`
          : '';
        const dica = `${c.contato?.nome || 'Contato'} · Protocolo ${c.protocolo} · ${c.setor?.nome || ''} · ${dono}`;
        return `<li>
          <button type="button" class="atd-conv-item ${ativa ? 'ativa' : ''} ${c.nao_lidas > 0 ? 'atd-conv-item--nova' : ''} ${ofertaMinha ? 'atd-conv-item--oferta' : ''}" data-conversa-id="${esc(c.id)}" aria-current="${ativa ? 'true' : 'false'}" title="${esc(dica)}">
            <span class="atd-conv-avatar-wrap" aria-hidden="true">
              <span class="atd-conv-avatar" style="--av-h:${matiz(c.contato?.nome)}">${esc(iniciais(c.contato?.nome))}</span>
              ${c.nao_lidas > 0 ? `<span class="atd-conv-badge-mini">${esc(c.nao_lidas)}</span>` : ''}
            </span>
            <span class="atd-conv-corpo">
            <div class="atd-conv-linha1">
              <span class="atd-conv-nome">${esc(c.contato?.nome || 'Contato')}</span>
              <span class="atd-conv-hora">${esc(hora)}</span>
            </div>
            <div class="atd-conv-previa">${esc(previa)}</div>
            <div class="atd-conv-rodape">
              <div class="atd-conv-tags">
                <span class="atd-tag-mini">${esc(c.setor?.nome || '—')}</span>
                <span class="atd-tag-mini ${c.na_fila ? 'atd-tag-mini--fila' : ''}">${esc(dono)}</span>
                ${ofertaTag}
                ${c.prioridade === 'alta' ? '<span class="atd-tag-mini atd-tag-mini--alta">Alta</span>' : ''}
                ${espera ? `<span class="atd-tag-mini">${esc(espera)}</span>` : ''}
                ${etiquetas}
              </div>
              ${c.nao_lidas > 0 ? `<span class="atd-nao-lidas" aria-label="${esc(c.nao_lidas)} não lida(s)">${esc(c.nao_lidas)}</span>` : ''}
            </div>
            </span>
          </button>
        </li>`;
      }).join('');
    }

    async function carregarConversas({ continuar = false, silencioso = false } = {}) {
      const seqLista = ++listaSeq;
      const boxEstado = $('estado-lista');
      if (!continuar && !silencioso) {
        $('lista-conversas').innerHTML = '';
        $('wrap-mais-conversas').hidden = true;
        TalkUI.estado(boxEstado, 'carregando', { titulo: 'Carregando conversas…' });
      }
      try {
        const pag = await api.get('/conversas', {
          visao: visaoAtual,
          setor_id: setorAtualId || undefined,
          busca: buscaAtual || undefined,
          limite: 50,
          cursor: continuar ? proximoCursorConversas : undefined,
        });
        if (seqLista !== listaSeq) return;
        const itens = Array.isArray(pag?.itens) ? pag.itens : [];
        proximoCursorConversas = pag?.proximo_cursor || null;
        conversas = continuar ? [...conversas, ...itens] : itens;
        renderizarListaConversas();
      } catch (err) {
        if (seqLista !== listaSeq || silencioso) return;
        if (err?.status === 401) return;
        if (err?.status === 403) {
          mostrarErroGlobal(err);
        } else {
          TalkUI.estadoDoErro(boxEstado, err, () => carregarConversas({ continuar }));
        }
      }
    }

    // ── Destaque de oferta do rodízio (§9.4) ────────────────────────────
    function renderizarBannerOferta() {
      pararTimerOferta();
      const el = $('banner-oferta');
      if (!el) return;

      const cv = conversaAtual;
      const oferta = cv && cv.situacao === 'aberta' && !cv.responsavel ? cv.oferta : null;
      if (!oferta || !oferta.para) {
        el.hidden = true;
        el.innerHTML = '';
        el.className = 'atd-oferta-banner';
        return;
      }

      const minha = oferta.para.id === usuarioEfetivo.id;
      const ateMs = Date.parse(oferta.ate || '');
      const tempoTxt = Number.isFinite(ateMs) ? formatarContagem(ateMs - Date.now()) : '--:--';

      el.className = `atd-oferta-banner ${minha ? 'atd-oferta-banner--minha' : 'atd-oferta-banner--outra'}`;
      if (minha) {
        el.innerHTML = `
          <div class="atd-oferta-info">
            <span class="atd-oferta-selo">Oferta do rodízio</span>
            <div class="atd-oferta-texto">
              <strong>Conversa oferecida para você</strong>
              <span>Protocolo <code>${esc(cv.protocolo)}</code> · Setor <strong>${esc(cv.setor?.nome || '—')}</strong> · Tempo restante: <strong class="atd-oferta-contagem" id="oferta-contagem">${esc(tempoTxt)}</strong></span>
            </div>
          </div>
          <div class="atd-oferta-acoes">
            <button class="btn btn-primary btn-sm" type="button" id="btn-oferta-aceitar" title="Aceitar oferta do rodízio e assumir esta conversa" aria-label="Aceitar oferta do rodízio e assumir esta conversa">${TalkIcones.svg('confirmar')} Aceitar</button>
            <button class="btn btn-ghost btn-sm" type="button" id="btn-oferta-recusar" title="Recusar oferta do rodízio e passar para o próximo atendente" aria-label="Recusar oferta do rodízio e passar para o próximo atendente">${TalkIcones.svg('cancelar')} Recusar</button>
          </div>`;
      } else {
        el.innerHTML = `
          <div class="atd-oferta-info">
            <span class="atd-oferta-selo">Rodízio</span>
            <div class="atd-oferta-texto">
              <strong>Oferecida a ${esc(oferta.para.nome)}</strong>
              <span>Protocolo <code>${esc(cv.protocolo)}</code> · Setor <strong>${esc(cv.setor?.nome || '—')}</strong> · Prazo: <strong class="atd-oferta-contagem" id="oferta-contagem">${esc(tempoTxt)}</strong></span>
            </div>
          </div>`;
      }
      el.hidden = false;

      if (Number.isFinite(ateMs)) {
        const idAlvo = cv.id;
        timerOferta = setInterval(() => {
          const contEl = $('oferta-contagem');
          if (!contEl || conversaAtual?.id !== idAlvo || !conversaAtual?.oferta) {
            pararTimerOferta();
            return;
          }
          const restante = ateMs - Date.now();
          contEl.textContent = formatarContagem(restante);
          if (restante <= 0) {
            pararTimerOferta();
            Promise.all([recarregarConversaAtual(), carregarContadores(), carregarConversas({ silencioso: true })]).catch(() => {});
          }
        }, 1000);
      }
    }

    // ── Conversa ativa, itens e compositor ──────────────────────────────
    function renderizarCabecalhoConversa() {
      const cv = conversaAtual;
      if (!cv) {
        pararTimerOferta();
        const bannerOferta = $('banner-oferta');
        if (bannerOferta) { bannerOferta.hidden = true; bannerOferta.innerHTML = ''; }
        $('chat-ativo').hidden = true;
        $('estado-chat-vazio').hidden = false;
        TalkUI.estado($('estado-chat-vazio'), 'vazio', {
          titulo: 'Selecione uma conversa',
          texto: 'Escolha uma conversa na lista ao lado para ler mensagens, registrar notas internas e responder.',
        });
        return;
      }

      $('estado-chat-vazio').hidden = true;
      $('chat-ativo').hidden = false;
      $('chat-avatar').textContent = iniciais(cv.contato?.nome);
      $('chat-avatar').style.setProperty('--av-h', matiz(cv.contato?.nome));
      $('chat-nome').innerHTML = `
        <span>${esc(cv.contato?.nome || 'Contato')}</span>
        ${cv.situacao === 'encerrada' ? '<span class="tlk-pill tlk-pill--neutro">Encerrada</span>' : ''}
        ${cv.prioridade === 'alta' ? '<span class="tlk-pill tlk-pill--erro">Prioridade alta</span>' : ''}`;

      const respTxt = cv.responsavel ? `Com ${cv.responsavel.nome}` : 'Na fila';
      $('chat-sub').textContent = `${cv.protocolo} · ${cv.setor?.nome || '—'} · ${respTxt} · ${cv.canal?.nome || '—'}`;

      const aberta = cv.situacao === 'aberta';
      $('btn-assumir').hidden = !(aberta && cv.na_fila);
      $('btn-devolver').hidden = !(aberta && !!cv.responsavel);
      $('btn-transferir').hidden = !aberta;
      $('btn-encerrar').hidden = !aberta;
      $('btn-reabrir').hidden = aberta;

      renderizarBannerOferta();
      atualizarEstadoCompositor();
    }

    function atualizarContadorCompositor() {
      const limite = modoCompositor === 'nota' ? LIMITE_NOTA : (conversaAtual?.envio?.limite_caracteres || 4096);
      const len = $('campo-msg').value.length;
      const el = $('contador-compositor');
      el.textContent = `${len} / ${limite}`;
      el.classList.toggle('atd-contador-chars--excedido', len > limite);
    }

    function atualizarEstadoCompositor() {
      const cv = conversaAtual;
      if (!cv) return;

      const podeResponder = !!cv.envio?.pode_responder;
      const motivo = cv.envio?.motivo || '';

      const banner = $('banner-envio');
      if (!podeResponder && motivo) {
        $('banner-envio-texto').textContent = motivo;
        banner.hidden = false;
      } else {
        banner.hidden = true;
      }

      const ehNota = modoCompositor === 'nota';
      $('compositor').classList.toggle('modo-nota', ehNota);
      $('btn-modo-cliente').classList.toggle('ativo', !ehNota);
      $('btn-modo-cliente').setAttribute('aria-pressed', String(!ehNota));
      $('btn-modo-nota').classList.toggle('ativo', ehNota);
      $('btn-modo-nota').setAttribute('aria-pressed', String(ehNota));

      const bloqueado = !ehNota && !podeResponder;
      $('campo-msg').disabled = bloqueado;
      $('btn-enviar').disabled = bloqueado || envioEmAndamento;
      $('btn-atalho-slash').disabled = bloqueado;

      if (ehNota) {
        $('campo-msg').placeholder = 'Escreva uma nota interna (visível só para a equipe)…';
        TalkIcones.definirBotao($('btn-enviar'), {
          icone: 'salvar',
          texto: 'Salvar nota',
          title: 'Salvar nota interna: fica registrada só para a equipe',
          ariaLabel: 'Salvar nota interna: fica registrada só para a equipe',
        });
      } else if (bloqueado) {
        $('campo-msg').placeholder = motivo || 'Envio indisponível nesta conversa.';
        TalkIcones.definirBotao($('btn-enviar'), {
          icone: 'enviar',
          texto: 'Enviar',
          title: motivo || 'Envio indisponível nesta conversa',
          ariaLabel: motivo || 'Envio indisponível nesta conversa',
        });
      } else {
        $('campo-msg').placeholder = "Digite uma mensagem ou '/' para respostas rápidas…";
        TalkIcones.definirBotao($('btn-enviar'), {
          icone: 'enviar',
          texto: 'Enviar',
          title: 'Enviar mensagem ao cliente pelo WhatsApp do canal',
          ariaLabel: 'Enviar mensagem ao cliente pelo WhatsApp do canal',
        });
      }
      atualizarContadorCompositor();
    }

    function renderizarItemHtml(it) {
      if (it.categoria === 'evento') {
        return `<div class="atd-evento" data-item-id="${esc(it.id)}">${esc(it.texto)} · ${esc(dataHora(it.em))}</div>`;
      }
      if (it.categoria === 'nota') {
        return `<article class="atd-msg atd-msg--nota" data-item-id="${esc(it.id)}">
          <div class="atd-msg-head">
            <span class="atd-nota-selo">Nota interna · só equipe</span>
            <span>${esc(it.autor?.nome || 'Equipe')}</span>
          </div>
          <div class="atd-msg-texto">${esc(it.texto)}</div>
          <div class="atd-msg-meta"><span>${esc(dataHora(it.em))}</span></div>
        </article>`;
      }
      const saida = it.direcao === 'saida';
      return `<article class="atd-msg ${saida ? 'atd-msg--atendente' : 'atd-msg--cliente'}" data-item-id="${esc(it.id)}">
        <div class="atd-msg-head">
          <strong>${esc(it.autor?.nome || (saida ? 'Atendente' : 'Contato'))}</strong>
        </div>
        <div class="atd-msg-texto">${esc(it.texto)}</div>
        <div class="atd-msg-meta">
          <span>${esc(dataHora(it.em))}</span>
          ${saida && it.estado ? `<span data-item-estado="${esc(it.id)}">${pill(it.estado)}</span>` : ''}
        </div>
      </article>`;
    }

    function renderizarItensConversa({ rolarFim = true } = {}) {
      const box = $('lista-mensagens');
      const prevTop = box.scrollTop;
      const estavaNoFim = box.scrollHeight - box.scrollTop - box.clientHeight <= 40;
      const btnMais = proximoCursorItens
        ? `<div style="text-align:center;"><button class="btn btn-ghost btn-sm" type="button" id="btn-mais-itens" title="Carregar mensagens mais antigas desta conversa" aria-label="Carregar mensagens mais antigas desta conversa">${TalkIcones.svg('atualizar')} Carregar anteriores</button></div>`
        : '';
      box.innerHTML = btnMais + itensConversa.map(renderizarItemHtml).join('');
      if (rolarFim || estavaNoFim) box.scrollTop = box.scrollHeight;
      else box.scrollTop = prevTop;
    }

    async function carregarMaisItens() {
      if (!conversaAtual || !proximoCursorItens) return;
      const seq = conversaSeq;
      const idSolicitado = conversaAtual.id;
      try {
        const pag = await api.get(`/conversas/${encodeURIComponent(idSolicitado)}/itens`, { limite: 100, cursor: proximoCursorItens });
        if (seq !== conversaSeq || conversaAtual?.id !== idSolicitado) return;
        proximoCursorItens = pag?.proximo_cursor || null;
        const antigos = [...(pag?.itens || [])].reverse();
        const existentes = new Set(itensConversa.map((i) => i.id));
        itensConversa = [...antigos.filter((i) => !existentes.has(i.id)), ...itensConversa];
        renderizarItensConversa({ rolarFim: false });
      } catch (err) {
        if (err?.status !== 401) TalkUI.toast(err.message, 'erro');
      }
    }

    // ── Painel lateral: Contato, Etiquetas e Histórico ──────────────────
    function renderizarPainelContato() {
      const el = $('painel-contato');
      const cv = conversaAtual;
      if (!cv) {
        el.dataset.conversaId = '';
        el.innerHTML = '<p class="form-hint" style="margin:0;">Selecione uma conversa para ver os dados do contato e gerenciar etiquetas.</p>';
        return;
      }
      const ct = cv.contato || {};
      const etiquetas = Array.isArray(cv.etiquetas) ? cv.etiquetas : [];
      const refs = Array.isArray(cv.referencias) ? cv.referencias : [];

      const contatoMetaHtml = `
        <div class="atd-info-linha"><span>WhatsApp</span><code>${esc(ct.telefone_mascarado || '—')}</code></div>
        ${ct.nome_whatsapp ? `<div class="atd-info-linha"><span>Nome no WhatsApp</span><strong>${esc(ct.nome_whatsapp)}</strong></div>` : ''}
        <div class="atd-info-linha"><span>Total de conversas</span><strong>${esc(ct.conversas_total ?? 1)}</strong></div>`;

      const conversaDadosHtml = `
        <div class="atd-info-linha"><span>Protocolo</span><code>${esc(cv.protocolo)}</code></div>
        <div class="atd-info-linha"><span>Canal</span><strong>${esc(cv.canal?.nome || '—')}</strong></div>
        <div class="atd-info-linha"><span>Setor</span><strong>${esc(cv.setor?.nome || '—')}</strong></div>
        <div class="atd-info-linha"><span>Responsável</span><strong>${esc(cv.responsavel?.nome || 'Na fila')}</strong></div>
        <div class="atd-info-linha"><span>Situação</span><strong>${cv.situacao === 'encerrada' ? 'Encerrada' : 'Aberta'}</strong></div>
        ${cv.motivo_encerramento ? `<div class="atd-info-linha"><span>Motivo do encerramento</span><strong>${esc(cv.motivo_encerramento)}</strong></div>` : ''}`;

      const refsInnerHtml = refs.map((r) => `
        <div class="atd-info-linha">
          <span>${esc(r.sistema)} #${esc(r.id)}</span>
          <strong>${esc(r.titulo || r.id)}</strong>
          ${r.link && /^https:\/\//i.test(r.link) ? `<a class="btn btn-ghost btn-sm" href="${esc(r.link)}" target="_blank" rel="noopener" style="margin-top:4px;width:fit-content;" title="Abrir chamado ${esc(r.id)} em nova aba" aria-label="Abrir chamado ${esc(r.id)} em nova aba">Abrir chamado ${TalkIcones.svg('externo')}</a>` : ''}
        </div>`).join('');

      const etiquetasHtml = etiquetas.length
        ? etiquetas.map((tag, idx) => `<span class="atd-etiqueta-chip">${esc(tag)}<button type="button" class="atd-etiqueta-rm" data-rm-etiqueta="${idx}" title="Remover etiqueta ${esc(tag)}" aria-label="Remover etiqueta ${esc(tag)}">${TalkIcones.svg('cancelar')}</button></span>`).join('')
        : '<span class="form-hint">Sem etiquetas.</span>';

      const histHtml = historicoContato === null
        ? '<span class="form-hint">Carregando histórico…</span>'
        : historicoContato.length
          ? historicoContato.map((h) => `
              <button type="button" class="atd-hist-btn" data-hist-conversa="${esc(h.id)}" title="Abrir conversa ${esc(h.protocolo)}" aria-label="Abrir conversa ${esc(h.protocolo)}">
                <strong>${esc(h.protocolo)} · ${esc(h.setor?.nome || '—')} ${h.id === cv.id ? '(atual)' : ''}</strong>
                <span>${esc(h.situacao === 'encerrada' ? 'Encerrada' : 'Aberta')} · ${esc(dataHora(h.aberta_em))}</span>
              </button>`).join('')
          : '<span class="form-hint">Sem outras conversas registradas.</span>';

      const mesmaConversa = el.dataset.conversaId === cv.id && !!el.querySelector('#form-etiqueta');
      if (!mesmaConversa) {
        el.dataset.conversaId = cv.id;
        el.innerHTML = `
          <div class="atd-info-bloco">
            <div class="atd-info-tit">
              <span>Contato</span>
              <button class="btn btn-ghost btn-sm" type="button" id="btn-editar-contato" title="Editar nome do contato" aria-label="Editar nome do contato">${TalkIcones.svg('editar')} Editar</button>
            </div>
            <div class="atd-info-linha"><span>Nome</span><strong id="ct-nome-exibicao"></strong></div>
            <form id="form-editar-contato" hidden style="display:flex;flex-direction:column;gap:6px;margin-top:4px;" novalidate>
              <div class="tlk-campo">
                <label class="sr-only" for="inp-ct-nome">Novo nome do contato</label>
                <input class="form-control" id="inp-ct-nome" name="nome" type="text" maxlength="80" value="">
              </div>
              <div style="display:flex;gap:6px;">
                <button class="btn btn-ghost btn-sm" type="button" id="btn-cancelar-contato" title="Cancelar edição do nome" aria-label="Cancelar edição do nome">${TalkIcones.svg('cancelar')} Cancelar</button>
                <button class="btn btn-primary btn-sm" type="submit" id="btn-salvar-contato" title="Salvar nome do contato" aria-label="Salvar nome do contato">${TalkIcones.svg('salvar')} Salvar</button>
              </div>
            </form>
            <div id="ct-meta-dados"></div>
          </div>

          <div class="atd-info-bloco">
            <div class="atd-info-tit">Conversa</div>
            <div id="cv-meta-dados"></div>
          </div>

          <div class="atd-info-bloco" id="bloco-refs" hidden>
            <div class="atd-info-tit">Chamados vinculados</div>
            <div id="cv-refs-lista"></div>
          </div>

          <div class="atd-info-bloco">
            <div class="atd-info-tit" id="etiquetas-tit"></div>
            <div class="tlk-alerta tlk-alerta--erro" id="alerta-etiquetas" role="alert" hidden></div>
            <div class="atd-etiquetas-wrap" id="lista-etiquetas"></div>
            <form class="atd-etiqueta-form" id="form-etiqueta" novalidate>
              <label class="sr-only" for="inp-etiqueta">Nova etiqueta</label>
              <input class="form-control" id="inp-etiqueta" name="etiquetas" type="text" maxlength="30" placeholder="Adicionar etiqueta…" autocomplete="off">
              <button class="btn btn-ghost btn-sm" type="submit" id="btn-add-etiqueta" title="Adicionar etiqueta à conversa" aria-label="Adicionar etiqueta à conversa">${TalkIcones.svg('mais')}</button>
            </form>
          </div>

          <div class="atd-info-bloco">
            <div class="atd-info-tit">Histórico do contato</div>
            <div id="cv-historico-lista" style="display:flex;flex-direction:column;gap:6px;"></div>
          </div>`;
      }

      $('ct-nome-exibicao').textContent = ct.nome || '—';
      const formCt = $('form-editar-contato');
      const inpCt = $('inp-ct-nome');
      if (formCt.hidden && document.activeElement !== inpCt) {
        inpCt.value = ct.nome || '';
      }
      $('ct-meta-dados').innerHTML = contatoMetaHtml;
      $('cv-meta-dados').innerHTML = conversaDadosHtml;

      const blocoRefs = $('bloco-refs');
      blocoRefs.hidden = !refs.length;
      $('cv-refs-lista').innerHTML = refsInnerHtml;

      $('etiquetas-tit').textContent = `Etiquetas (${etiquetas.length}/10)`;
      $('lista-etiquetas').innerHTML = etiquetasHtml;
      $('cv-historico-lista').innerHTML = histHtml;
    }

    // ── Respostas rápidas com "/" ───────────────────────────────────────
    async function carregarRespostasRapidas(setorId) {
      const seqResposta = ++respostasSeq;
      respostasRapidas = [];
      try {
        const pag = await api.get('/respostas-rapidas', { situacao: 'ativa', setor_id: setorId || undefined, limite: 100 });
        if (seqResposta === respostasSeq) respostasRapidas = Array.isArray(pag?.itens) ? pag.itens : [];
      } catch (_) {
        if (seqResposta === respostasSeq) respostasRapidas = [];
      }
    }

    function fecharSlashMenu() {
      $('slash-menu').hidden = true;
      slashLista = [];
      slashIndice = 0;
    }

    function renderizarSlashMenu(filtro = '') {
      const termo = filtro.toLowerCase();
      slashLista = respostasRapidas.filter((r) => {
        if (!termo) return true;
        return `${r.atalho} ${r.titulo} ${r.texto}`.toLowerCase().includes(termo);
      });
      const menu = $('slash-menu');
      if (!slashLista.length) {
        menu.innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--text-lo);">Nenhuma resposta rápida encontrada.</div>';
        menu.hidden = false;
        return;
      }
      if (slashIndice >= slashLista.length) slashIndice = 0;
      menu.innerHTML = slashLista.map((r, i) => `
        <button type="button" role="option" aria-selected="${i === slashIndice ? 'true' : 'false'}" class="atd-slash-item ${i === slashIndice ? 'selecionado' : ''}" data-slash-idx="${i}">
          <div class="atd-slash-head">
            <strong>${esc(r.atalho)}</strong>
            <span style="font-size:11px;color:var(--text-lo);">${esc(r.titulo)}${r.setor ? ` · ${esc(r.setor.nome)}` : ''}</span>
          </div>
          <span>${esc(expandirVariaveis(r.texto))}</span>
        </button>`).join('');
      menu.hidden = false;
    }

    function aplicarSlash(idx) {
      const r = slashLista[idx];
      if (!r) return;
      $('campo-msg').value = expandirVariaveis(r.texto);
      fecharSlashMenu();
      atualizarContadorCompositor();
      $('campo-msg').focus();
    }

    // ── Abrir conversa ──────────────────────────────────────────────────
    let conversaSeq = 0;
    let encerrandoConversaId = null;

    function assinarConversaSocket(id) {
      if (socket?.connected && conversaAssinadaId && conversaAssinadaId !== id) {
        try { socket.emit('conversa:sair', { conversa_id: conversaAssinadaId }); } catch (_) {}
      }
      conversaAssinadaId = id;
      if (socket?.connected && id) {
        socket.emit('conversa:assinar', { conversa_id: id });
      }
    }

    function chaveRascunho(id, modo) { return `${id}:${modo}`; }
    function guardarRascunho() { if (conversaAtual) rascunhos.set(chaveRascunho(conversaAtual.id, modoCompositor), $('campo-msg').value); }
    function restaurarRascunho() { $('campo-msg').value = conversaAtual ? (rascunhos.get(chaveRascunho(conversaAtual.id, modoCompositor)) || '') : ''; }

    async function abrirConversa(id, { irParaChatMobile = true } = {}) {
      const seq = ++conversaSeq;
      respostasSeq += 1;
      respostasRapidas = [];
      fecharPopovers();
      fecharSlashMenu();
      limparAlertaConversa();
      $('alerta-compositor').hidden = true;

      try {
        const [detalhe, pagItens] = await Promise.all([
          api.get(`/conversas/${encodeURIComponent(id)}`),
          api.get(`/conversas/${encodeURIComponent(id)}/itens`, { limite: 100 }),
        ]);
        if (seq !== conversaSeq) return;
        guardarRascunho();
        conversaAtual = detalhe;
        itensConversa = [...(pagItens?.itens || [])].reverse();
        proximoCursorItens = pagItens?.proximo_cursor || null;
        historicoContato = null;
        modoCompositor = 'cliente';
        restaurarRascunho();

        assinarConversaSocket(detalhe.id);
        renderizarListaConversas();
        renderizarCabecalhoConversa();
        renderizarItensConversa({ rolarFim: true });
        renderizarPainelContato();
        if (irParaChatMobile) definirPassoMobile('chat');

        const tarefas = [
          carregarRespostasRapidas(detalhe.setor?.id),
          api.get('/conversas', { contato_id: detalhe.contato?.id, visao: 'todas', limite: 20 })
            .then((p) => { if (seq === conversaSeq && conversaAtual?.id === detalhe.id) historicoContato = p?.itens || []; })
            .catch(() => { if (seq === conversaSeq && conversaAtual?.id === detalhe.id) historicoContato = []; }),
        ];
        if (detalhe.nao_lidas > 0) {
          tarefas.push(
            api.post(`/conversas/${encodeURIComponent(detalhe.id)}/marcar-lida`, {})
              .then((atualizada) => {
                sincronizarConversaNaLista(atualizada);
                if (seq === conversaSeq && conversaAtual?.id === detalhe.id && encerrandoConversaId !== detalhe.id) {
                  conversaAtual = atualizada;
                }
              })
              .catch(() => {})
          );
        }
        await Promise.all(tarefas);
        if (seq !== conversaSeq || conversaAtual?.id !== detalhe.id) return;
        renderizarPainelContato();
      } catch (err) {
        if (seq === conversaSeq && err?.status !== 401) TalkUI.toast(err.message, 'erro');
      }
    }

    function sincronizarConversaNaLista(resumo) {
      if (!resumo?.id) return;
      if (buscaAtual) { carregarConversas({ silencioso: true }); return; }
      const idx = conversas.findIndex((c) => c.id === resumo.id);
      const entra = conversaPertenceAFiltroAtual(resumo);
      if (entra) {
        if (idx >= 0) conversas[idx] = { ...conversas[idx], ...resumo };
        else conversas.unshift(resumo);
        ordenarConversas();
      } else if (idx >= 0) {
        conversas.splice(idx, 1);
      }
      renderizarListaConversas();
    }

    async function recarregarConversaAtual({ rolarFim = false } = {}) {
      if (!conversaAtual || conversaAtual.id === encerrandoConversaId) return;
      const seq = conversaSeq;
      const idSolicitado = conversaAtual.id;
      try {
        const [detalhe, pagItens] = await Promise.all([
          api.get(`/conversas/${encodeURIComponent(idSolicitado)}`),
          api.get(`/conversas/${encodeURIComponent(idSolicitado)}/itens`, { limite: 100 }),
        ]);
        if (seq !== conversaSeq || conversaAtual?.id !== idSolicitado || idSolicitado === encerrandoConversaId) return;
        conversaAtual = detalhe;
        itensConversa = [...(pagItens?.itens || [])].reverse();
        proximoCursorItens = pagItens?.proximo_cursor || null;
        renderizarCabecalhoConversa();
        renderizarItensConversa({ rolarFim });
        renderizarPainelContato();
      } catch (err) {
        if (err?.status === 404 && seq === conversaSeq && conversaAtual?.id === idSolicitado) {
          conversaSeq += 1;
          conversaAtual = null;
          itensConversa = [];
          assinarConversaSocket(null);
          renderizarCabecalhoConversa();
          renderizarPainelContato();
        }
      }
    }

    // ── Ações da conversa (Assumir, Recusar oferta, Devolver, Transferir, Encerrar, Reabrir)
    async function assumirConversaAtual({ botao = $('btn-assumir'), origemOferta = false } = {}) {
      if (!conversaAtual) return;
      limparAlertaConversa();
      if (botao) botao.disabled = true;
      const seqAcao = conversaSeq;
      const idAcao = conversaAtual.id;
      try {
        const atualizada = await api.post(`/conversas/${encodeURIComponent(idAcao)}/assumir`, {});
        if (seqAcao !== conversaSeq || conversaAtual?.id !== idAcao) { await carregarContadores(); return; }
        conversaAtual = atualizada;
        sincronizarConversaNaLista(atualizada);
        await Promise.all([recarregarConversaAtual({ rolarFim: true }), carregarContadores()]);
        TalkUI.toast(origemOferta ? 'Oferta aceita. Conversa atribuída a você.' : 'Conversa assumida.', 'ok');
      } catch (err) {
        if (err?.status === 401) return;
        if (seqAcao !== conversaSeq || conversaAtual?.id !== idAcao) { TalkUI.toast('Não foi possível concluir a ação na conversa anterior.', 'erro'); return; }
        if (err?.status === 409) {
          mostrarAlertaConversa(err.message);
          await Promise.all([recarregarConversaAtual(), carregarContadores(), carregarConversas({ silencioso: true })]);
        } else {
          mostrarAlertaConversa(err.message);
        }
      } finally {
        if (botao && document.body.contains(botao)) botao.disabled = false;
      }
    }

    async function recusarOfertaAtual(botao) {
      if (!conversaAtual) return;
      limparAlertaConversa();
      if (botao) botao.disabled = true;
      const seqAcao = conversaSeq;
      const idAcao = conversaAtual.id;
      try {
        const atualizada = await api.post(`/conversas/${encodeURIComponent(idAcao)}/recusar`, {});
        if (seqAcao !== conversaSeq || conversaAtual?.id !== idAcao) { await carregarContadores(); return; }
        conversaAtual = atualizada;
        sincronizarConversaNaLista(atualizada);
        await Promise.all([recarregarConversaAtual({ rolarFim: true }), carregarContadores()]);
        TalkUI.toast('Oferta recusada.', 'info');
      } catch (err) {
        if (err?.status === 401) return;
        if (seqAcao !== conversaSeq || conversaAtual?.id !== idAcao) { TalkUI.toast('Não foi possível concluir a ação na conversa anterior.', 'erro'); return; }
        mostrarAlertaConversa(err.message);
      } finally {
        if (botao && document.body.contains(botao)) botao.disabled = false;
      }
    }

    $('btn-assumir').addEventListener('click', (e) => assumirConversaAtual({ botao: e.currentTarget }));

    const bannerOfertaEl = $('banner-oferta');
    if (bannerOfertaEl) {
      bannerOfertaEl.addEventListener('click', (e) => {
        const btnAceitar = e.target.closest('#btn-oferta-aceitar');
        if (btnAceitar) { assumirConversaAtual({ botao: btnAceitar, origemOferta: true }); return; }
        const btnRecusar = e.target.closest('#btn-oferta-recusar');
        if (btnRecusar) recusarOfertaAtual(btnRecusar);
      });
    }

    $('btn-devolver').addEventListener('click', async () => {
      if (!conversaAtual) return;
      limparAlertaConversa();
      const btn = $('btn-devolver');
      btn.disabled = true;
      const seqAcao = conversaSeq;
      const idAcao = conversaAtual.id;
      try {
        const atualizada = await api.post(`/conversas/${encodeURIComponent(conversaAtual.id)}/devolver`, {});
        if (seqAcao !== conversaSeq || conversaAtual?.id !== idAcao) { await carregarContadores(); return; }
        conversaAtual = atualizada;
        sincronizarConversaNaLista(atualizada);
        await Promise.all([recarregarConversaAtual({ rolarFim: true }), carregarContadores()]);
        TalkUI.toast('Conversa devolvida para a fila.', 'ok');
      } catch (err) {
        if (err?.status === 401) return;
        if (seqAcao !== conversaSeq || conversaAtual?.id !== idAcao) { TalkUI.toast('Não foi possível concluir a ação na conversa anterior.', 'erro'); return; }
        mostrarAlertaConversa(err.message);
      } finally {
        btn.disabled = false;
      }
    });

    function preencherMembrosTransferir(setorId) {
      const setor = setoresAtivos.find((s) => s.id === setorId);
      const membros = Array.isArray(setor?.membros) ? setor.membros : [];
      $('tr-responsavel').innerHTML = '<option value="">Fila do setor (sem responsável)</option>'
        + membros.map((m) => `<option value="${esc(m.id)}">${esc(m.nome)}</option>`).join('');
    }

    $('tr-setor').addEventListener('change', () => preencherMembrosTransferir($('tr-setor').value));

    $('btn-transferir').addEventListener('click', () => {
      if (!conversaAtual) return;
      const abrir = $('popover-transferir').hidden;
      fecharPopovers();
      if (!abrir) return;
      TalkUI.limparErros($('form-transferir'));
      $('alerta-transferir').hidden = true;
      $('tr-nota').value = '';
      $('tr-setor').innerHTML = setoresAtivos.map((s) => `<option value="${esc(s.id)}">${esc(s.nome)}</option>`).join('');
      if (conversaAtual.setor?.id && setoresAtivos.some((s) => s.id === conversaAtual.setor.id)) {
        $('tr-setor').value = conversaAtual.setor.id;
      }
      preencherMembrosTransferir($('tr-setor').value);
      $('popover-transferir').hidden = false;
      $('btn-transferir').setAttribute('aria-expanded', 'true');
      $('tr-setor').focus();
    });
    $('btn-cancelar-transferir').addEventListener('click', fecharPopovers);

    $('form-transferir').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!conversaAtual) return;
      const form = e.currentTarget;
      TalkUI.limparErros(form);
      $('alerta-transferir').hidden = true;
      const corpo = {
        setor_id: $('tr-setor').value || undefined,
        responsavel_id: $('tr-responsavel').value || undefined,
      };
      const nota = $('tr-nota').value.trim();
      if (nota) corpo.nota = nota;

      const btn = $('btn-confirmar-transferir');
      btn.disabled = true;
      const seqAcao = conversaSeq;
      const idAcao = conversaAtual.id;
      try {
        const atualizada = await api.post(`/conversas/${encodeURIComponent(conversaAtual.id)}/transferir`, corpo);
        if (seqAcao !== conversaSeq || conversaAtual?.id !== idAcao) { await carregarContadores(); return; }
        fecharPopovers();
        conversaAtual = atualizada;
        sincronizarConversaNaLista(atualizada);
        await Promise.all([recarregarConversaAtual({ rolarFim: true }), carregarContadores(), carregarRespostasRapidas(atualizada.setor?.id)]);
        TalkUI.toast('Conversa transferida.', 'ok');
      } catch (err) {
        if (err?.status === 401) return;
        if (seqAcao !== conversaSeq || conversaAtual?.id !== idAcao) { TalkUI.toast('Não foi possível concluir a ação na conversa anterior.', 'erro'); return; }
        if (!TalkUI.errosNoFormulario(form, err)) {
          $('alerta-transferir').textContent = err.message;
          $('alerta-transferir').hidden = false;
        }
      } finally {
        btn.disabled = false;
      }
    });

    $('btn-encerrar').addEventListener('click', () => {
      if (!conversaAtual) return;
      const abrir = $('popover-encerrar').hidden;
      fecharPopovers();
      if (!abrir) return;
      TalkUI.limparErros($('form-encerrar'));
      $('alerta-encerrar').hidden = true;
      $('enc-motivo').value = '';
      $('popover-encerrar').hidden = false;
      $('btn-encerrar').setAttribute('aria-expanded', 'true');
      $('enc-motivo').focus();
    });
    $('btn-cancelar-encerrar').addEventListener('click', fecharPopovers);

    $('form-encerrar').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!conversaAtual) return;
      const form = e.currentTarget;
      TalkUI.limparErros(form);
      $('alerta-encerrar').hidden = true;
      const motivo = $('enc-motivo').value.trim();
      const idEncerrando = conversaAtual.id;
      const seqEncerrando = conversaSeq;
      const btn = $('btn-confirmar-encerrar');
      btn.disabled = true;
      encerrandoConversaId = idEncerrando;
      try {
        const atualizada = await api.post(`/conversas/${encodeURIComponent(idEncerrando)}/encerrar`, motivo ? { motivo } : {});
        if (seqEncerrando !== conversaSeq || conversaAtual?.id !== idEncerrando) {
          sincronizarConversaNaLista(atualizada);
          await carregarContadores();
          return;
        }
        conversaSeq += 1;
        fecharPopovers();
        sincronizarConversaNaLista(atualizada);
        conversaAtual = null;
        itensConversa = [];
        proximoCursorItens = null;
        historicoContato = [];
        assinarConversaSocket(null);
        fecharSlashMenu();
        limparAlertaConversa();
        rascunhos.delete(chaveRascunho(idEncerrando, 'cliente'));
        rascunhos.delete(chaveRascunho(idEncerrando, 'nota'));
        $('campo-msg').value = '';
        renderizarCabecalhoConversa();
        renderizarPainelContato();
        TalkUI.estado($('estado-chat-vazio'), 'vazio', {
          titulo: 'Conversa encerrada',
          texto: 'Selecione outra conversa para continuar ou consulte o histórico em Encerradas.',
          acao: { rotulo: 'Ver encerradas', aoClicar: () => $('lista-visoes').querySelector('[data-visao="encerradas"]').click() },
        });
        definirPassoMobile('lista');
        TalkUI.toast('Conversa encerrada. Consulte o histórico em Encerradas.', 'ok');
        await carregarContadores();
      } catch (err) {
        if (err?.status === 401) return;
        if (seqEncerrando !== conversaSeq || conversaAtual?.id !== idEncerrando) { TalkUI.toast('Não foi possível encerrar a conversa anterior.', 'erro'); return; }
        if (!TalkUI.errosNoFormulario(form, err)) {
          $('alerta-encerrar').textContent = err.message;
          $('alerta-encerrar').hidden = false;
        }
      } finally {
        if (encerrandoConversaId === idEncerrando) encerrandoConversaId = null;
        btn.disabled = false;
      }
    });

    $('btn-reabrir').addEventListener('click', async () => {
      if (!conversaAtual) return;
      limparAlertaConversa();
      const btn = $('btn-reabrir');
      btn.disabled = true;
      const seqAcao = conversaSeq;
      const idAcao = conversaAtual.id;
      try {
        const atualizada = await api.post(`/conversas/${encodeURIComponent(conversaAtual.id)}/reabrir`, {});
        if (seqAcao !== conversaSeq || conversaAtual?.id !== idAcao) { await carregarContadores(); return; }
        conversaAtual = atualizada;
        sincronizarConversaNaLista(atualizada);
        await Promise.all([recarregarConversaAtual({ rolarFim: true }), carregarContadores()]);
        TalkUI.toast('Conversa reaberta.', 'ok');
      } catch (err) {
        if (err?.status === 401) return;
        if (seqAcao !== conversaSeq || conversaAtual?.id !== idAcao) { TalkUI.toast('Não foi possível concluir a ação na conversa anterior.', 'erro'); return; }
        if (err?.status === 409 && err.detalhe?.conversa_id) {
          mostrarAlertaConversa(err.message, { conversaId: err.detalhe.conversa_id });
        } else {
          mostrarAlertaConversa(err.message);
        }
      } finally {
        btn.disabled = false;
      }
    });

    $('btn-abrir-conflito').addEventListener('click', () => {
      if (conflitoConversaId) abrirConversa(conflitoConversaId);
    });
    $('btn-fechar-alerta-conversa').addEventListener('click', limparAlertaConversa);

    // ── Envio de mensagem e nota interna ────────────────────────────────
    $('btn-modo-cliente').addEventListener('click', () => {
      guardarRascunho();
      modoCompositor = 'cliente';
      restaurarRascunho();
      $('alerta-compositor').hidden = true;
      atualizarEstadoCompositor();
    });
    $('btn-modo-nota').addEventListener('click', () => {
      guardarRascunho();
      modoCompositor = 'nota';
      restaurarRascunho();
      $('alerta-compositor').hidden = true;
      fecharSlashMenu();
      atualizarEstadoCompositor();
      $('campo-msg').focus();
    });

    $('btn-atalho-slash').addEventListener('click', () => {
      if ($('campo-msg').disabled) return;
      if (!$('slash-menu').hidden) return fecharSlashMenu();
      if (!$('campo-msg').value.startsWith('/')) {
        $('campo-msg').value = '/';
        atualizarContadorCompositor();
      }
      renderizarSlashMenu('');
      $('campo-msg').focus();
    });

    $('campo-msg').addEventListener('input', () => {
      atualizarContadorCompositor();
      const val = $('campo-msg').value;
      if (modoCompositor === 'cliente' && val.startsWith('/') && !val.includes('\n')) {
        renderizarSlashMenu(val.slice(1));
      } else {
        fecharSlashMenu();
      }
    });

    $('campo-msg').addEventListener('keydown', (e) => {
      const menuAberto = !$('slash-menu').hidden;
      if (menuAberto) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (slashLista.length) {
            slashIndice = (slashIndice + 1) % slashLista.length;
            renderizarSlashMenu($('campo-msg').value.slice(1));
          }
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (slashLista.length) {
            slashIndice = (slashIndice - 1 + slashLista.length) % slashLista.length;
            renderizarSlashMenu($('campo-msg').value.slice(1));
          }
          return;
        }
        if (e.key === 'Enter' && slashLista.length) {
          e.preventDefault();
          aplicarSlash(slashIndice);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          fecharSlashMenu();
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        $('form-compositor').requestSubmit();
      }
    });

    $('slash-menu').addEventListener('click', (e) => {
      const item = e.target.closest('[data-slash-idx]');
      if (item) aplicarSlash(Number(item.dataset.slashIdx));
    });

    $('form-compositor').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!conversaAtual || envioEmAndamento) return;
      const form = e.currentTarget;
      TalkUI.limparErros(form);
      $('alerta-compositor').hidden = true;
      fecharSlashMenu();

      const bruto = $('campo-msg').value;
      const texto = modoCompositor === 'cliente' ? expandirVariaveis(bruto).trim() : bruto.trim();
      const btn = $('btn-enviar');
      envioEmAndamento = true;
      btn.disabled = true;

      const modoEnviado = modoCompositor;
      const seq = conversaSeq;
      const idConv = conversaAtual.id;
      try {
        const rota = modoCompositor === 'nota'
          ? `/conversas/${encodeURIComponent(idConv)}/notas`
          : `/conversas/${encodeURIComponent(idConv)}/responder`;
        const novoItem = await api.post(rota, { texto });
        const chave = chaveRascunho(idConv, modoEnviado);
        if (seq !== conversaSeq || conversaAtual?.id !== idConv || modoCompositor !== modoEnviado) {
          if (rascunhos.get(chave) === bruto) rascunhos.delete(chave);
          return;
        }
        if ($('campo-msg').value === bruto) $('campo-msg').value = '';
        rascunhos.delete(chave);
        atualizarContadorCompositor();
        if (novoItem?.id && !itensConversa.some((i) => i.id === novoItem.id)) {
          itensConversa.push(novoItem);
          renderizarItensConversa({ rolarFim: true });
        }
        if (modoCompositor === 'cliente' && conversaAtual.na_fila) {
          await Promise.all([recarregarConversaAtual({ rolarFim: true }), carregarContadores()]);
        }
      } catch (err) {
        if (err?.status === 401) return;
        if (seq !== conversaSeq || conversaAtual?.id !== idConv || modoCompositor !== modoEnviado) { TalkUI.toast('Não foi possível enviar a mensagem anterior.', 'erro'); return; }
        if (!TalkUI.errosNoFormulario(form, err)) {
          $('alerta-compositor').textContent = err.message;
          $('alerta-compositor').hidden = false;
        }
      } finally {
        envioEmAndamento = false;
        atualizarEstadoCompositor();
      }
    });

    // ── Eventos do painel lateral (Etiquetas, Editar contato, Histórico) ─
    $('painel-contato').addEventListener('click', async (e) => {
      const btnHist = e.target.closest('[data-hist-conversa]');
      if (btnHist) {
        const id = btnHist.dataset.histConversa;
        if (id && id !== conversaAtual?.id) abrirConversa(id);
        return;
      }
      if (e.target.closest('#btn-editar-contato')) {
        $('inp-ct-nome').value = conversaAtual?.contato?.nome || '';
        $('form-editar-contato').hidden = false;
        $('inp-ct-nome').focus();
        return;
      }
      if (e.target.closest('#btn-cancelar-contato')) {
        $('inp-ct-nome').value = conversaAtual?.contato?.nome || '';
        $('form-editar-contato').hidden = true;
        return;
      }
      const rmBtn = e.target.closest('[data-rm-etiqueta]');
      if (rmBtn && conversaAtual) {
        const idx = Number(rmBtn.dataset.rmEtiqueta);
        const proximas = (conversaAtual.etiquetas || []).filter((_, i) => i !== idx);
        try {
          const atualizada = await api.put(`/conversas/${encodeURIComponent(conversaAtual.id)}/etiquetas`, { etiquetas: proximas });
          conversaAtual = atualizada;
          sincronizarConversaNaLista(atualizada);
          renderizarPainelContato();
        } catch (err) {
          if (err?.status !== 401) TalkUI.toast(err.message, 'erro');
        }
      }
    });

    $('painel-contato').addEventListener('submit', async (e) => {
      if (e.target.id === 'form-etiqueta' && conversaAtual) {
        e.preventDefault();
        const inp = $('inp-etiqueta');
        const nova = inp.value.trim();
        const alerta = $('alerta-etiquetas');
        alerta.hidden = true;
        if (!nova) return;
        const proximas = [...(conversaAtual.etiquetas || []), nova];
        try {
          const atualizada = await api.put(`/conversas/${encodeURIComponent(conversaAtual.id)}/etiquetas`, { etiquetas: proximas });
          conversaAtual = atualizada;
          inp.value = '';
          sincronizarConversaNaLista(atualizada);
          renderizarPainelContato();
        } catch (err) {
          if (err?.status === 401) return;
          alerta.textContent = err.campos?.etiquetas || err.message;
          alerta.hidden = false;
        }
        return;
      }
      if (e.target.id === 'form-editar-contato' && conversaAtual?.contato?.id) {
        e.preventDefault();
        const form = e.target;
        TalkUI.limparErros(form);
        try {
          const ct = await api.put(`/contatos/${encodeURIComponent(conversaAtual.contato.id)}`, { nome: $('inp-ct-nome').value.trim() });
          conversaAtual.contato = ct;
          form.hidden = true;
          $('inp-ct-nome').value = ct.nome || '';
          renderizarCabecalhoConversa();
          renderizarPainelContato();
          await carregarConversas({ silencioso: true });
          TalkUI.toast('Nome do contato atualizado.', 'ok');
        } catch (err) {
          if (err?.status === 401) return;
          if (!TalkUI.errosNoFormulario(form, err)) TalkUI.toast(err.message, 'erro');
        }
      }
    });

    // ── Navegação e layout híbrido (gaveta 761–1279 px / sheet <= 760 px)
    $('lista-visoes').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-visao]');
      if (!btn) return;
      visaoAtual = btn.dataset.visao;
      renderizarContadores();
      carregarConversas();
      definirPassoMobile('lista');
    });

    $('lista-setores').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-setor]');
      if (!btn) return;
      setorAtualId = btn.dataset.setor;
      renderizarContadores();
      carregarConversas();
      definirPassoMobile('lista');
    });

    $('lista-conversas').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-conversa-id]');
      if (btn) abrirConversa(btn.dataset.conversaId);
    });

    $('lista-mensagens').addEventListener('click', (e) => {
      if (e.target.closest('#btn-mais-itens')) carregarMaisItens();
    });

    $('campo-busca').addEventListener('input', () => {
      clearTimeout(timerBusca);
      timerBusca = setTimeout(() => {
        buscaAtual = $('campo-busca').value.trim();
        carregarConversas();
      }, 250);
    });

    $('btn-mais-conversas').addEventListener('click', () => carregarConversas({ continuar: true }));
    $('btn-mobile-setores').addEventListener('click', () => aplicarResumoRecolhido(!$('painel-resumo-topo').classList.contains('recolhido'), { salvar: false }));
    $('btn-mobile-lista').addEventListener('click', () => definirPassoMobile('lista'));

    // ── Controles retráteis (cartões de topo, lista compacta e setinha mágica do contato)
    function lerPref(chave) {
      try { return localStorage.getItem(chave) === '1'; } catch (_) { return false; }
    }
    function salvarPref(chave, ativo) {
      try { localStorage.setItem(chave, ativo ? '1' : '0'); } catch (_) { /* navegador sem storage */ }
    }

    function aplicarResumoRecolhido(recolhido, { salvar = true } = {}) {
      const topo = $('painel-resumo-topo');
      const corpo = $('atd-cards-corpo');
      const btn = $('btn-toggle-resumo');
      const resumoInline = $('btn-resumo-inline');
      topo.classList.toggle('recolhido', recolhido);
      corpo.hidden = recolhido;
      resumoInline.hidden = !recolhido;
      btn.setAttribute('aria-expanded', String(!recolhido));
      const dica = recolhido
        ? 'Expandir os cartões numéricos de visões e setores'
        : 'Recolher os cartões de visões e setores para ampliar a conversa';
      btn.title = dica;
      btn.setAttribute('aria-label', dica);
      if (salvar) salvarPref(KEY_RESUMO_RECOLHIDO, recolhido);
    }

    function aplicarListaCompacta(compacta, { salvar = true } = {}) {
      $('workspace').classList.toggle('lista-compacta', compacta);
      const btn = $('btn-seta-lista');
      if (btn) {
        btn.setAttribute('aria-expanded', String(!compacta));
        btn.classList.toggle('recolhida', compacta);
        const dica = compacta
          ? 'Expandir a lista de conversas para ver prévia e busca'
          : 'Recolher lista de conversas para avatares compactos';
        btn.title = dica;
        btn.setAttribute('aria-label', dica);
      }
      if (salvar) salvarPref(KEY_LISTA_COMPACTA, compacta);
    }

    function atualizarBotoesLateral() {
      const ws = $('workspace');
      const aberta = mqDesktopGrande.matches
        ? !ws.classList.contains('lateral-recolhida')
        : ws.classList.contains('gaveta-aberta');
      $('btn-gaveta').setAttribute('aria-expanded', String(aberta));
      const seta = $('btn-seta-lateral');
      if (seta) {
        seta.setAttribute('aria-expanded', String(aberta));
        seta.classList.toggle('recolhida', !aberta);
        const dica = aberta
          ? 'Recolher painel do contato e detalhes para ampliar a conversa'
          : 'Expandir painel do contato e detalhes';
        seta.title = dica;
        seta.setAttribute('aria-label', dica);
      }
    }

    function alternarLateralDesktop(recolher, { salvar = true } = {}) {
      if (mqDesktopGrande.matches) {
        const ws = $('workspace');
        const prox = typeof recolher === 'boolean' ? recolher : !ws.classList.contains('lateral-recolhida');
        ws.classList.toggle('lateral-recolhida', prox);
        if (salvar) salvarPref(KEY_LATERAL_RECOLHIDA, prox);
        atualizarBotoesLateral();
      } else {
        alternarGaveta(typeof recolher === 'boolean' ? !recolher : undefined);
      }
    }

    function alternarGaveta(forcar) {
      $('workspace').classList.toggle('gaveta-aberta', forcar);
      atualizarBotoesLateral();
    }
    function alternarSheet(abrir) {
      $('painel-lateral').classList.toggle('sheet-aberta', abrir);
      $('sheet-backdrop').classList.toggle('aberto', abrir);
    }

    $('btn-toggle-resumo').addEventListener('click', () => {
      aplicarResumoRecolhido(!$('painel-resumo-topo').classList.contains('recolhido'));
    });
    $('btn-resumo-inline').addEventListener('click', () => aplicarResumoRecolhido(false));
    $('btn-seta-lista').addEventListener('click', () => {
      aplicarListaCompacta(!$('workspace').classList.contains('lista-compacta'));
    });
    $('btn-seta-lateral').addEventListener('click', () => alternarLateralDesktop());
    $('btn-gaveta').addEventListener('click', () => alternarGaveta());
    $('btn-abrir-sheet').addEventListener('click', () => alternarSheet(true));
    $('btn-fechar-lateral').addEventListener('click', () => {
      if (mqDesktopGrande.matches) alternarLateralDesktop(true);
      alternarGaveta(false);
      alternarSheet(false);
    });
    $('sheet-backdrop').addEventListener('click', () => alternarSheet(false));
    mqDesktopGrande.addEventListener('change', atualizarBotoesLateral);

    // Restaura preferências de recolhimento salvas no navegador (padrão: tudo expandido).
    aplicarResumoRecolhido(lerPref(KEY_RESUMO_RECOLHIDO), { salvar: false });
    aplicarListaCompacta(lerPref(KEY_LISTA_COMPACTA), { salvar: false });
    if (lerPref(KEY_LATERAL_RECOLHIDA)) $('workspace').classList.add('lateral-recolhida');
    atualizarBotoesLateral();

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.atd-chat-acoes')) fecharPopovers();
      if (!e.target.closest('#compositor')) fecharSlashMenu();
    });

    // ── Atualização manual com giro (padrão G10) ────────────────────────
    async function comGiro(botao, fn) {
      if (botao.classList.contains('tlk-btn-girando')) return;
      botao.classList.add('tlk-btn-girando');
      botao.disabled = true;
      try {
        await Promise.all([fn(), new Promise((r) => setTimeout(r, 500))]);
      } finally {
        botao.classList.remove('tlk-btn-girando');
        botao.disabled = false;
      }
    }

    async function recarregarTudo() {
      const tarefas = [carregarContadores(), carregarConversas({ silencioso: true }), recarregarConversaAtual()];
      if (aoRecarregar) tarefas.push(Promise.resolve().then(() => aoRecarregar()).catch(() => {}));
      await Promise.all(tarefas);
    }

    $('btn-atualizar').addEventListener('click', (e) => comGiro(e.currentTarget, recarregarTudo));

    // ── Tempo real (Socket.IO + fallback 5 s) ───────────────────────────
    function atualizarBadgeTempoReal(modo) {
      const badge = $('rt-badge');
      badge.classList.remove('atd-rt-badge--ok', 'atd-rt-badge--fallback');
      if (modo === 'socket') {
        badge.classList.add('atd-rt-badge--ok');
        $('rt-texto').textContent = 'Tempo real ativo';
      } else {
        badge.classList.add('atd-rt-badge--fallback');
        $('rt-texto').textContent = 'Sem socket · 5 s';
      }
    }

    function pararFallback() {
      if (timerFallback) clearInterval(timerFallback);
      timerFallback = null;
    }

    function iniciarFallback() {
      atualizarBadgeTempoReal('fallback');
      if (timerFallback) return;
      timerFallback = setInterval(async () => {
        try {
          await recarregarTudo();
        } catch (_) {}
      }, POLL_FALLBACK_MS);
    }

    function iniciarTempoReal() {
      if (socket || typeof window.io !== 'function') { iniciarFallback(); return; }
      try {
        socket = TalkApi.socket();
      } catch (_) {
        iniciarFallback();
        return;
      }

      if (aoSocket) aoSocket(socket);

      socket.on('connect', () => {
        pararFallback();
        atualizarBadgeTempoReal('socket');
        socket.emit('atendimento:assinar', {});
        if (conversaAssinadaId) socket.emit('conversa:assinar', { conversa_id: conversaAssinadaId });
        recarregarTudo().catch(() => {});
      });

      socket.on('disconnect', () => iniciarFallback());
      socket.on('connect_error', () => iniciarFallback());

      socket.on('atendimento:contadores', (c) => {
        if (modoAtendenteSimulado()) {
          carregarContadores().catch(() => {});
          return;
        }
        if (c && typeof c === 'object') {
          contadores = c;
          renderizarContadores();
        }
      });

      socket.on('conversa:atualizada', (resumo) => {
        if (!resumo?.id) return;
        if (modoAtendenteSimulado()) {
          carregarConversas({ silencioso: true }).catch(() => {});
        } else {
          sincronizarConversaNaLista(resumo);
        }
        if (!conversaAtual || conversaAtual.id !== resumo.id || resumo.id === encerrandoConversaId) return;
        recarregarConversaAtual({ rolarFim: false });
      });

      socket.on('conversa:saiu', ({ id } = {}) => {
        if (!id) return;
        conversas = conversas.filter((c) => c.id !== id);
        renderizarListaConversas();
        if (conversaAtual?.id === id) {
          conversaSeq += 1;
          conversaAtual = null;
          itensConversa = [];
          assinarConversaSocket(null);
          renderizarCabecalhoConversa();
          renderizarPainelContato();
          TalkUI.toast('Esta conversa não está mais visível para você.', 'info');
        }
      });

      socket.on('conversa:item', ({ conversa_id, item } = {}) => {
        if (!conversaAtual || conversa_id !== conversaAtual.id || conversa_id === encerrandoConversaId || !item?.id) return;
        if (!itensConversa.some((i) => i.id === item.id)) {
          itensConversa.push(item);
          renderizarItensConversa({ rolarFim: true });
        }
      });

      socket.on('conversa:item_estado', ({ conversa_id, item_id, estado } = {}) => {
        if (!conversaAtual || conversa_id !== conversaAtual.id || conversa_id === encerrandoConversaId || !item_id) return;
        const alvo = itensConversa.find((i) => i.id === item_id);
        if (alvo) alvo.estado = estado;
        const badge = document.querySelector(`[data-item-estado="${CSS.escape(item_id)}"]`);
        if (badge) badge.innerHTML = pill(estado);
      });
    }

    function mostrarErroGlobal(err) {
      $('painel-resumo-topo').hidden = true;
      $('workspace').hidden = true;
      TalkUI.estadoDoErro($('estado-global'), err, () => arrancar());
    }

    window.addEventListener('beforeunload', () => {
      pararFallback();
      pararTimerOferta();
      if (socket) {
        if (conversaAssinadaId) {
          try { socket.emit('conversa:sair', { conversa_id: conversaAssinadaId }); } catch (_) {}
        }
        try { socket.disconnect(); } catch (_) {}
        socket = null;
      }
    });

    // ── Inicialização ───────────────────────────────────────────────────
    async function arrancar() {
      $('estado-global').hidden = true;
      $('painel-resumo-topo').hidden = false;
      $('workspace').hidden = false;
      renderizarCabecalhoConversa();
      renderizarPainelContato();

      try {
        sessao = await api.get('/sessao');
        resolverUsuarioEfetivo();
        if (aoSessao) {
          const continuar = await aoSessao(sessao);
          if (continuar === false) return;
        }
        await Promise.all([carregarSetores(), carregarContadores()]);
        resolverUsuarioEfetivo();
        await carregarConversas();
        iniciarTempoReal();

        if (conversaInicialUrl) {
          await abrirConversa(conversaInicialUrl);
        } else if (conversas.length && window.matchMedia('(min-width: 761px)').matches) {
          await abrirConversa(conversas[0].id, { irParaChatMobile: false });
        }
      } catch (err) {
        if (err?.status === 401 && ao401) return;
        mostrarErroGlobal(err);
      }
    }

    arrancar();

    return {
      api,
      abrirConversa,
      recarregarTudo,
      obterSessao: () => sessao,
      obterUsuarioEfetivo: () => usuarioEfetivo,
    };
  }

  window.CentralAtendimento = { iniciar };
})();
