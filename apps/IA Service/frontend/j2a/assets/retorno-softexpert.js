(() => {
  'use strict';
  const horarios = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
  const opcoesHoras = '<option value="">Selecione</option>' + horarios.map(h => `<option value="${h}">${h}</option>`).join('');

  function requestId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function mount({ button, getContext, request, onSuccess = async () => {}, alignTo = null }) {
    button.setAttribute('aria-expanded', 'false');
    // data-retorno-custom: a tela ja traz rotulo e icone proprios no HTML
    // (ex.: J2A, simbolo SoftExpert no cabecalho) -- nao sobrescrever.
    if (!button.hasAttribute('data-retorno-custom')) {
      button.title = 'Retorno ao SoftExpert';
      button.setAttribute('aria-label', 'Retorno ao SoftExpert');
      button.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13l-3 3 3 3M5 16h9a3 3 0 0 0 0-6"/></svg>';
    }
    const drafts = new Map();
    let current = null;
    let draft = null;
    let metadata = null;
    let revision = 0;
    let sending = false;
    const panel = document.createElement('aside');
    panel.className = 'retorno-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Retorno ao SoftExpert');
    panel.innerHTML = `
      <div class="retorno-resize" role="separator" tabindex="0" aria-label="Redimensionar painel de retorno" aria-orientation="vertical"></div>
      <header class="retorno-head"><div><h2>Retorno ao SoftExpert</h2><p data-retorno-context></p></div>
        <button type="button" data-retorno-expand aria-label="Expandir painel">⤢</button>
        <button type="button" data-retorno-close aria-label="Voltar ao chat">✕</button></header>
      <form class="retorno-form">
        <div class="retorno-scroll">
          <p class="retorno-notice" data-retorno-status role="status"></p>
          <label>Descrição do posicionamento<textarea name="DESCRICAO" rows="12" required maxlength="100000" placeholder="Descreva o retorno que deseja registrar no chamado."></textarea></label>
          <details><summary>Classificação do posicionamento</summary>
            <p class="retorno-help">As opções serão disponibilizadas após a validação das listas do formulário do SoftExpert.</p>
            <div class="retorno-fields">
              <label>Assunto<input name="ASSUNTO" type="text" maxlength="500"></label>
              <label>Resultado<input name="RESULTADO" type="text" maxlength="500"></label>
              <label>Situação<select name="SITUACAOCHAMADO" disabled aria-label="Situação"><option value="">Aguardando configuração</option></select></label>
              <label>Tipo de posicionamento<select name="TIPOPOSICIONAME" disabled aria-label="Tipo de posicionamento"><option value="">Aguardando configuração</option></select></label>
              <label>Motivo do apontamento<select name="MOTIVOAPONTAMEN" disabled aria-label="Motivo do apontamento"><option value="">Aguardando configuração</option></select></label>
              <label>Aguardando retorno<select name="AGUARDANRETORNO" disabled aria-label="Aguardando retorno"><option value="">Aguardando configuração</option></select></label>
            </div>
          </details>
          <details open><summary>Horas e agendamento</summary>
            <p class="retorno-help">Selecione as horas no mesmo dia. O total desconta o intervalo.</p>
            <div class="retorno-fields">
              <label>Hora inicial *<select name="HORAINI" required>${opcoesHoras}</select></label>
              <label>Intervalo *<select name="HORAINT" required>${opcoesHoras}</select></label>
              <label>Hora final *<select name="HORAFIM" required>${opcoesHoras}</select></label>
              <label>Hora total<input name="HORATOTALNUM" type="text" readonly placeholder="0,00"></label>
              <label>Data do agendamento<input name="DTAGEND" type="date" lang="pt-BR" aria-label="Data do agendamento (dia, mês e ano)"></label>
              <label>Hora do agendamento<input name="HRAGEND" type="time" step="60" lang="pt-BR"></label>
            </div>
          </details>
          <section class="retorno-attachments" aria-label="Anexo do retorno">
            <button type="button" data-retorno-add-files>Selecionar anexo</button><input type="file" data-retorno-files hidden>
            <p class="retorno-help">Um arquivo por posicionamento, enviado somente após sua confirmação. O rascunho é preservado ao fechar o painel; recarregar ou sair limpa os dados.</p>
            <ul data-retorno-file-list></ul>
          </section>
        </div>
        <footer class="retorno-actions"><button type="button" data-retorno-new hidden>Novo retorno</button><button type="button" data-retorno-consult hidden>Consultar tentativa</button><button type="button" data-retorno-cancel>Cancelar</button><button type="submit" class="retorno-primary">Registrar retorno</button></footer>
      </form>
      <dialog class="retorno-confirm" aria-label="Confirmar retorno ao SoftExpert">
        <h3>Deseja realmente registrar este retorno no SoftExpert?</h3>
        <p data-retorno-confirm-context></p><p data-retorno-confirm-status role="status"></p>
        <div class="retorno-actions"><button type="button" data-retorno-confirm-cancel>Cancelar</button><button type="button" class="retorno-primary" data-retorno-confirm-send>Sim, confirmar envio</button></div>
      </dialog>`;
    document.body.append(panel);
    const find = (selector) => panel.querySelector(selector);
    const form = find('form');
    const dialog = find('dialog');
    const status = find('[data-retorno-status]');
    const confirmSend = find('[data-retorno-confirm-send]');
    const fieldNames = ['DESCRICAO', 'ASSUNTO', 'RESULTADO', 'HORAINI', 'HORAFIM', 'HORAINT', 'HORATOTALNUM', 'DTAGEND', 'HRAGEND', 'SITUACAOCHAMADO', 'TIPOPOSICIONAME', 'MOTIVOAPONTAMEN', 'AGUARDANRETORNO'];
    const keyFor = (c) => JSON.stringify([c.scopeKey, c.chamadoId]);
    const newDraft = () => ({ fields: {}, files: [], requestId: requestId() });

    function applyRules() {
      for (const name of fieldNames) {
        const field = form.elements.namedItem(name);
        const rule = metadata?.regrasCampos?.[name];
        const hora = ['HORAINI', 'HORAINT', 'HORAFIM'].includes(name);
        if (field.tagName === 'SELECT' && rule?.opcoes && !hora) {
          field.replaceChildren(new Option('Selecione', ''));
          rule.opcoes.forEach((o) => field.add(new Option(o.rotulo, o.valor)));
          field.value = draft?.fields[name] || '';
        }
        field.required = name === 'DESCRICAO' || hora || !!rule?.obrigatorio;
        field.disabled = !!draft?.locked || (metadata?.regrasCampos ? !rule || (!!rule.calculado && name !== 'HORATOTALNUM') : field.tagName === 'SELECT' && !hora);
        if (rule?.maxLength && field.tagName !== 'SELECT') field.maxLength = rule.maxLength;
      }
      find('[data-retorno-add-files]').disabled = !!draft?.locked || metadata?.anexosDisponiveis === false;
      find('[data-retorno-consult]').hidden = !draft?.locked;
      find('[data-retorno-new]').hidden = !!draft;
      const submit = form.querySelector('[type=submit]');
      submit.textContent = draft?.locked ? 'Retomar tentativa' : 'Registrar retorno';
      submit.disabled = !draft || ['indeterminado'].includes(draft?.result?.status) || !!draft?.result?.emProcessamento;
      renderFiles();
      calcularHoras();
    }

    function calcularHoras() {
      const inicio = form.elements.namedItem('HORAINI');
      const fim = form.elements.namedItem('HORAFIM');
      const intervalo = form.elements.namedItem('HORAINT');
      const total = form.elements.namedItem('HORATOTALNUM');
      const min = v => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
      fim.setCustomValidity(''); intervalo.setCustomValidity('');
      total.value = '';
      if (!inicio.value || !fim.value || !intervalo.value) return;
      const periodo = min(fim.value) - min(inicio.value);
      const saldo = periodo - min(intervalo.value);
      if (periodo < 0) { fim.setCustomValidity('A hora final não pode ser menor que a hora inicial.'); return; }
      if (saldo < 0) { intervalo.setCustomValidity('O intervalo não pode exceder o período trabalhado.'); return; }
      total.value = (saldo / 60).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    ['HORAINI', 'HORAFIM', 'HORAINT'].forEach(name => form.elements.namedItem(name).addEventListener('change', calcularHoras));

    function showResult(result) {
      const files = (result.arquivos || []).map((a) => `${a.nome}: ${a.status}`).join(' · ');
      status.textContent = [result.mensagem, `Posicionamento: ${result.posicionamento || result.status}.`, result.historico ? `Histórico: ${result.historico}.` : '', result.sincronizacao === 'pendente' ? 'Atualização do chat pendente.' : '', files].filter(Boolean).join(' ');
    }

    function save() {
      if (!draft) return;
      for (const name of fieldNames) {
        // Total é exibido em pt-BR e recalculado no servidor, em horas decimais.
        if (name !== 'HORATOTALNUM') draft.fields[name] = form.elements.namedItem(name).value;
      }
    }
    function close() {
      if (sending) return;
      save();
      revision++;
      if (dialog.open) dialog.close();
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('retorno-open', 'retorno-wide');
      panel.classList.remove('retorno-expanded');
      button.focus();
    }
    function clear() {
      revision++;
      drafts.clear();
      current = draft = metadata = null;
      if (dialog.open) dialog.close();
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('retorno-open', 'retorno-wide');
      panel.classList.remove('retorno-expanded');
      form.reset();
      renderFiles();
    }
    function renderFiles() {
      const list = find('[data-retorno-file-list]');
      list.replaceChildren();
      (draft?.files || []).forEach((file, index) => {
        const li = document.createElement('li');
        const text = document.createElement('span');
        text.textContent = `${file.name} · ${Math.ceil(file.size / 1024)} KB`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remover';
        remove.disabled = sending || !!draft?.locked;
        remove.setAttribute('aria-label', `Remover ${file.name}`);
        remove.addEventListener('click', () => { draft.files.splice(index, 1); draft.requestId = requestId(); renderFiles(); });
        li.append(text, remove);
        list.append(li);
      });
    }
    async function open() {
      if (sending) return;
      save();
      const context = getContext();
      if (!context?.chamadoId || context.readonly) return;
      current = { ...context };
      const key = keyFor(current);
      if (!drafts.has(key)) drafts.set(key, newDraft());
      draft = drafts.get(key);
      for (const name of fieldNames) form.elements.namedItem(name).value = draft.fields[name] || '';
      metadata = null;
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      document.body.classList.add('retorno-open');
      alignPanel();
      find('[data-retorno-context]').textContent = `Chamado ${current.numero || ''}`;
      status.textContent = 'Verificando disponibilidade do registro…';
      renderFiles();
      applyRules();
      form.elements.namedItem('DESCRICAO').focus();
      const version = ++revision;
      try {
        const result = await request(current, { method: 'GET' });
        if (version !== revision) return;
        metadata = result;
        status.textContent = result.disponivel ? `Revise o conteúdo antes de registrar.${result.historico === 'desabilitado' ? ' O histórico nativo ainda não será automatizado nesta homologação.' : ''}` : result.motivo;
        applyRules();
        if (draft.result) showResult(draft.result);
      } catch (err) {
        if (version === revision) status.textContent = err.message;
      }
    }
    // alignTo (opcional): elemento cujo topo/base o painel acompanha no
    // desktop, para ficar alinhado aos quadros da tela (ex.: chat do J2A).
    // No mobile o CSS ocupa a tela inteira, entao limpa o ajuste.
    function alignPanel() {
      const ref = typeof alignTo === 'function' ? alignTo() : alignTo;
      if (panel.hidden || !ref || window.innerWidth <= 1100) {
        panel.style.top = panel.style.bottom = '';
        return;
      }
      const rect = ref.getBoundingClientRect();
      if (!rect.height) return;
      panel.style.top = `${Math.round(rect.top)}px`;
      panel.style.bottom = `${Math.round(window.innerHeight - rect.bottom)}px`;
    }
    window.addEventListener('resize', alignPanel);
    function contextChanged() {
      const context = getContext();
      button.disabled = !context?.chamadoId || context.readonly;
      if (current && keyFor(context || {}) !== keyFor(current)) close();
    }
    form.addEventListener('input', () => { save(); if (draft && !draft.locked) draft.requestId = requestId(); });
    find('[data-retorno-files]').addEventListener('change', (event) => {
      if (!draft || draft.locked) return;
      const added = [...event.target.files];
      event.target.value = '';
      if (!added.length) return;
      const files = added;
      const maxSize = metadata?.limites?.arquivoBytes || 25 * 1024 * 1024;
      if (files.length > 1 || files.some((f) => !f.size || f.size > maxSize)) {
        status.textContent = 'Selecione apenas um arquivo não vazio, de até 25 MB.';
        return;
      }
      draft.files = files;
      draft.requestId = requestId();
      renderFiles();
    });
    find('[data-retorno-add-files]').addEventListener('click', () => find('[data-retorno-files]').click());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      calcularHoras();
      if (sending || !draft || !form.reportValidity()) return;
      save();
      if (!draft.fields.DESCRICAO.trim()) { status.textContent = 'Informe a descrição do retorno.'; return; }
      find('[data-retorno-confirm-context]').textContent = `Chamado ${current.numero} · ${draft.files.length} anexo(s)`;
      find('[data-retorno-confirm-status]').textContent = metadata?.disponivel ? '' : (metadata?.motivo || 'Não foi possível validar a disponibilidade do envio.');
      confirmSend.disabled = !metadata?.disponivel;
      dialog.showModal();
      find('[data-retorno-confirm-cancel]').focus();
    });
    confirmSend.addEventListener('click', async () => {
      if (sending || !metadata?.disponivel || !dialog.open) return;
      if (keyFor(getContext() || {}) !== keyFor(current)) { dialog.close(); close(); return; }
      const target = { ...current };
      const submitted = draft;
      submitted.locked = true;
      const version = revision;
      const body = new FormData();
      body.append('dados', JSON.stringify({ campos: submitted.fields, confirmado: true, idempotencyKey: submitted.requestId }));
      submitted.files.forEach((file) => body.append('arquivos', file));
      sending = true;
      form.inert = true;
      confirmSend.disabled = true;
      find('[data-retorno-confirm-cancel]').disabled = true;
      try {
        const result = await request(target, { method: 'POST', body });
        submitted.result = result;
        if (version !== revision) return;
        if (result.status !== 'registrado') { dialog.close(); showResult(result); applyRules(); return; }
        drafts.delete(keyFor(target));
        draft = null;
        dialog.close();
        showResult(result);
        form.reset();
        renderFiles();
        try { await onSuccess(target); } catch (_) { status.textContent += ' A atualização do chat está pendente.'; }
      } catch (err) {
        submitted.result = { status: 'indeterminado', mensagem: `${err.message} Consulte esta tentativa antes de continuar.` };
        if (version === revision) { dialog.close(); showResult(submitted.result); applyRules(); }
      } finally {
        sending = false;
        form.inert = false;
        confirmSend.disabled = !metadata?.disponivel;
        find('[data-retorno-confirm-cancel]').disabled = false;
        applyRules();
      }
    });
    find('[data-retorno-consult]').addEventListener('click', async () => {
      if (sending || !draft) return;
      const target = { ...current };
      const submitted = draft;
      const version = revision;
      try {
        const result = await request(target, { method: 'GET', consultaChave: submitted.requestId });
        submitted.result = result;
        if (version !== revision) return;
        showResult(result);
        if (result.status === 'registrado') {
          drafts.delete(keyFor(target)); draft = null; form.reset(); renderFiles();
          try { await onSuccess(target); } catch (_) { status.textContent += ' A atualização do chat está pendente.'; }
        }
      } catch (err) {
        if (version !== revision) return;
        if (err.status === 404) submitted.result = { status: 'nao_localizado', mensagem: 'Tentativa ainda não localizada. Você pode repetir com a mesma chave; o conteúdo foi preservado.' };
        status.textContent = err.status === 404 ? submitted.result.mensagem : err.message;
      } finally { if (version === revision) applyRules(); }
    });
    find('[data-retorno-new]').addEventListener('click', open);
    dialog.addEventListener('cancel', (event) => { if (sending) event.preventDefault(); });
    find('[data-retorno-confirm-cancel]').addEventListener('click', () => { if (!sending) dialog.close(); });
    find('[data-retorno-close]').addEventListener('click', close);
    find('[data-retorno-cancel]').addEventListener('click', close);
    find('[data-retorno-expand]').addEventListener('click', () => {
      const expanded = panel.classList.toggle('retorno-expanded');
      document.body.classList.toggle('retorno-wide', expanded);
    });
    panel.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !dialog.open) close(); });
    const resize = find('.retorno-resize');
    const setWidth = (width) => document.body.style.setProperty('--retorno-width', `${Math.min(Math.max(360, width), Math.max(360, window.innerWidth - 440))}px`);
    resize.addEventListener('pointerdown', (event) => { resize.setPointerCapture(event.pointerId); });
    resize.addEventListener('pointermove', (event) => { if (resize.hasPointerCapture(event.pointerId)) setWidth(window.innerWidth - event.clientX); });
    resize.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      setWidth(panel.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 30 : -30));
    });
    button.addEventListener('click', open);
    contextChanged();
    return { open, close, clear, contextChanged };
  }
  window.IaRetornoSoftExpert = { mount };
})();
