// IA Talk · Etapa G23 — utilitários de exibição, validação e download de mídia (§10).
// Compartilhado entre Central de Atendimento (atendimento.html), Portal do atendente
// (portal.html) e Histórico de mensagens (mensagens.html).
(function () {
  const MAX_BYTES = 16 * 1024 * 1024;
  const MAX_LEGENDA = 1024;
  const EXTENSOES_ACEITAS = new Set([
    'png', 'jpg', 'jpeg', 'webp',
    'pdf', 'docx', 'xlsx', 'csv', 'txt',
    'ogg', 'mp3',
  ]);
  const MIME_PARA_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
  };

  const MOTIVOS_INDISPONIVEL = {
    expirado: 'Arquivo expirado (prazo de guarda).',
    grande: 'Arquivo grande demais (mais de 16 MB): não foi recebido.',
    recusado: 'Arquivo recusado por segurança.',
    falhou: 'O WhatsApp não entregou o arquivo.',
  };

  const esc = (v) => window.TalkUI.esc(v);

  /**
   * Formata bytes para leitura humana (ex.: 183422 -> "183 KB", 1572864 -> "1,5 MB").
   * @param {number} bytes Quantidade de bytes.
   * @returns {string}
   */
  function formatarTamanho(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (n < 1024) return `${n} B`;
    const kb = n / 1024;
    if (kb < 10) return `${kb.toFixed(1).replace('.', ',')} KB`;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  }

  /**
   * Classifica tipo visual, ícone e comportamento de abertura de um anexo.
   * @param {{ mime?: string, nome?: string, tipo?: string }} d Metadados do arquivo.
   */
  function classificarArquivo(d = {}) {
    const mime = String(d.mime || '').toLowerCase();
    const nome = String(d.nome || '').toLowerCase();
    const ext = nome.includes('.') ? nome.split('.').pop() : '';

    if (d.tipo === 'imagem' || mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      return { categoria: 'imagem', rotulo: 'Imagem', icone: 'imagem', classeIco: '', abreNoNavegador: true, ehPdf: false };
    }
    if (d.tipo === 'audio' || mime.startsWith('audio/') || ['ogg', 'mp3', 'wav', 'm4a'].includes(ext)) {
      return { categoria: 'audio', rotulo: 'Áudio', icone: 'microfone', classeIco: '', abreNoNavegador: true, ehPdf: false };
    }
    if (mime === 'application/pdf' || ext === 'pdf') {
      return { categoria: 'documento', rotulo: 'PDF', icone: 'arquivo', classeIco: 'atd-midia-doc-ico--pdf', abreNoNavegador: true, ehPdf: true };
    }
    if (mime.includes('wordprocessingml') || ext === 'docx' || ext === 'doc') {
      return { categoria: 'documento', rotulo: 'Word', icone: 'arquivo', classeIco: 'atd-midia-doc-ico--word', abreNoNavegador: false, ehPdf: false };
    }
    if (mime.includes('spreadsheetml') || mime === 'text/csv' || ext === 'xlsx' || ext === 'csv') {
      return { categoria: 'documento', rotulo: ext === 'csv' || mime === 'text/csv' ? 'CSV' : 'Excel', icone: 'planilha', classeIco: 'atd-midia-doc-ico--excel', abreNoNavegador: false, ehPdf: false };
    }
    if (mime === 'text/plain' || ext === 'txt') {
      return { categoria: 'documento', rotulo: 'Texto', icone: 'arquivo', classeIco: '', abreNoNavegador: false, ehPdf: false };
    }
    return { categoria: 'documento', rotulo: 'Documento', icone: 'arquivo', classeIco: '', abreNoNavegador: false, ehPdf: false };
  }

  /**
   * Monta a URL administrativa de GET /midias/:id preservando ?simular= quando ativo na página.
   */
  function urlMidia(id, { baixar = false, simular = '' } = {}) {
    const params = {};
    if (baixar) params.baixar = '1';
    if (simular) params.simular = simular;
    return `${window.TalkApi.BASE}/api/admin/midias/${encodeURIComponent(id)}${window.TalkApi.montarQuery(params)}`;
  }

  /**
   * Valida um File no navegador antes de entrar na fila de envio (extensão e limite de 16 MB).
   * @param {File} arquivo Objeto File selecionado, arrastado ou colado.
   */
  function validarArquivoCliente(arquivo) {
    if (!arquivo) return { ok: false, mensagem: 'Escolha um arquivo válido.' };
    let nome = String(arquivo.name || '').trim();
    if (!nome || !nome.includes('.')) {
      const extDeduzida = MIME_PARA_EXT[String(arquivo.type || '').toLowerCase()];
      if (extDeduzida) nome = `colado-${Date.now()}.${extDeduzida}`;
    }
    const partes = nome.split('.');
    const ext = partes.length > 1 ? partes.pop().toLowerCase() : '';
    if (!EXTENSOES_ACEITAS.has(ext)) {
      return {
        ok: false,
        mensagem: 'Este tipo de arquivo não é aceito. Use: png, jpg, jpeg, webp, pdf, docx, xlsx, csv, txt, ogg ou mp3.',
      };
    }
    if (arquivo.size > MAX_BYTES) {
      return { ok: false, mensagem: 'O arquivo passa de 16 MB.' };
    }
    if (arquivo.size <= 0) {
      return { ok: false, mensagem: 'O arquivo está vazio.' };
    }
    const ehImagem = ['png', 'jpg', 'jpeg', 'webp'].includes(ext);
    return { ok: true, nome, ext, ehImagem };
  }

  /**
   * Abre ou baixa GET /midias/:id tratando erros 410 e 404 com mensagens amigáveis (§10.3).
   */
  async function abrirOuBaixar(id, nome, { baixar = false, simular = '' } = {}) {
    if (!id) return;
    const url = urlMidia(id, { baixar, simular });
    const headers = {};
    try {
      const sim = sessionStorage.getItem('talk_simular');
      if (sim) headers['X-Talk-Simular'] = sim;
    } catch (_) {}

    try {
      const resp = await fetch(url, { method: 'GET', headers, credentials: 'same-origin', cache: 'no-store' });
      if (resp.status === 410) {
        window.TalkUI.toast('Este arquivo não está mais disponível.', 'erro');
        return;
      }
      if (resp.status === 404) {
        window.TalkUI.toast('Arquivo não encontrado.', 'erro');
        return;
      }
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => null);
        window.TalkUI.toast(corpo?.erro?.mensagem || 'Não foi possível acessar o arquivo.', 'erro');
        return;
      }
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      if (baixar) {
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = nome || id;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
      } else {
        window.open(blobUrl, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      }
    } catch (_) {
      window.TalkUI.toast('Não foi possível acessar o arquivo. Confira a conexão.', 'erro');
    }
  }

  /**
   * Renderiza o bloco HTML de mídia (e legenda abaixo, quando existir) de um item de conversa.
   * @param {object} it Item da conversa (itemConversa).
   * @param {{ simular?: string }} [opcoes]
   * @returns {string}
   */
  function renderizarConteudoMensagemComMidia(it, { simular = '' } = {}) {
    const md = it?.midia;
    if (!md) {
      return it?.texto ? `<div class="atd-msg-texto">${esc(it.texto)}</div>` : '';
    }

    const legendaHtml = it.texto ? `<div class="atd-msg-texto atd-msg-legenda">${esc(it.texto)}</div>` : '';

    if (md.disponivel === false) {
      const textoMotivo = MOTIVOS_INDISPONIVEL[md.motivo] || MOTIVOS_INDISPONIVEL.expirado;
      const metaPartes = [];
      if (md.voz) metaPartes.push('Mensagem de voz');
      else if (md.nome) metaPartes.push(md.nome);
      if (md.tamanho > 0) metaPartes.push(formatarTamanho(md.tamanho));
      const ico = md.voz ? 'microfone' : classificarArquivo({ mime: md.mime, nome: md.nome, tipo: it.tipo }).icone;
      return `<div class="atd-midia-bloco">
        <div class="atd-midia-indisponivel" data-midia-indisponivel="${esc(md.motivo || 'expirado')}">
          <span class="atd-midia-indisponivel-ico" aria-hidden="true">${window.TalkIcones.svg(ico)}</span>
          <div class="atd-midia-indisponivel-corpo">
            <span class="atd-midia-indisponivel-motivo">${esc(textoMotivo)}</span>
            ${metaPartes.length ? `<span class="atd-midia-indisponivel-meta">${esc(metaPartes.join(' · '))}</span>` : ''}
          </div>
        </div>
        ${legendaHtml}
      </div>`;
    }

    const info = classificarArquivo({ mime: md.mime, nome: md.nome, tipo: it.tipo });
    const srcInline = urlMidia(md.id, { baixar: false, simular });
    const tamTxt = formatarTamanho(md.tamanho);
    const nomeArq = md.nome || 'arquivo';

    if (info.categoria === 'imagem') {
      return `<div class="atd-midia-bloco">
        <div class="atd-midia-img-wrap">
          <button type="button" class="atd-midia-thumb-btn" data-ampliar-midia="${esc(md.id)}" data-midia-nome="${esc(nomeArq)}" title="Clique para ampliar ${esc(nomeArq)}" aria-label="Ampliar imagem ${esc(nomeArq)}">
            <img class="atd-midia-thumb" src="${esc(srcInline)}" alt="${esc(nomeArq)}" loading="lazy">
          </button>
          <div class="atd-midia-img-acoes">
            <span class="atd-midia-img-meta" title="${esc(nomeArq)}">${esc(tamTxt)}</span>
            <button type="button" class="btn btn-ghost btn-sm" data-acao-midia="baixar" data-midia-id="${esc(md.id)}" data-midia-nome="${esc(nomeArq)}" title="Baixar ${esc(nomeArq)}" aria-label="Baixar ${esc(nomeArq)}">${window.TalkIcones.svg('download')} Baixar</button>
          </div>
        </div>
        ${legendaHtml}
      </div>`;
    }

    if (info.categoria === 'audio') {
      const cab = md.voz
        ? `<span class="atd-midia-voz-rotulo">${window.TalkIcones.svg('microfone')} Mensagem de voz</span>`
        : `<span class="atd-midia-voz-rotulo">${window.TalkIcones.svg('som_on')} ${esc(nomeArq)}</span>`;
      return `<div class="atd-midia-bloco">
        <div class="atd-midia-audio-wrap">
          <div class="atd-midia-voz-cab">
            ${cab}
            <span class="atd-midia-audio-tam">${esc(tamTxt)}</span>
          </div>
          <audio class="atd-midia-audio" controls preload="none" src="${esc(srcInline)}"></audio>
        </div>
        ${legendaHtml}
      </div>`;
    }

    return `<div class="atd-midia-bloco">
      <div class="atd-midia-doc">
        <div class="atd-midia-doc-ico ${esc(info.classeIco)}" aria-hidden="true">${window.TalkIcones.svg(info.icone)}</div>
        <div class="atd-midia-doc-info">
          <span class="atd-midia-doc-nome" title="${esc(nomeArq)}">${esc(nomeArq)}</span>
          <span class="atd-midia-doc-sub">${esc(info.rotulo)} · ${esc(tamTxt)}</span>
        </div>
        <div class="atd-midia-doc-acoes">
          ${info.ehPdf ? `<button type="button" class="btn btn-ghost btn-sm" data-acao-midia="abrir" data-midia-id="${esc(md.id)}" data-midia-nome="${esc(nomeArq)}" title="Abrir PDF ${esc(nomeArq)}" aria-label="Abrir PDF ${esc(nomeArq)}">${window.TalkIcones.svg('externo')} Abrir</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-acao-midia="baixar" data-midia-id="${esc(md.id)}" data-midia-nome="${esc(nomeArq)}" title="Baixar ${esc(nomeArq)}" aria-label="Baixar ${esc(nomeArq)}">${window.TalkIcones.svg('download')} Baixar</button>
        </div>
      </div>
      ${legendaHtml}
    </div>`;
  }

  /**
   * Renderiza a lista de anexos no detalhe do Histórico de mensagens (GET /mensagens/:id).
   */
  function renderizarListaAnexosHistorico(anexos = []) {
    return anexos.map((a) => {
      const nomeArq = a.nome || a.id || 'arquivo';
      const info = classificarArquivo({ mime: a.mime, nome: nomeArq });
      const tamTxt = formatarTamanho(a.tamanho);
      return `<li class="tlk-anexo tlk-anexo-rico">
        <div class="tlk-anexo-esq">
          <div class="atd-midia-doc-ico ${esc(info.classeIco)}" aria-hidden="true">${window.TalkIcones.svg(info.icone)}</div>
          <div class="atd-midia-doc-info">
            <strong class="atd-midia-doc-nome" title="${esc(nomeArq)}">${esc(nomeArq)}</strong>
            <span class="tlk-anexo-meta">${esc(info.rotulo)}${a.mime ? ` (${esc(a.mime)})` : ''} · ${esc(tamTxt)}</span>
          </div>
        </div>
        <div class="tlk-anexo-acoes">
          ${info.abreNoNavegador ? `<button type="button" class="btn btn-ghost btn-sm" data-acao-midia="abrir" data-midia-id="${esc(a.id)}" data-midia-nome="${esc(nomeArq)}" title="Abrir ${esc(nomeArq)}" aria-label="Abrir ${esc(nomeArq)}">${window.TalkIcones.svg('externo')} Abrir</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-acao-midia="baixar" data-midia-id="${esc(a.id)}" data-midia-nome="${esc(nomeArq)}" title="Baixar ${esc(nomeArq)}" aria-label="Baixar ${esc(nomeArq)}">${window.TalkIcones.svg('download')} Baixar</button>
        </div>
      </li>`;
    }).join('');
  }

  window.TalkMidia = {
    MAX_BYTES,
    MAX_LEGENDA,
    EXTENSOES_ACEITAS,
    MOTIVOS_INDISPONIVEL,
    formatarTamanho,
    classificarArquivo,
    urlMidia,
    validarArquivoCliente,
    abrirOuBaixar,
    renderizarConteudoMensagemComMidia,
    renderizarListaAnexosHistorico,
  };
})();
