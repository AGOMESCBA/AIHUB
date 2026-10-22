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
      toast('Endereço público salvo. Os links atuais continuam disponíveis.');
    } catch (err) { toast(err.message, true); }
    finally { botao.disabled = versao === null; }
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

  return { normalizarBase, montarLinks, atualizar, carregar, salvar, copiar };
});
