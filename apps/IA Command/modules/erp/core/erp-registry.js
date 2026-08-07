// Catálogo de ERPs suportados — usado pelo frontend para montar dropdowns de conexão.
// Os QueryBuilders foram substituídos pelo DatasetEngine (sql_base por dataset).

const REGISTRY = {
  protheus:  { id: 'protheus',   label: 'TOTVS Protheus',   dbTipoPadrao: 'sqlserver' },
  SoftExpert: { id: 'SoftExpert',label: 'SoftExpert',       dbTipoPadrao: 'sqlserver' },  
  sankhya:    { id: 'sankhya',   label: 'Sankhya',          dbTipoPadrao: 'sqlserver' },
  sap:        { id: 'sap',       label: 'SAP Business One', dbTipoPadrao: 'sqlserver' },
  senior:     { id: 'senior',    label: 'Senior Sistemas',  dbTipoPadrao: 'sqlserver' },
  mxm:        { id: 'mxm',       label: 'MXM Sistemas',     dbTipoPadrao: 'sqlserver' },
};

function listarErps() {
  return Object.values(REGISTRY);
}

module.exports = { listarErps, REGISTRY };
