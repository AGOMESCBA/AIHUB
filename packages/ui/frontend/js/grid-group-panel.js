/**
 * grid-group-panel.js
 * Painel de agrupamento reutilizável para grades Tabulator.
 *
 * Uso — modo manual (lista de campos fixa):
 *   const gp = createGroupPanel({
 *     chipsRowId : 'gp-chips-row',
 *     dropZoneId : 'dz',
 *     storageKey : 'minhaGrid_group_fields',
 *     allFields  : [{ field: 'status', label: 'Status' }, ...],
 *     getTable   : () => tabulatorRef,
 *   });
 *
 * Uso — modo auto (detecta todas as colunas do Tabulator automaticamente):
 *   const gp = createGroupPanel({
 *     chipsRowId : 'gp-chips-row',
 *     dropZoneId : 'dz',
 *     storageKey : 'minhaGrid_group_fields',
 *     getTable   : () => tabulatorRef,
 *     // allFields omitido → usa todas as colunas com campo definido e groupable !== false
 *   });
 *
 *   // Para excluir uma coluna do agrupamento (ex.: campos memo / colunas de ação):
 *   // adicione  groupable: false  na definição da coluna Tabulator.
 *
 * API pública:
 *   gp.getActiveFields() → string[]   campos ativos (para groupBy na inicialização)
 *   gp.applyToTable()                 aplica agrupamento à instância já criada
 *   gp.refresh()                      re-renderiza chips (chamar após o Tabulator ser criado no modo auto)
 */
