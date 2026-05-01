/**
 * audit-fields.js
 * Funções reutilizáveis para exibir ID do registro, ID da empresa e nome da empresa
 * em formulários e grades de todas as telas do sistema.
 *
 * Depende de window._iahubEmpresa exposto pelo auth.js.
 */

// ── Formulários ───────────────────────────────────────────────────────────────

/**
 * Retorna o HTML dos 3 campos de auditoria (desabilitados) para usar no topo de formulários.
 * @param {number|string|null} registroId  - ID do registro (null = novo registro)
 */
function auditFieldsHtml(registroId = null) {
  const emp  = window._iahubEmpresa || { id: '—', nome: '—' };
  const idTx = registroId != null ? String(registroId) : '—';
  return `
    <div class="form-row-3 audit-row" style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)">
      <div class="form-group">
        <label class="form-label" style="color:var(--text-lo)">ID do Registro</label>
        <input type="text" class="form-control audit-field" value="${idTx}" disabled
          style="color:var(--text-lo);background:var(--bg-hover);font-family:monospace;font-size:13px">
      </div>
      <div class="form-group">
        <label class="form-label" style="color:var(--text-lo)">ID da Empresa</label>
        <input type="text" class="form-control audit-field" value="${emp.id}" disabled
          style="color:var(--text-lo);background:var(--bg-hover);font-family:monospace;font-size:13px">
      </div>
      <div class="form-group">
        <label class="form-label" style="color:var(--text-lo)">Empresa</label>
        <input type="text" class="form-control audit-field" value="${emp.nome}" disabled
          style="color:var(--text-lo);background:var(--bg-hover);font-size:13px">
      </div>
    </div>`;
}

/**
 * Atualiza o ID do registro no bloco de auditoria já renderizado dentro de um container.
 * @param {HTMLElement} container  - elemento pai do formulário (ex: document.getElementById('modal'))
 * @param {number|string|null} registroId
 */
function auditFieldsSetId(container, registroId) {
  const fields = (container || document).querySelectorAll('.audit-row .audit-field');
  if (fields[0]) fields[0].value = registroId != null ? String(registroId) : '—';
}

// ── Tabelas ───────────────────────────────────────────────────────────────────

/**
 * Retorna o HTML dos 3 <th> para o cabeçalho de tabelas.
 */
function auditThHtml() {
  return `
    <th style="color:var(--text-lo);font-size:11px;white-space:nowrap">ID Reg.</th>
    <th style="color:var(--text-lo);font-size:11px;white-space:nowrap">ID Emp.</th>
    <th style="color:var(--text-lo);font-size:11px;white-space:nowrap">Empresa</th>`;
}

/**
 * Retorna o HTML dos 3 <td> para uma linha de tabela.
 * @param {Object} record - registro com campo .id e opcionalmente .empresa_id
 */
function auditTdHtml(record) {
  const emp    = window._iahubEmpresa || { id: '—', nome: '—' };
  const empId  = record?.empresa_id ?? emp.id;
  const empNome = emp.nome || '—';
  const recId  = record?.id ?? '—';
  const s      = 'color:var(--text-lo);font-size:11px;font-family:monospace;white-space:nowrap';
  return `
    <td style="${s}">${recId}</td>
    <td style="${s}">${empId}</td>
    <td style="${s};font-family:inherit">${empNome}</td>`;
}
