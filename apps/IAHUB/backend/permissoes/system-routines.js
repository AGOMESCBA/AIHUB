const RECRUTAMENTO_ROTINAS = new Set([
  'dashboard',
  'monitores',
  'monitor-whatsapp',
  'monitor-email',
  'curriculos',
  'funcoes',
  'vagas',
  'processo-seletivo',
  'analisador',
  'historico',
  'config-analisador',
  'se-integracoes',
  'se-integracoes-config',
  'se-curriculos',
  'se-funcoes',
  'se-vagas',
  'se-api-configurador',
  'configuracoes',
  'administracao',
]);

function systemActiveFromRotinas(systemCode, rotinas) {
  if (!Array.isArray(rotinas) || rotinas.length === 0) return false;

  if (systemCode === 'recrutamento') {
    return rotinas.some(rotina => RECRUTAMENTO_ROTINAS.has(rotina));
  }

  if (systemCode === 'ia-command') {
    return rotinas.some(rotina => String(rotina).startsWith('iac-'));
  }

  return false;
}

module.exports = { systemActiveFromRotinas };