function createGroupPanel({ chipsRowId, dropZoneId, storageKey, allFields, defaultVisible, getTable, onChange }) {

  const IS_AUTO = !Array.isArray(allFields) || allFields.length === 0;

  // ── CSS (injetado uma única vez em toda a sessão) ─────────────
  if (!document.getElementById('_ggp_style')) {
    const style = document.createElement('style');
    style.id = '_ggp_style';
    style.textContent = `
      .ggp-chip {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 3px 12px; border-radius: 20px;
        font-size: 12px; font-weight: 500;
        cursor: grab; user-select: none; white-space: nowrap;
        transition: border-color .12s, color .12s;
      }
      .ggp-chip-avail {
        background: var(--bg-card, #fff);
        border: 1px solid var(--border, #ddd);
        color: var(--text-md, #555);
      }
      .ggp-chip-avail:hover { border-color: #6366f1; color: #6366f1; }
      .ggp-chip-active { background: #6366f1; color: #fff; padding-right: 8px; }
      .ggp-chip-sep    { opacity: .55; font-size: 13px; }
      .ggp-chip-rm     { cursor: pointer; font-size: 16px; line-height: 1; opacity: .7; }
      .ggp-chip-rm:hover { opacity: 1; }

      .ggp-config-btn {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 3px 9px; border-radius: 20px;
        font-size: 11px; font-weight: 500; cursor: pointer; user-select: none;
        background: transparent; border: 1px dashed var(--border, #ddd);
        color: var(--text-lo, #999); transition: border-color .12s, color .12s;
        margin-left: 2px; position: relative;
      }
      .ggp-config-btn:hover { border-color: #6366f1; color: #6366f1; }
      .ggp-config-btn svg   { width: 12px; height: 12px; }

      .ggp-drop-zone {
        min-height: 42px; padding: 8px 12px;
        border: 2px dashed var(--border, #ddd); border-radius: 8px;
        background: var(--bg-hover, #f8f9fa);
        display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
        transition: border-color .15s, background .15s;
      }
      .ggp-drop-zone.ggp-over { border-color: #6366f1; background: #eef2ff; }
      .ggp-dz-hint { font-size: 12px; color: var(--text-lo, #999); pointer-events: none; }

      .ggp-popover {
        position: absolute; top: calc(100% + 6px); left: 0; z-index: 200;
        background: var(--bg-card, #fff); border: 1px solid var(--border, #ddd);
        border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.1);
        padding: 12px 0 8px; min-width: 220px; display: none;
      }
      .ggp-popover.ggp-open { display: block; }
      .ggp-popover-title {
        font-size: 11px; font-weight: 600; color: var(--text-lo, #999);
        text-transform: uppercase; letter-spacing: .04em;
        padding: 0 14px 8px; border-bottom: 1px solid var(--border, #ddd); margin-bottom: 6px;
      }
      .ggp-popover label {
        display: flex; align-items: center; gap: 9px;
        padding: 6px 14px; font-size: 13px; cursor: pointer; transition: background .1s;
      }
      .ggp-popover label:hover { background: var(--bg-hover, #f8f9fa); }
      .ggp-popover input[type=checkbox] { width: 15px; height: 15px; accent-color: #6366f1; cursor: pointer; }
    `;
    document.head.appendChild(style);
  }

  // ── Chaves de localStorage ────────────────────────────────────
  const KEY_VISIBLE = storageKey;
  const KEY_ACTIVE  = storageKey + '_active';

  // ── Elementos do DOM ──────────────────────────────────────────
  const chipsRow = document.getElementById(chipsRowId);
  const dz       = document.getElementById(dropZoneId);

  // ── Resolve campos disponíveis ────────────────────────────────
  // Modo manual: usa allFields fornecido.
  // Modo auto:   lê todas as colunas do Tabulator (com field e groupable !== false).
  function resolveFields() {
    if (!IS_AUTO) return allFields;
    const t = getTable?.();
    if (!t) return [];
    return t.getColumns()
      .filter(col => {
        const def = col.getDefinition();
        return !!def.field && def.groupable !== false;
      })
      .map(col => ({
        field: col.getField(),
        label: col.getDefinition().title || col.getField(),
      }));
  }

  // ── Estado — visibleFields (apenas no modo manual) ────────────
  const _defaultVis = IS_AUTO ? null : (defaultVisible ?? (allFields || []).map(f => f.field));
  let visibleFields = IS_AUTO ? null : new Set(
    JSON.parse(localStorage.getItem(KEY_VISIBLE) || 'null') ?? _defaultVis
  );

  // ── Estado — grupos ativos ────────────────────────────────────
  // No modo auto valida contra os campos resolvidos em tempo de execução;
  // no modo manual valida contra allFields.
  let activeGroups = (JSON.parse(localStorage.getItem(KEY_ACTIVE) || '[]'))
    .filter(g => IS_AUTO || (allFields || []).some(f => f.field === g.field));

  // ── Botão + popover de configuração (somente modo manual) ─────
  if (!IS_AUTO) {
    const configBtn = document.createElement('button');
    configBtn.className = 'ggp-config-btn';
    configBtn.title     = 'Configurar campos disponíveis';
    configBtn.innerHTML = `
      <svg viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd"
          d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106
             2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947
             2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561
             2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0
             01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532
             1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
          clip-rule="evenodd"/>
      </svg>
      Configurar`;

    const popover = document.createElement('div');
    popover.className = 'ggp-popover';
    popover.innerHTML = `
      <div class="ggp-popover-title">Campos disponíveis para agrupar</div>
      <div class="ggp-popover-body"></div>`;

    configBtn.appendChild(popover);
    chipsRow.appendChild(configBtn);

    function renderPopover() {
      const body = popover.querySelector('.ggp-popover-body');
      body.innerHTML = '';
      (allFields || []).forEach(({ field, label }) => {
        const lbl = document.createElement('label');
        lbl.innerHTML = `<input type="checkbox" data-field="${field}" ${visibleFields.has(field) ? 'checked' : ''}> ${label}`;
        lbl.querySelector('input').addEventListener('change', e => {
          if (e.target.checked) {
            visibleFields.add(field);
          } else {
            visibleFields.delete(field);
            activeGroups = activeGroups.filter(g => g.field !== field);
            saveActive();
            renderDropZone();
            applyGrouping();
          }
          localStorage.setItem(KEY_VISIBLE, JSON.stringify([...visibleFields]));
          renderChips();
        });
        body.appendChild(lbl);
      });
    }

    configBtn.addEventListener('click', e => {
      e.stopPropagation();
      const opening = !popover.classList.contains('ggp-open');
      popover.classList.toggle('ggp-open', opening);
      if (opening) renderPopover();
    });

    document.addEventListener('click', e => {
      if (!configBtn.contains(e.target)) popover.classList.remove('ggp-open');
    });
  }

  // ── Chips disponíveis ─────────────────────────────────────────
  function renderChips() {
    chipsRow.querySelectorAll('.ggp-chip-avail').forEach(el => el.remove());
    const fields = resolveFields();
    const visible = IS_AUTO
      ? fields                                                        // auto: todos
      : fields.filter(f => visibleFields.has(f.field));              // manual: só os habilitados

    visible.forEach(({ field, label }) => {
      const chip = document.createElement('span');
      chip.className     = 'ggp-chip ggp-chip-avail';
      chip.draggable     = true;
      chip.dataset.field = field;
      chip.dataset.label = label;
      chip.textContent   = label;
      chip.addEventListener('dragstart', e => {
        e.dataTransfer.setData('application/json', JSON.stringify({ field, label }));
      });
      // Insere antes do botão de configurar (se existir) ou ao final
      const configBtn = chipsRow.querySelector('.ggp-config-btn');
      chipsRow.insertBefore(chip, configBtn || null);
    });
  }

  // ── Drop zone ─────────────────────────────────────────────────
  dz.classList.add('ggp-drop-zone');

  function saveActive() {
    localStorage.setItem(KEY_ACTIVE, JSON.stringify(activeGroups));
  }

  function notifyChange() {
    if (typeof onChange === 'function') onChange(activeGroups.map(g => g.field));
  }

  function renderDropZone() {
    if (!activeGroups.length) {
      dz.innerHTML = '<span class="ggp-dz-hint">↑ Arraste um campo acima para agrupar os dados</span>';
      return;
    }
    dz.innerHTML = activeGroups.map((g, i) => `
      <span class="ggp-chip ggp-chip-active">
        ${i ? '<span class="ggp-chip-sep">›</span>' : ''}
        ${g.label}
        <span class="ggp-chip-rm" data-field="${g.field}">×</span>
      </span>`).join('');

    dz.querySelectorAll('.ggp-chip-rm').forEach(btn =>
      btn.addEventListener('click', () => {
        activeGroups = activeGroups.filter(g => g.field !== btn.dataset.field);
        saveActive();
        renderDropZone();
        applyGrouping();
        notifyChange();
      })
    );
  }

  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('ggp-over'); });
  dz.addEventListener('dragleave', ()  => dz.classList.remove('ggp-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('ggp-over');
    const { field, label } = JSON.parse(e.dataTransfer.getData('application/json'));
    if (activeGroups.find(g => g.field === field)) return;
    activeGroups.push({ field, label });
    saveActive();
    renderDropZone();
    applyGrouping();
    notifyChange();
  });

  function applyGrouping() {
    getTable()?.setGroupBy(activeGroups.map(g => g.field));
  }

  // ── Inicialização ─────────────────────────────────────────────
  renderChips();
  renderDropZone();
  notifyChange();

  // ── API pública ───────────────────────────────────────────────
  return {
    getActiveFields: () => activeGroups.map(g => g.field),
    applyToTable:    () => applyGrouping(),
    // Chame após o Tabulator ser inicializado no modo auto para re-renderizar os chips
    refresh:         () => renderChips(),
  };
}
