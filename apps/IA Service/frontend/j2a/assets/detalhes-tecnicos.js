(function () {
  'use strict';
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICONE_COPIAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
  const ICONE_OK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ICONE_FALHA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 17h.01"/></svg>';
  // Técnica guardada de uma resposta entregue como Objetiva. O botão só existe
  // quando o analista está vendo a Objetiva: se ele já vê a Técnica (estilo
  // Técnica ou Objetiva bloqueada pelo gate, que volta para a Técnica), não há
  // o que detalhar (decisão de produto, 2026-10-19). Fica sem botão também a
  // análise bloqueada pelo Quality Gate.
  function textoTecnico(m) {
    if (m?.papel !== 'assistant' || !m.id || m.respostaOperacional?.qualityGateBloqueado) return null;
    if (typeof m.conteudo !== 'string' || !m.conteudo.trim()) return null;
    const h = m.diagnostico?.humanizacao;
    if (h?.status !== 'aplicada' || h.estilo === 'ORIGINAL') return null;
    return typeof h.respostaOriginal === 'string' && h.respostaOriginal.trim() ? h.respostaOriginal : null;
  }
  function disponivel(m) {
    return !!textoTecnico(m);
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
    painel.innerHTML = '<header class="retorno-head"><div><h2>Detalhes Técnicos</h2><p data-technical-status hidden>Aprovada pelo Quality Gate</p></div><div class="technical-actions"><button type="button" class="technical-copy" data-technical-copy title="Copiar" aria-label="Copiar Detalhes Técnicos">' + ICONE_COPIAR + '</button><button type="button" class="technical-close" title="Fechar" aria-label="Fechar Detalhes Técnicos"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></header><div class="retorno-scroll technical-markdown"></div>';
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
    // Botões só-ícone (pedido do usuário, 2026-10-23); o resultado da cópia
    // troca o ícone e o título por 2 s.
    function estadoCopia(icone, rotulo, classe = '') {
      copiar.innerHTML = icone; copiar.title = rotulo; copiar.setAttribute('aria-label', rotulo);
      copiar.classList.toggle('copiado', classe === 'copiado'); copiar.classList.toggle('falhou', classe === 'falhou');
    }
    function resetCopia() { clearTimeout(timerCopia); estadoCopia(ICONE_COPIAR, 'Copiar'); }
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
      textoAtual = textoTecnico(m); resetCopia();
      conteudo.innerHTML = markdown(textoAtual);
      painel.querySelector('[data-technical-status]').hidden = m.respostaCurta !== null || m.diagnostico?.humanizacao?.aprovacaoTecnica?.aprovado !== true;
      painel.hidden = false;
      document.body.classList.add('retorno-open');
      origem.setAttribute('aria-expanded', 'true');
      align(); fechar.focus();
    });
    fechar.addEventListener('click', () => close());
    copiar.addEventListener('click', async () => {
      if (!textoAtual) return;
      const ok = await copiarTexto(textoAtual);
      if (ok) estadoCopia(ICONE_OK, 'Copiado', 'copiado'); else estadoCopia(ICONE_FALHA, 'Não foi possível copiar', 'falhou');
      clearTimeout(timerCopia); timerCopia = setTimeout(resetCopia, 2000);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !painel.hidden) { e.preventDefault(); close(); } });
    window.addEventListener('resize', align);
    return { close, contextChanged() { if (contexto !== getContext()) close(false); } };
  }
  window.IaDetalhesTecnicos = { disponivel, botao, mount };
})();
