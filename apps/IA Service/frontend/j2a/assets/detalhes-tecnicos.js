(function () {
  'use strict';
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function disponivel(m) {
    const h = m?.diagnostico?.humanizacao;
    return m?.papel === 'assistant' && !!m.id && h?.status === 'aplicada' && h.estilo !== 'ORIGINAL'
      && typeof h.respostaOriginal === 'string' && !!h.respostaOriginal.trim()
      && typeof m.conteudo === 'string' && !!m.conteudo.trim() && !m.respostaOperacional?.qualityGateBloqueado;
  }
  function botao(m, classe) {
    return disponivel(m) ? `<button type="button" class="${escape(classe)}" data-detalhes-tecnicos="${escape(m.id)}" aria-expanded="false" title="Detalhes Técnicos"><span aria-hidden="true">📄</span> Detalhes Técnicos</button>` : '';
  }
  // HTML do conteúdo nunca é executado. O subconjunto de Markdown abaixo
  // apresenta o texto persistido, sem resumir, completar ou consultar a IA.
  function inline(texto) {
    const partes = String(texto).split(/(`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\))/g);
    return partes.map(p => {
      if (p.startsWith('`') && p.endsWith('`')) return `<code>${escape(p.slice(1, -1))}</code>`;
      const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link && /^https?:\/\//i.test(link[2])) return `<a href="${escape(link[2])}" target="_blank" rel="noopener noreferrer">${escape(link[1])}</a>`;
      return escape(p).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
    }).join('');
  }
  function markdown(texto) {
    const linhas = String(texto).replace(/\r\n/g, '\n').split('\n'), html = [];
    const celulas = linha => linha.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i], fence = linha.match(/^\s*(`{3,}|~{3,})(.*)$/);
      if (fence) {
        const bloco = [], fim = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`);
        while (++i < linhas.length && !fim.test(linhas[i])) bloco.push(linhas[i]);
        html.push(`<pre><code>${escape(bloco.join('\n'))}</code></pre>`);
      } else if (linha.includes('|') && /^\s*\|?\s*:?-{3,}/.test(linhas[i + 1] || '')) {
        const header = celulas(linha); i++;
        const rows = [];
        while (i + 1 < linhas.length && linhas[i + 1].includes('|') && linhas[i + 1].trim()) rows.push(celulas(linhas[++i]));
        html.push(`<div class="technical-table"><table><thead><tr>${header.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      } else if (/^\s*(?:[-*+] |\d+[.)] )/.test(linha)) {
        const ordered = /^\s*\d/.test(linha), tag = ordered ? 'ol' : 'ul', itens = [];
        const re = ordered ? /^\s*(\d+)[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
        const inicio = ordered ? Number(linha.match(re)[1]) : null;
        do {
          const m = linhas[i].match(re);
          itens.push(`<li>${inline(m[ordered ? 2 : 1])}</li>`);
          if (!re.test(linhas[i + 1] || '')) break;
          i++;
        } while (i < linhas.length);
        html.push(`<${tag}${ordered ? ` start="${inicio}"` : ''}>${itens.join('')}</${tag}>`);
      } else if (/^#{1,6}\s/.test(linha)) {
        const h = linha.match(/^(#{1,6})\s+(.*)$/); html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      } else html.push(linha.trim() ? `<div>${inline(linha)}</div>` : '<br>');
    }
    return html.join('');
  }
  function mount({ getMessage, getContext, onOpen, alignTo }) {
    const painel = document.createElement('aside');
    painel.className = 'retorno-panel technical-details-panel';
    painel.hidden = true;
    painel.setAttribute('role', 'dialog');
    painel.setAttribute('aria-label', 'Detalhes Técnicos');
    painel.innerHTML = '<header class="retorno-head"><div><h2>Detalhes Técnicos</h2><p data-technical-status hidden>Aprovada pelo Quality Gate</p></div><div class="technical-actions"><button type="button" class="technical-copy" data-technical-copy>Copiar</button><button type="button" class="technical-close" aria-label="Fechar Detalhes Técnicos">×</button></div></header><div class="retorno-scroll technical-markdown"></div>';
    document.body.append(painel);
    let origem = null, contexto = null;
    const conteudo = painel.querySelector('.retorno-scroll'), fechar = painel.querySelector('.technical-close'), copiar = painel.querySelector('[data-technical-copy]');
    let textoAtual = '', timerCopia = null;
    function close(foco = true) {
      if (painel.hidden) return;
      painel.hidden = true;
      conteudo.replaceChildren();
      document.body.classList.remove('retorno-open');
      origem?.setAttribute('aria-expanded', 'false');
      if (foco && origem?.isConnected) origem.focus();
      origem = contexto = null; textoAtual = '';
      resetCopia();
    }
    function resetCopia() { clearTimeout(timerCopia); copiar.textContent = 'Copiar'; }
    // Em HTTP (sem contexto seguro) navigator.clipboard não existe: usa-se um
    // textarea temporário com execCommand, acionado pelo clique do usuário.
    async function copiarTexto(texto) {
      try {
        if (window.isSecureContext && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(texto); return true; }
      } catch (_) { /* tenta alternativa */ }
      const ta = document.createElement('textarea');
      ta.value = texto; ta.setAttribute('readonly', ''); ta.setAttribute('aria-hidden', 'true');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      painel.append(ta);
      try { ta.select(); ta.setSelectionRange(0, texto.length); return document.execCommand('copy'); }
      catch (_) { return false; }
      finally { ta.remove(); }
    }
    function align() {
      const el = alignTo?.();
      if (!el || window.innerWidth <= 1100) { painel.style.top = painel.style.bottom = ''; return; }
      const r = el.getBoundingClientRect();
      painel.style.top = `${Math.round(r.top)}px`;
      painel.style.bottom = `${Math.round(window.innerHeight - r.bottom)}px`;
    }
    document.addEventListener('click', event => {
      const botao = event.target.closest('[data-detalhes-tecnicos]');
      if (!botao) return;
      const m = getMessage(botao.dataset.detalhesTecnicos), atual = getContext();
      if (!atual || !disponivel(m)) return;
      if (onOpen?.() === false) return;
      close(false);
      origem = botao; contexto = atual;
      textoAtual = m.diagnostico.humanizacao.respostaOriginal; resetCopia();
      conteudo.innerHTML = markdown(textoAtual);
      painel.querySelector('[data-technical-status]').hidden = m.respostaCurta !== null || m.diagnostico.humanizacao.aprovacaoTecnica?.aprovado !== true;
      painel.hidden = false;
      document.body.classList.add('retorno-open');
      origem.setAttribute('aria-expanded', 'true');
      align(); fechar.focus();
    });
    fechar.addEventListener('click', () => close());
    copiar.addEventListener('click', async () => {
      if (!textoAtual) return;
      const ok = await copiarTexto(textoAtual);
      copiar.textContent = ok ? 'Copiado' : 'Não foi possível copiar';
      clearTimeout(timerCopia); timerCopia = setTimeout(resetCopia, 2000);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !painel.hidden) { e.preventDefault(); close(); } });
    window.addEventListener('resize', align);
    return { close, contextChanged() { if (contexto !== getContext()) close(false); } };
  }
  window.IaDetalhesTecnicos = { disponivel, botao, mount };
})();
