// IA Talk · Etapa A0 — Motor compartilhado do protótipo da Central de Atendimento.
// Atende alternativa-a.html (4 áreas) e alternativa-b.html (3 áreas + gaveta),
// com dados 100% simulados (dados.js), sem chamadas de escrita reais.
(function () {
  const { esc, pill } = TalkUI;
  const {
    SETORES,
    VISOES,
    ATENDENTES,
    CANAIS,
    RESPOSTAS_RAPIDAS,
    criarConversasIniciais,
    melhorarTextoSimulado,
  } = window.CentralDados;

  function iniciarCentral({ modo }) {
    const $ = (id) => document.getElementById(id);

    const estado = {
      modo, // 'a' | 'b'
      cenario: new URLSearchParams(location.search).get('cenario') || 'normal',
      visao: 'todas',
      setor: '',
      busca: '',
      conversas: criarConversasIniciais(),
      ativaId: 'conv_01',
      modoCompositor: 'cliente', // 'cliente' | 'nota'
      gavetaAberta: false, // desktop alternativa B
      sheetAberta: false, // mobile (<= 760px)
      passoMobile: modo === 'a' ? 'lista' : 'lista', // setores -> lista -> chat
      abaLateral: 'contato', // 'contato' | 'ia'
      slashIndice: 0,
      slashItens: [],
      iaResultado: null, // { tipo, titulo, texto, podeInserir }
    };

    // Permite abrir diretamente em uma etapa mobile via query string (?passo=setores|lista|chat&sheet=1)
    const qs = new URLSearchParams(location.search);
    if (['setores', 'lista', 'chat'].includes(qs.get('passo'))) {
      estado.passoMobile = qs.get('passo');
    }
    if (qs.get('gaveta') === '1') estado.gavetaAberta = true;
    if (qs.get('sheet') === '1') estado.sheetAberta = true;
    if (qs.get('aba') === 'ia') estado.abaLateral = 'ia';
    if (qs.get('conv')) estado.ativaId = qs.get('conv');

    const nomeSetor = (id) => SETORES.find((s) => s.id === id)?.nome || id;
    const nomeAtendente = (id) => ATENDENTES.find((a) => a.id === id)?.nome || 'Sem dono';
    const iniciais = (nome) => String(nome || '?').split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

    function canalEfetivo(conv) {
      const base = CANAIS[conv.canal_id] || CANAIS.cn_suporte;
      if (estado.cenario === 'desconectado') {
        return { ...base, estado: 'desconectado' };
      }
      return base;
    }

    function conversasFiltradas() {
      if (estado.cenario === 'vazio') return [];
      const termo = estado.busca.trim().toLowerCase();
      return estado.conversas.filter((c) => {
        if (estado.visao === 'minhas' && (c.atendente_id !== 'usr_carla' || c.situacao !== 'aberta')) return false;
        if (estado.visao === 'sem_dono' && (c.atendente_id !== null || c.situacao !== 'aberta')) return false;
        if (estado.visao === 'todas' && c.situacao !== 'aberta') return false;
        if (estado.visao === 'encerradas' && c.situacao !== 'encerrada') return false;
        if (estado.setor && c.setor_id !== estado.setor) return false;
        if (termo) {
          const ultima = c.mensagens[c.mensagens.length - 1]?.texto || '';
          const alvo = `${c.cliente} ${c.empresa_cliente} ${c.telefone_mascarado} ${ultima}`.toLowerCase();
          if (!alvo.includes(termo)) return false;
        }
        return true;
      });
    }

    function conversaAtiva() {
      const lista = conversasFiltradas();
      const encontrada = lista.find((c) => c.id === estado.ativaId);
      if (encontrada) return encontrada;
      if (lista.length) {
        estado.ativaId = lista[0].id;
        return lista[0];
      }
      return null;
    }

    // ── Tema claro/escuro ──────────────────────────────────────────────
    function atualizarBotaoTema() {
      const escuro = document.documentElement.getAttribute('data-theme') === 'dark';
      $('btn-tema').textContent = escuro ? '☀️ Claro' : '🌙 Escuro';
    }
    $('btn-tema').addEventListener('click', () => {
      const escuro = document.documentElement.getAttribute('data-theme') === 'dark';
      if (escuro) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', 'dark');
      try { localStorage.setItem('talk_tema', escuro ? 'light' : 'dark'); } catch (_) {}
      atualizarBotaoTema();
    });

    // ── Seletor de cenários simulados ──────────────────────────────────
    $('sel-cenario').value = estado.cenario;
    $('sel-cenario').addEventListener('change', () => {
      estado.cenario = $('sel-cenario').value;
      renderizarTudo();
    });

    // ── Setores / visões (Coluna 1 na A; filtros no topo na B) ─────────
    function contarVisao(vId) {
      if (estado.cenario === 'vazio') return 0;
      return estado.conversas.filter((c) => {
        if (vId === 'minhas') return c.atendente_id === 'usr_carla' && c.situacao === 'aberta';
        if (vId === 'sem_dono') return c.atendente_id === null && c.situacao === 'aberta';
        if (vId === 'todas') return c.situacao === 'aberta';
        if (vId === 'encerradas') return c.situacao === 'encerrada';
        return false;
      }).length;
    }

    function contarSetor(sId) {
      if (estado.cenario === 'vazio') return 0;
      return estado.conversas.filter((c) => c.situacao === 'aberta' && (!sId || c.setor_id === sId)).length;
    }

    function renderizarNavegacaoSetores() {
      if (estado.modo === 'a' || estado.modo === 'hibrido') {
        const ulVisoes = $('lista-visoes');
        ulVisoes.innerHTML = VISOES.map((v) => `
          <li>
            <button type="button" class="cnt-nav-btn ${estado.visao === v.id ? 'ativo' : ''}" data-visao="${esc(v.id)}">
              <span class="cnt-nav-nome">${esc(v.nome)}</span>
              <span class="cnt-contador">${contarVisao(v.id)}</span>
            </button>
          </li>`).join('');
        ulVisoes.querySelectorAll('button[data-visao]').forEach((b) => {
          b.addEventListener('click', () => {
            estado.visao = b.dataset.visao;
            estado.passoMobile = 'lista';
            renderizarTudo();
          });
        });

        const ulSetores = $('lista-setores');
        ulSetores.innerHTML = [
          { id: '', nome: 'Todos os setores', icone: '📂' },
          ...SETORES,
        ].map((s) => `
          <li>
            <button type="button" class="cnt-nav-btn ${estado.setor === s.id ? 'ativo' : ''}" data-setor="${esc(s.id)}">
              <span class="cnt-nav-nome"><span aria-hidden="true">${s.icone}</span>${esc(s.nome)}</span>
              <span class="cnt-contador">${contarSetor(s.id)}</span>
            </button>
          </li>`).join('');
        ulSetores.querySelectorAll('button[data-setor]').forEach((b) => {
          b.addEventListener('click', () => {
            estado.setor = b.dataset.setor;
            estado.passoMobile = 'lista';
            renderizarTudo();
          });
        });
      } else {
        const chips = $('chips-visao-b');
        chips.innerHTML = VISOES.map((v) => `
          <button type="button" class="cnt-chip-btn ${estado.visao === v.id ? 'ativo' : ''}" data-visao="${esc(v.id)}">
            ${esc(v.nome.replace(' conversas', ''))} (${contarVisao(v.id)})
          </button>`).join('');
        chips.querySelectorAll('button[data-visao]').forEach((b) => {
          b.addEventListener('click', () => {
            estado.visao = b.dataset.visao;
            renderizarTudo();
          });
        });

        const selSetor = $('sel-setor-b');
        if (selSetor.options.length <= 1) {
          for (const s of SETORES) {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = `${s.icone} ${s.nome}`;
            selSetor.appendChild(opt);
          }
        }
        selSetor.value = estado.setor;
      }
    }

    // ── Lista de conversas ─────────────────────────────────────────────
    function renderizarListaConversas() {
      const lista = conversasFiltradas();
      const ul = $('lista-conversas');
      const boxVazio = $('estado-lista-vazio');
      const tituloLista = $('titulo-lista-conv');
      if (tituloLista) {
        const rotVisao = VISOES.find((v) => v.id === estado.visao)?.nome || 'Conversas';
        tituloLista.textContent = estado.setor ? `${rotVisao} · ${nomeSetor(estado.setor)}` : rotVisao;
      }

      if (!lista.length) {
        ul.innerHTML = '';
        ul.hidden = true;
        TalkUI.estado(boxVazio, 'vazio', {
          titulo: estado.cenario === 'vazio' ? 'Nenhuma conversa na fila' : 'Nenhuma conversa com este filtro',
          texto: estado.cenario === 'vazio'
            ? 'Quando um cliente enviar mensagem pelos canais conectados, a conversa aparecerá aqui.'
            : 'Limpe a busca ou troque de visão/setor para ver outros atendimentos.',
          acao: estado.cenario === 'vazio' ? undefined : {
            rotulo: 'Ver todas abertas',
            aoClicar: () => { estado.visao = 'todas'; estado.setor = ''; estado.busca = ''; $('campo-busca').value = ''; renderizarTudo(); },
          },
        });
        return;
      }

      boxVazio.hidden = true;
      ul.hidden = false;
      const ativa = conversaAtiva();
      ul.innerHTML = lista.map((c) => {
        const ultima = c.mensagens[c.mensagens.length - 1];
        const canal = canalEfetivo(c);
        const prefixo = ultima?.autor === 'nota' ? '🔒 Nota: ' : ultima?.autor === 'atendente' ? 'Você: ' : '';
        return `
          <li>
            <button type="button" class="cnt-conv-item ${ativa?.id === c.id ? 'ativa' : ''}" data-conv-id="${esc(c.id)}">
              <div class="cnt-conv-linha1">
                <span class="cnt-conv-nome">${esc(c.cliente)}</span>
                <span class="cnt-conv-hora">${esc(c.atualizada_em)}</span>
              </div>
              <div class="cnt-conv-previa">${esc(prefixo + (ultima?.texto || 'Sem mensagens'))}</div>
              <div class="cnt-conv-rodape">
                <span class="cnt-conv-tags">
                  <span class="cnt-tag-mini">${esc(nomeSetor(c.setor_id))}</span>
                  ${canal.estado !== 'conectado' ? '<span class="cnt-tag-mini cnt-tag-mini--alerta">Canal offline</span>' : ''}
                  ${!c.atendente_id ? '<span class="cnt-tag-mini">Sem dono</span>' : ''}
                </span>
                ${c.nao_lidas > 0 ? `<span class="cnt-nao-lidas" aria-label="${c.nao_lidas} não lidas">${c.nao_lidas}</span>` : ''}
              </div>
            </button>
          </li>`;
      }).join('');

      ul.querySelectorAll('button[data-conv-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          estado.ativaId = btn.dataset.convId;
          const conv = estado.conversas.find((x) => x.id === estado.ativaId);
          if (conv) conv.nao_lidas = 0;
          estado.iaResultado = null;
          estado.passoMobile = 'chat';
          fecharPopoverTransferir();
          renderizarTudo();
        });
      });
    }

    // ── Conversa ativa ─────────────────────────────────────────────────
    function fecharPopoverTransferir() {
      $('popover-transferir').hidden = true;
      $('btn-transferir')?.setAttribute('aria-expanded', 'false');
    }

    function renderizarChat() {
      const conv = conversaAtiva();
      const boxVazio = $('estado-chat-vazio');
      const wrap = $('chat-ativo');
      if (!conv) {
        wrap.hidden = true;
        TalkUI.estado(boxVazio, 'vazio', {
          titulo: 'Nenhuma conversa selecionada',
          texto: 'Escolha uma conversa na lista ao lado para visualizar o histórico e responder.',
        });
        return;
      }

      boxVazio.hidden = true;
      wrap.hidden = false;

      const canal = canalEfetivo(conv);
      const offline = canal.estado !== 'conectado';

      $('chat-avatar').textContent = iniciais(conv.cliente);
      $('chat-nome').innerHTML = `${esc(conv.cliente)} ${conv.situacao === 'encerrada' ? '<span class="tlk-pill tlk-pill--neutro">Encerrada</span>' : ''}`;
      $('chat-sub').innerHTML = `
        <span>${esc(conv.telefone_mascarado)}</span>
        <span>·</span>
        <span>${esc(canal.nome)} ${pill(canal.estado)}</span>
        <span>·</span>
        <span>${esc(nomeSetor(conv.setor_id))} (${esc(nomeAtendente(conv.atendente_id))})</span>`;

      const btnEnc = $('btn-encerrar');
      btnEnc.textContent = conv.situacao === 'encerrada' ? 'Reabrir' : 'Encerrar';
      btnEnc.className = conv.situacao === 'encerrada' ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm';

      // Popover de transferência em 1 clique
      $('popover-transferir').innerHTML = `
        <div class="cnt-popover-tit">Transferir para setor (1 clique)</div>
        ${SETORES.map((s) => `
          <button type="button" class="cnt-popover-item" data-transf-setor="${esc(s.id)}">
            <span>${s.icone} ${esc(s.nome)}</span>
            ${conv.setor_id === s.id ? '<span class="cnt-tag-mini">Atual</span>' : ''}
          </button>`).join('')}
        <div class="cnt-popover-tit">Ou atribuir a atendente</div>
        ${ATENDENTES.map((a) => `
          <button type="button" class="cnt-popover-item" data-transf-usr="${esc(a.id)}">
            <span>${esc(a.nome)}</span>
            <span class="cnt-tag-mini">${esc(nomeSetor(a.setor))}</span>
          </button>`).join('')}`;

      $('popover-transferir').querySelectorAll('[data-transf-setor]').forEach((b) => {
        b.addEventListener('click', () => {
          conv.setor_id = b.dataset.transfSetor;
          conv.mensagens.push({
            id: `m_${Date.now()}`,
            autor: 'nota',
            nome: 'Sistema (equipe)',
            hora: 'Agora',
            texto: `Conversa transferida para o setor ${nomeSetor(conv.setor_id)}.`,
          });
          fecharPopoverTransferir();
          TalkUI.toast(`Conversa transferida para ${nomeSetor(conv.setor_id)}.`, 'ok');
          renderizarTudo();
        });
      });
      $('popover-transferir').querySelectorAll('[data-transf-usr]').forEach((b) => {
        b.addEventListener('click', () => {
          const dest = ATENDENTES.find((a) => a.id === b.dataset.transfUsr);
          if (!dest) return;
          conv.atendente_id = dest.id;
          conv.setor_id = dest.setor;
          conv.mensagens.push({
            id: `m_${Date.now()}`,
            autor: 'nota',
            nome: 'Sistema (equipe)',
            hora: 'Agora',
            texto: `Atendimento atribuído para ${dest.nome} (${nomeSetor(dest.setor)}).`,
          });
          fecharPopoverTransferir();
          TalkUI.toast(`Atribuída para ${dest.nome}.`, 'ok');
          renderizarTudo();
        });
      });

      // Banner de canal desconectado
      const banner = $('banner-desconectado');
      banner.hidden = !offline;
      if (offline) {
        $('banner-canal-nome').textContent = `${canal.nome} (${canal.numero_mascarado})`;
      }

      // Mensagens + Notas internas
      const listaMsg = $('lista-mensagens');
      listaMsg.innerHTML = conv.mensagens.map((m) => {
        if (m.autor === 'nota') {
          return `
            <article class="cnt-msg cnt-msg--nota" aria-label="Nota interna da equipe">
              <div class="cnt-msg-head">
                <span class="cnt-msg-nota-selo">🔒 Nota interna · só equipe</span>
                <span>${esc(m.nome)} · ${esc(m.hora)}</span>
              </div>
              <div>${esc(m.texto)}</div>
            </article>`;
        }
        const classe = m.autor === 'atendente' ? 'cnt-msg--atendente' : 'cnt-msg--cliente';
        const recibo = m.autor === 'atendente' ? (m.status === 'lida' ? '✓✓ lida' : '✓ entregue') : '';
        return `
          <article class="cnt-msg ${classe}">
            <div class="cnt-msg-head">
              <strong>${esc(m.nome)}</strong>
              <span>${esc(m.hora)}</span>
            </div>
            <div>${esc(m.texto)}</div>
            ${recibo ? `<div class="cnt-msg-meta"><span>${esc(recibo)}</span></div>` : ''}
          </article>`;
      }).join('');
      listaMsg.scrollTop = listaMsg.scrollHeight;

      // Compositor (respeita modo cliente × nota interna e canal desconectado)
      const comp = $('compositor');
      const ehNota = estado.modoCompositor === 'nota';
      comp.classList.toggle('modo-nota', ehNota);
      $('btn-modo-cliente').classList.toggle('ativo', !ehNota);
      $('btn-modo-nota').classList.toggle('ativo', ehNota);
      $('btn-modo-cliente').setAttribute('aria-pressed', String(!ehNota));
      $('btn-modo-nota').setAttribute('aria-pressed', String(ehNota));

      const campo = $('campo-msg');
      const btnEnviar = $('btn-enviar');
      const bloqueado = offline && !ehNota;
      campo.disabled = bloqueado;
      btnEnviar.disabled = bloqueado;
      campo.placeholder = bloqueado
        ? 'Canal desconectado — alterne para "Nota interna" para registrar um aviso à equipe'
        : ehNota
          ? 'Escreva uma nota interna visível apenas para a equipe…'
          : 'Digite uma mensagem ou "/" para respostas rápidas…';
      btnEnviar.textContent = ehNota ? 'Salvar nota interna' : 'Enviar ao cliente';
      btnEnviar.className = ehNota ? 'btn btn-ghost' : 'btn btn-primary';
    }

    // ── Painel lateral (Contato + Assistente IA sem cobrir conversa) ───
    function renderizarLateral() {
      const conv = conversaAtiva();
      const ws = $('workspace');
      if (estado.modo === 'b' || estado.modo === 'hibrido') {
        ws.classList.toggle('gaveta-aberta', estado.gavetaAberta);
        const btnGav = $('btn-gaveta');
        if (btnGav) {
          btnGav.setAttribute('aria-expanded', String(estado.gavetaAberta));
          btnGav.textContent = estado.gavetaAberta ? 'Ocultar Contato / IA' : 'Contato · IA';
        }
      }
      $('painel-lateral').classList.toggle('sheet-aberta', estado.sheetAberta);
      $('sheet-backdrop').classList.toggle('aberto', estado.sheetAberta);

      // Abas Contato | IA
      const ehIa = estado.abaLateral === 'ia';
      $('aba-contato').setAttribute('aria-selected', String(!ehIa));
      $('aba-ia').setAttribute('aria-selected', String(ehIa));
      $('painel-contato').hidden = ehIa;
      $('painel-ia').hidden = !ehIa;

      if (!conv) {
        $('painel-contato').innerHTML = '<p class="form-hint">Selecione uma conversa para ver os dados do contato.</p>';
        return;
      }

      const canal = canalEfetivo(conv);
      $('painel-contato').innerHTML = `
        <div class="cnt-contato-card">
          <div class="cnt-info-bloco">
            <div class="cnt-info-tit">Contato</div>
            <div class="cnt-info-linha"><span>Nome</span><strong>${esc(conv.cliente)}</strong></div>
            <div class="cnt-info-linha"><span>Empresa</span><strong>${esc(conv.empresa_cliente)}</strong></div>
            <div class="cnt-info-linha"><span>Telefone (mascarado)</span><code>${esc(conv.telefone_mascarado)}</code></div>
            <div class="cnt-info-linha"><span>E-mail</span><strong>${esc(conv.email)}</strong></div>
          </div>
          <div class="cnt-info-bloco">
            <div class="cnt-info-tit">Atendimento atual</div>
            <div class="cnt-info-linha"><span>Setor</span><strong>${esc(nomeSetor(conv.setor_id))}</strong></div>
            <div class="cnt-info-linha"><span>Responsável</span><strong>${esc(nomeAtendente(conv.atendente_id))}</strong></div>
            <div class="cnt-info-linha"><span>Canal</span><strong>${esc(canal.nome)} ${pill(canal.estado)}</strong></div>
          </div>
          <div class="cnt-info-bloco">
            <div class="cnt-info-tit">Etiquetas</div>
            <div class="cnt-tags-wrap">${conv.etiquetas.map((t) => `<span class="cnt-tag-mini">${esc(t)}</span>`).join('')}</div>
          </div>
          <div class="cnt-info-bloco">
            <div class="cnt-info-tit">Atendimentos anteriores</div>
            ${conv.historico_anterior.length
              ? conv.historico_anterior.map((h) => `<div class="cnt-hist-item"><strong>${esc(h.protocolo)} · ${esc(h.assunto)}</strong><span>${esc(h.data)}</span></div>`).join('')
              : '<span class="form-hint">Primeiro atendimento registrado.</span>'}
          </div>
        </div>`;

      // Saída de IA
      const saida = $('ia-saida');
      if (!estado.iaResultado) {
        saida.hidden = true;
      } else {
        saida.hidden = false;
        $('ia-saida-tit').textContent = estado.iaResultado.titulo;
        $('ia-saida-texto').textContent = estado.iaResultado.texto;
        $('btn-ia-inserir').hidden = !estado.iaResultado.podeInserir;
      }
    }

    function abrirPainelIa() {
      estado.abaLateral = 'ia';
      if (window.innerWidth <= 760) estado.sheetAberta = true;
      else if (estado.modo === 'b' || (estado.modo === 'hibrido' && window.innerWidth < 1280)) estado.gavetaAberta = true;
      renderizarLateral();
    }

    function executarIa(tipo) {
      const conv = conversaAtiva();
      if (!conv) return;
      abrirPainelIa();
      if (tipo === 'resumo') {
        estado.iaResultado = { tipo, titulo: 'Resumo da conversa', texto: conv.resumo_ia, podeInserir: false };
      } else if (tipo === 'sugestao') {
        estado.iaResultado = { tipo, titulo: 'Sugestão de resposta', texto: conv.sugestao_ia, podeInserir: true };
      } else if (tipo === 'melhorar') {
        estado.iaResultado = {
          tipo,
          titulo: 'Texto melhorado para envio',
          texto: melhorarTextoSimulado($('campo-msg').value),
          podeInserir: true,
        };
      }
      renderizarLateral();
    }

    // ── Respostas rápidas com "/" ──────────────────────────────────────
    function atualizarMenuSlash() {
      const val = $('campo-msg').value;
      const menu = $('slash-menu');
      if (estado.modoCompositor !== 'cliente' || !val.startsWith('/')) {
        menu.hidden = true;
        estado.slashItens = [];
        return;
      }
      const termo = val.toLowerCase();
      estado.slashItens = RESPOSTAS_RAPIDAS.filter((r) =>
        r.atalho.toLowerCase().includes(termo) || r.titulo.toLowerCase().includes(termo.slice(1)));
      if (!estado.slashItens.length) {
        menu.hidden = true;
        return;
      }
      estado.slashIndice = Math.min(estado.slashIndice, estado.slashItens.length - 1);
      menu.hidden = false;
      menu.innerHTML = estado.slashItens.map((r, idx) => `
        <button type="button" class="cnt-slash-item ${idx === estado.slashIndice ? 'selecionado' : ''}" data-slash-idx="${idx}">
          <strong>${esc(r.atalho)} · ${esc(r.titulo)}</strong>
          <span>${esc(r.texto)}</span>
        </button>`).join('');
      menu.querySelectorAll('button[data-slash-idx]').forEach((b) => {
        b.addEventListener('click', () => aplicarRespostaRapida(Number(b.dataset.slashIdx)));
      });
    }

    function aplicarRespostaRapida(idx) {
      const item = estado.slashItens[idx];
      if (!item) return;
      $('campo-msg').value = item.texto;
      $('slash-menu').hidden = true;
      estado.slashItens = [];
      $('campo-msg').focus();
    }

    // ── Envio de mensagem ou nota interna ──────────────────────────────
    function enviarMensagem() {
      const conv = conversaAtiva();
      if (!conv) return;
      const texto = $('campo-msg').value.trim();
      if (!texto) return;
      const canal = canalEfetivo(conv);
      if (estado.modoCompositor === 'cliente' && canal.estado !== 'conectado') {
        TalkUI.toast('Canal desconectado. Use "Nota interna" ou reconecte o canal.', 'erro');
        return;
      }
      conv.mensagens.push({
        id: `m_${Date.now()}`,
        autor: estado.modoCompositor === 'nota' ? 'nota' : 'atendente',
        nome: 'Carla Souza',
        hora: 'Agora',
        status: estado.modoCompositor === 'nota' ? undefined : 'entregue',
        texto,
      });
      conv.atualizada_em = 'Agora';
      $('campo-msg').value = '';
      $('slash-menu').hidden = true;
      renderizarListaConversas();
      renderizarChat();
      TalkUI.toast(estado.modoCompositor === 'nota' ? 'Nota interna registrada para a equipe.' : 'Mensagem enviada (simulado).', 'ok');
    }

    // ── Renderização global (respeitando cenários) ─────────────────────
    function renderizarTudo() {
      const globalEl = $('estado-global');
      const ws = $('workspace');
      ws.dataset.passo = estado.passoMobile;

      if (estado.cenario === 'carregando') {
        ws.hidden = true;
        TalkUI.estado(globalEl, 'carregando', {
          titulo: 'Carregando central de atendimento…',
          texto: 'Buscando setores, filas abertas e estado dos canais.',
        });
        return;
      }
      if (estado.cenario === 'sem_permissao') {
        ws.hidden = true;
        TalkUI.estado(globalEl, 'sem_permissao', {
          titulo: 'Sem permissão para a Central',
          texto: 'Seu perfil atual (auditor) não tem acesso ao atendimento ao vivo. Fale com o administrador da empresa.',
        });
        return;
      }

      globalEl.hidden = true;
      ws.hidden = false;
      renderizarNavegacaoSetores();
      renderizarListaConversas();
      renderizarChat();
      renderizarLateral();
    }

    // ── Ligações de eventos ────────────────────────────────────────────
    $('campo-busca').addEventListener('input', () => {
      estado.busca = $('campo-busca').value;
      renderizarListaConversas();
      renderizarChat();
      renderizarLateral();
    });

    if ($('sel-setor-b')) {
      $('sel-setor-b').addEventListener('change', () => {
        estado.setor = $('sel-setor-b').value;
        renderizarTudo();
      });
    }

    $('btn-modo-cliente').addEventListener('click', () => { estado.modoCompositor = 'cliente'; renderizarChat(); });
    $('btn-modo-nota').addEventListener('click', () => { estado.modoCompositor = 'nota'; $('slash-menu').hidden = true; renderizarChat(); });

    $('btn-atalho-slash').addEventListener('click', () => {
      estado.modoCompositor = 'cliente';
      renderizarChat();
      if (!$('campo-msg').disabled) {
        $('campo-msg').value = '/';
        $('campo-msg').focus();
        atualizarMenuSlash();
      }
    });

    $('btn-melhorar-inline').addEventListener('click', () => executarIa('melhorar'));
    $('btn-ia-resumo').addEventListener('click', () => executarIa('resumo'));
    $('btn-ia-sugestao').addEventListener('click', () => executarIa('sugestao'));
    $('btn-ia-melhorar').addEventListener('click', () => executarIa('melhorar'));
    $('btn-ia-inserir').addEventListener('click', () => {
      if (!estado.iaResultado?.texto) return;
      estado.modoCompositor = 'cliente';
      renderizarChat();
      $('campo-msg').value = estado.iaResultado.texto;
      if (window.innerWidth <= 760) {
        estado.sheetAberta = false;
        renderizarLateral();
      }
      $('campo-msg').focus();
      TalkUI.toast('Texto inserido no rascunho.', 'ok');
    });

    $('campo-msg').addEventListener('input', atualizarMenuSlash);
    $('campo-msg').addEventListener('keydown', (e) => {
      if (estado.slashItens.length && !$('slash-menu').hidden) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          estado.slashIndice = (estado.slashIndice + 1) % estado.slashItens.length;
          atualizarMenuSlash();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          estado.slashIndice = (estado.slashIndice + estado.slashItens.length - 1) % estado.slashItens.length;
          atualizarMenuSlash();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          aplicarRespostaRapida(estado.slashIndice);
          return;
        }
        if (e.key === 'Escape') {
          $('slash-menu').hidden = true;
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        enviarMensagem();
      }
    });

    $('form-compositor').addEventListener('submit', (e) => { e.preventDefault(); enviarMensagem(); });

    // Transferir em 1 clique (abre popover)
    $('btn-transferir').addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = $('popover-transferir');
      const abrir = pop.hidden;
      pop.hidden = !abrir;
      $('btn-transferir').setAttribute('aria-expanded', String(abrir));
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#popover-transferir, #btn-transferir')) fecharPopoverTransferir();
    });

    // Encerrar / Reabrir em 1 clique
    $('btn-encerrar').addEventListener('click', () => {
      const conv = conversaAtiva();
      if (!conv) return;
      const reabrindo = conv.situacao === 'encerrada';
      conv.situacao = reabrindo ? 'aberta' : 'encerrada';
      conv.mensagens.push({
        id: `m_${Date.now()}`,
        autor: 'nota',
        nome: 'Sistema (equipe)',
        hora: 'Agora',
        texto: reabrindo ? 'Atendimento reaberto.' : 'Atendimento encerrado em 1 clique.',
      });
      TalkUI.toast(reabrindo ? 'Conversa reaberta.' : 'Conversa encerrada.', 'ok');
      renderizarTudo();
    });

    // Abas do painel lateral
    $('aba-contato').addEventListener('click', () => { estado.abaLateral = 'contato'; renderizarLateral(); });
    $('aba-ia').addEventListener('click', () => { estado.abaLateral = 'ia'; renderizarLateral(); });

    // Gaveta desktop (Alternativa B) e folha deslizante mobile (A e B)
    $('btn-gaveta')?.addEventListener('click', () => {
      estado.gavetaAberta = !estado.gavetaAberta;
      renderizarLateral();
    });
    $('btn-abrir-sheet')?.addEventListener('click', () => {
      estado.sheetAberta = true;
      renderizarLateral();
    });
    $('btn-fechar-lateral')?.addEventListener('click', () => {
      estado.sheetAberta = false;
      estado.gavetaAberta = false;
      renderizarLateral();
    });
    $('sheet-backdrop')?.addEventListener('click', () => {
      estado.sheetAberta = false;
      renderizarLateral();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        fecharPopoverTransferir();
        if (estado.sheetAberta) { estado.sheetAberta = false; renderizarLateral(); }
      }
    });

    // Navegação em sequência no celular (setores -> lista -> chat)
    $('btn-mobile-setores')?.addEventListener('click', () => { estado.passoMobile = 'setores'; renderizarTudo(); });
    $('btn-mobile-lista')?.addEventListener('click', () => { estado.passoMobile = 'lista'; renderizarTudo(); });

    atualizarBotaoTema();
    renderizarTudo();
  }

  window.CentralPrototipo = { iniciarCentral };
})();
