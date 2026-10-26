(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlatformAccessLinks = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  function normalizarBase(value) {
    if (!String(value || '').trim()) return '';
    if (!/^https?:\/\//i.test(String(value).trim())) throw new Error('Informe um endereço começando com http:// ou https://.');
    const url = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || url.pathname !== '/' || url.search || url.hash) throw new Error('Informe somente o endereço HTTP ou HTTPS, sem caminho ou parâmetros.');
    return url.origin;
  }

  function montarLinks(origem, publica, apelido) {
    const atual = normalizarBase(origem);
    const externo = normalizarBase(publica);
    const slug = String(apelido || '').trim().toLowerCase();
    const sufixo = slug ? '/' + encodeURIComponent(slug) : '';
    return {
      legado: atual + '/entrar-servico' + sufixo,
      atual: atual + '/iaservice' + sufixo,
      publico: externo ? externo + '/iaservice' + sufixo : '',
    };
  }

  let versao = null;
  let salva = '';
  const el = id => document.getElementById(id);
  function atualizar() {
    let links;
    try {
      links = montarLinks(location.origin, el('f-access-public-url').value, el('f-login-apelido').value);
      el('access-config-status').textContent = normalizarBase(el('f-access-public-url').value) !== salva
        ? 'Endereço público em edição, ainda não salvo. Os links atuais continuam disponíveis.'
        : links.publico
        ? 'Endereço público ' + (links.publico.startsWith('https:') ? 'HTTPS' : 'HTTP') + '. Use “Abrir para testar” e confirme o login e o chat antes de compartilhar.'
        : 'Sem endereço público. Os links deste acesso continuam disponíveis.';
    } catch (_) {
      links = montarLinks(location.origin, '', el('f-login-apelido').value);
      el('access-config-status').textContent = 'Endereço público inválido. Informe http:// ou https://, sem caminho ou parâmetros.';
    }
    for (const [chave, id] of [['legado', 'f-login-link'], ['atual', 'f-service-current-link'], ['publico', 'f-service-public-link']]) {
      el(id).value = links[chave];
      const abrir = el(id + '-open');
      if (links[chave]) abrir.setAttribute('href', links[chave]);
      else abrir.removeAttribute('href');
      abrir.setAttribute('aria-disabled', String(!links[chave]));
      const copiar = el(id + '-copy');
      if (copiar) copiar.disabled = !links[chave];
    }
  }

  async function carregar(api) {
    versao = null;
    el('access-public-save').disabled = true;
    try {
      const cfg = await api('/api/iahub/platform/access-config');
      versao = cfg.versao;
      salva = cfg.urlPublica || '';
      el('f-access-public-url').value = cfg.urlPublica || '';
      el('access-public-save').disabled = false;
      atualizar();
      if (origensCfg) renderOrigens(); // links da aba Sites autorizados usam o endereço público
    } catch (err) {
      atualizar();
      el('access-config-status').textContent = 'Não foi possível carregar o endereço público. Os links atuais continuam disponíveis. Recarregue os dados para tentar novamente.';
      throw err;
    }
  }

  async function salvar(api, toast) {
    const botao = el('access-public-save');
    try {
      if (versao === null) throw new Error('Recarregue os dados antes de salvar o endereço público.');
      const urlPublica = normalizarBase(el('f-access-public-url').value);
      botao.disabled = true;
      const cfg = await api('/api/iahub/platform/access-config', {
        method: 'POST', body: JSON.stringify({ urlPublica, versao }),
      });
      versao = cfg.versao;
      salva = cfg.urlPublica || '';
      el('f-access-public-url').value = cfg.urlPublica || '';
      atualizar();
      if (origensCfg) renderOrigens();
      toast('Endereço público salvo. Os links atuais continuam disponíveis.');
    } catch (err) { toast(err.message, true); }
    finally { botao.disabled = versao === null; }
  }

  // ── Sites autorizados a exibir o chat (iframe) — por empresa ─────────────
  // Cada inclusão/remoção grava na hora a lista da empresa aberta na tela.
  let origensCfg = null;
  let salvandoOrigens = false;
  const ICONE_SITE = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/></svg>';
  const ICONE_REMOVER = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function empresaQs() {
    const eid = new URLSearchParams(location.search).get('empresaId');
    return eid ? '?empresaId=' + encodeURIComponent(eid) : '';
  }
  function lerLinhasOrigens(texto) {
    return String(texto || '').split(/[\r\n,;\s]+/).map(s => s.trim()).filter(Boolean);
  }
  // Mesma regra do servidor: só https:// + domínio (porta opcional), sem caminho.
  function normalizarOrigem(valor) {
    const texto = String(valor || '').trim();
    if (!texto) throw new Error('Informe o endereço do site.');
    if (/^http:\/\//i.test(texto)) throw new Error('Use HTTPS: o navegador bloqueia o chat dentro de um site HTTP.');
    if (!/^https:\/\//i.test(texto)) throw new Error('Comece com https:// (ex.: https://j2a.c3isystems.com.br).');
    let url;
    try { url = new URL(texto); } catch (_) { throw new Error('Endereço inválido.'); }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Informe só o domínio, sem caminho. Use: ' + url.origin);
    }
    return url.origin;
  }
  function feedback(texto, tipo) {
    const fb = el('emb-feedback');
    fb.textContent = texto;
    fb.className = 'emb-feedback' + (tipo ? ' ' + tipo : '');
  }
  function validarDigitacao() {
    const valor = el('emb-input').value.trim();
    el('emb-add-btn').disabled = !valor || !origensCfg || salvandoOrigens;
    if (!valor) return feedback('Somente o endereço do site (https:// + domínio), sem caminho.');
    try {
      const origem = normalizarOrigem(valor);
      if (origensCfg?.origens.includes(origem)) return feedback('Este site já está na lista.', 'erro');
      feedback('Será adicionado: ' + origem, 'ok');
    } catch (err) { feedback(err.message, 'erro'); }
  }

  function baseLinks() {
    try { return normalizarBase(salva) || location.origin; } catch (_) { return location.origin; }
  }

  function renderOrigens() {
    const cfg = origensCfg;
    el('emb-company').textContent = cfg?.empresaNome || (cfg ? 'Empresa ' + cfg.empresaId : 'Empresa');
    const origens = cfg?.origens || [];
    el('emb-count').textContent = String(origens.length);
    el('emb-list').innerHTML = origens.length
      ? origens.map(o => `<li class="emb-item"><span class="emb-item-ic">${ICONE_SITE}</span><span class="emb-item-url emb-mono" title="${esc(o)}">${esc(o)}</span><button type="button" class="emb-remove" data-origem="${esc(o)}" ${salvandoOrigens ? 'disabled' : ''} aria-label="Remover ${esc(o)}">${ICONE_REMOVER}Remover</button></li>`).join('')
      : '<li class="emb-empty"><strong>Nenhum site autorizado</strong>O chat desta empresa só abre pelo link direto.</li>';
    el('emb-list').querySelectorAll('.emb-remove').forEach(btn => btn.addEventListener('click', () => removerOrigem(btn.dataset.origem)));
    el('emb-meta').textContent = cfg?.atualizadoEm
      ? 'Última alteração em ' + new Date(cfg.atualizadoEm).toLocaleString('pt-BR') + (cfg.atualizadoPor ? ' por ' + cfg.atualizadoPor : '') + '. Vale em até 30 segundos.'
      : '';

    const base = baseLinks();
    const links = [['IA Service', cfg?.links?.iaService, 'Sem apelido. Defina na aba Chat IA Service.'],
      ['IA Command', cfg?.links?.iaCommand, 'Sem rota mascarada. Configure em IA Command › Configurar IA.']];
    el('emb-links').innerHTML = links.map(([nome, caminho, vazio], idx) => caminho
      ? `<div class="emb-link"><span class="emb-link-tag">${nome}</span><input type="text" class="form-control emb-mono" id="emb-link-${idx}" readonly value="${esc(base + caminho)}" onclick="this.select()"><button type="button" class="btn btn-ghost" data-copiar="emb-link-${idx}">Copiar</button></div>`
      : `<div class="emb-link"><span class="emb-link-tag">${nome}</span><span class="emb-link-off">${vazio}</span></div>`).join('');
    el('emb-links').querySelectorAll('[data-copiar]').forEach(btn => btn.addEventListener('click', () => copiar(btn.dataset.copiar, toastOrigens)));
    el('emb-http-alert').hidden = !base.startsWith('http:') || !(cfg?.links?.iaService || cfg?.links?.iaCommand);
    validarDigitacao();
  }

  let apiOrigens = null;
  let toastOrigens = () => {};
  async function gravarOrigens(origens, mensagem) {
    if (!origensCfg) throw new Error('Recarregue os dados antes de alterar a lista.');
    salvandoOrigens = true;
    renderOrigens();
    try {
      origensCfg = await apiOrigens('/api/iahub/platform/embed-origins' + empresaQs(), {
        method: 'POST', body: JSON.stringify({ origens, versao: origensCfg.versao }),
      });
      toastOrigens(mensagem);
      return true;
    } catch (err) {
      toastOrigens(err.message, true);
      return false;
    } finally {
      salvandoOrigens = false;
      renderOrigens();
    }
  }

  async function carregarOrigens(api) {
    if (typeof window !== "undefined" && typeof window.toast === "function") toastOrigens = window.toast;
    apiOrigens = api;
    origensCfg = null;
    try {
      origensCfg = await api('/api/iahub/platform/embed-origins' + empresaQs());
      renderOrigens();
    } catch (err) {
      el('emb-list').innerHTML = '<li class="emb-empty"><strong>Não foi possível carregar</strong>Recarregue os dados para tentar novamente.</li>';
      throw err;
    }
  }

  async function adicionarOrigem(api, toast) {
    apiOrigens = api; toastOrigens = toast;
    let origem;
    try { origem = normalizarOrigem(el('emb-input').value); }
    catch (err) { feedback(err.message, 'erro'); return; }
    if (origensCfg?.origens.includes(origem)) { feedback('Este site já está na lista.', 'erro'); return; }
    if (await gravarOrigens([...(origensCfg?.origens || []), origem], 'Site autorizado: ' + origem)) {
      el('emb-input').value = '';
      validarDigitacao();
    }
  }

  async function removerOrigem(origem) {
    if (!origensCfg || !confirm('Remover ' + origem + '?\n\nO chat desta empresa deixa de abrir dentro desse site.')) return;
    await gravarOrigens(origensCfg.origens.filter(o => o !== origem), 'Site removido: ' + origem);
  }

  // Botão "Salvar configuracoes" do topo: inclui o que estiver digitado.
  async function salvarOrigens(api, toast) {
    apiOrigens = api; toastOrigens = toast;
    if (el('emb-input').value.trim()) return adicionarOrigem(api, toast);
    toast('Nesta aba cada inclusão ou remoção já é salva na hora.');
  }


  async function copiar(id, toast) {
    const campo = el(id);
    if (!campo?.value) return;
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) await navigator.clipboard.writeText(campo.value);
      else {
        campo.focus();
        campo.select();
        if (!document.execCommand('copy')) throw new Error('Cópia indisponível');
      }
      toast('Link copiado');
    } catch (_) { toast('Selecione e copie o link manualmente.', true); }
  }

  return { normalizarBase, montarLinks, atualizar, carregar, salvar, copiar, lerLinhasOrigens, normalizarOrigem, carregarOrigens, adicionarOrigem, removerOrigem, salvarOrigens, validarDigitacao, renderOrigens };
});
