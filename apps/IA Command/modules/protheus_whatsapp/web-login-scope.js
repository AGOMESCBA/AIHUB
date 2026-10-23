'use strict';

const empresa = item => Number(item?.empresaId || item?.empresa_id || item?.id || 0);
const codigo = item => String(item?.codigoProtheus || item?.codigo_protheus || '').trim();
const chave = item => `${empresa(item)}:${codigo(item)}`;

// A sessão só pode perder acesso após o login. Novas liberações exigem novo login.
function revalidar(sessao, atuais) {
  const escopo = Number(sessao.empresaEscopoId);
  if (!escopo || !atuais || Number(atuais.empresaId) !== escopo) return null;
  const permitidas = new Set(atuais.empresasPermitidas.map(chave));
  const empresasPermitidas = sessao.empresasPermitidas.filter(item =>
    empresa(item) === escopo && permitidas.has(chave(item)));
  if (!empresasPermitidas.length) return null;
  const codigos = new Set(empresasPermitidas.map(codigo));
  const filiaisPermitidas = [];
  for (const cod of codigos) {
    const anterior = sessao.filiaisPermitidas.find(item => codigo(item) === cod);
    const atual = atuais.filiaisPermitidas.find(item => codigo(item) === cod);
    if (!anterior && !atual) continue;
    const filiais = anterior && atual
      ? anterior.filiais.filter(filial => atual.filiais.includes(filial))
      : (anterior || atual).filiais;
    filiaisPermitidas.push({ codigoProtheus: cod, filiais });
  }
  return { ...sessao, empresasPermitidas, filiaisPermitidas };
}

module.exports = { revalidar };
