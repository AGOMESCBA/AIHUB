'use strict';

window.companyGridSelection = function ({ getTable, endpoint, dicionario, reload }) {
  let busy = false;
  let headerCheckbox;
  const button = document.getElementById('btn-excluir-selecionados');
  const status = document.getElementById('selection-status');
  function selecionados() {
    const table = getTable();
    if (!table) return [];
    const ativos = new Set(table.getRows('active').map(row => row.getData().id));
    return table.getSelectedData().filter(row => ativos.has(row.id));
  }
  function atualizar() {
    const quantidade = selecionados().length;
    const total = getTable()?.getRows('active').length || 0;
    if (headerCheckbox) {
      headerCheckbox.checked = total > 0 && quantidade === total;
      headerCheckbox.indeterminate = quantidade > 0 && quantidade < total;
      headerCheckbox.disabled = busy || !total;
    }
    button.disabled = busy || !quantidade;
    button.textContent = busy ? 'Excluindo…' : `Excluir selecionados (${quantidade})`;
  }
  return {
    column: {
      title: 'Selecionar', formatter: 'rowSelection',
      titleFormatter() {
        headerCheckbox = document.createElement('input');
        headerCheckbox.type = 'checkbox';
        headerCheckbox.setAttribute('aria-label', 'Selecionar todos os registros filtrados');
        headerCheckbox.addEventListener('click', event => event.stopPropagation());
        headerCheckbox.addEventListener('change', () => {
          const table = getTable();
          const ids = table.getRows('active').map(row => row.getData().id);
          if (headerCheckbox.checked) table.selectRow(ids);
          else table.deselectRow(ids);
          atualizar();
        });
        return headerCheckbox;
      },
      width: 48, hozAlign: 'center', headerHozAlign: 'center', headerSort: false,
      resizable: false, frozen: true, groupable: false,
      cellClick: (event, cell) => {
        event.stopPropagation();
        if (event.target.type !== 'checkbox') cell.getRow().toggleSelect();
      },
    },
    bind() {
      const table = getTable();
      table.on('rowSelectionChanged', atualizar);
      // O primeiro filtro pode ser emitido antes de as linhas ativas estarem prontas.
      table.on('dataProcessed', atualizar);
      table.on('dataFiltered', () => {
        const ativos = new Set(table.getRows('active').map(row => row.getData().id));
        for (const row of table.getSelectedRows()) {
          if (!ativos.has(row.getData().id)) row.deselect();
        }
        atualizar();
      });
      table.on('dataChanged', atualizar);
      button.addEventListener('click', async () => {
        if (busy) return;
        const rows = selecionados();
        if (!rows.length) return;
        const empresaId = empresaIdAtiva();
        const conexoes = new Set(rows.map(row => row.connection_id)).size;
        const avisoVinculos = rows.some(row => row.tipo_no === 'empresa')
          ? '\nA seleção inclui nós de empresa: seus vínculos no IAHub também serão removidos.' : '';
        if (!confirm(`Excluir ${rows.length} registro(s) de ${conexoes} conexão(ões) do dicionário ${dicionario} no IAHub?\n\nApenas os registros selecionados nos filtros atuais serão excluídos. Os dados no Protheus serão preservados.${avisoVinculos} Esta ação não pode ser desfeita.`)) return;
        busy = true;
        status.textContent = '';
        atualizar();
        try {
          if (empresaIdAtiva() !== empresaId) throw new Error('A empresa ativa mudou. Atualize a grade antes de excluir.');
          const response = await fetch(apiUrl(endpoint), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(comEmpresa({ ids: rows.map(row => row.id) })),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || 'Não foi possível excluir os registros.');
          getTable().deselectRow();
          await reload();
          status.textContent = `${body.excluidos} registro(s) excluído(s).`;
        } catch (error) {
          status.textContent = error.message || 'Falha na exclusão. Atualize a grade antes de tentar novamente.';
        } finally {
          busy = false;
          atualizar();
        }
      });
      atualizar();
    },
  };
};
