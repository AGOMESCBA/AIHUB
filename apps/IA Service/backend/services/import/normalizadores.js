// Normalização de campos brutos vindos da origem (seção 7 do prompt: CNPJ
// como chave única de negócio do cliente; demais normalizações auxiliares).

/**
 * Remove toda formatação de CNPJ/CPF, mantendo apenas dígitos.
 * '04.476.442/0001-60' → '04476442000160'
 */
function normalizarCnpj(valorBruto) {
  if (!valorBruto) return null;
  const digitos = String(valorBruto).replace(/\D/g, '');
  return digitos || null;
}

/**
 * Validação simples de formato — 14 dígitos para CNPJ, 11 para CPF pessoa
 * física (SoftExpert pode ter solicitante PF). Não valida dígito verificador
 * (fora de escopo desta etapa) — só descarta lixo óbvio (poucos dígitos,
 * tudo zero, etc).
 */
function cnpjPareceValido(cnpjNormalizado) {
  if (!cnpjNormalizado) return false;
  if (![11, 14].includes(cnpjNormalizado.length)) return false;
  if (/^0+$/.test(cnpjNormalizado)) return false;
  return true;
}

/**
 * Detecta indício de e-mail dentro de um campo que deveria ser só nome —
 * seção 46 do prompt: "nome do solicitante contendo e-mail" é uma
 * inconsistência a registrar, não a corrigir silenciosamente.
 */
function pareceConterEmail(texto) {
  return !!(texto && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(String(texto)));
}

function textoOuNull(valor) {
  const s = valor === null || valor === undefined ? '' : String(valor).trim();
  return s || null;
}

function numeroOuNull(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Datas do SoftExpert observadas na especificação do prompt como string
 * 'YYYYMMDD' (ou variações com hora) — normaliza para ISO-8601 quando
 * reconhece o padrão, preserva o valor bruto como fallback (nunca descarta).
 */
function dataParaIso(valorBruto) {
  if (!valorBruto) return null;
  const s = String(valorBruto).trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?$/);
  if (m) {
    const [, ano, mes, dia, hh = '00', mm = '00', ss = '00'] = m;
    return `${ano}-${mes}-${dia}T${hh}:${mm}:${ss}.000Z`;
  }
  // Já pode vir em formato ISO/reconhecível pelo Date — tenta antes de desistir.
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return null; // não reconhecido — quem chamar decide se isso é uma inconsistência a registrar
}

module.exports = {
  normalizarCnpj,
  cnpjPareceValido,
  pareceConterEmail,
  textoOuNull,
  numeroOuNull,
  dataParaIso,
};
