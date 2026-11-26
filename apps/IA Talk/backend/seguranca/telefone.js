'use strict';

// Telefone: guardado só com dígitos e DDI; nunca sai completo nas respostas.
// Variantes do nono dígito: mesma regra do IA Command (o WhatsApp entrega
// números do Brasil com ou sem o 9 depois do DDD) —
// ver apps/IA Command/modules/whatsapp/channel-store.js (variantesNumeroBrasil).

function normalizar(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function valido(valor) {
  return /^\d{12,13}$/.test(normalizar(valor));
}

function variantesBrasil(valor) {
  const base = normalizar(valor);
  const variantes = new Set(base ? [base] : []);
  if (base.startsWith('55') && base.length === 13) variantes.add(base.slice(0, 4) + base.slice(5));
  else if (base.startsWith('55') && base.length === 12) variantes.add(base.slice(0, 4) + '9' + base.slice(4));
  return [...variantes];
}

// Mesmo número, com ou sem o nono dígito (o WhatsApp devolve qualquer um dos dois).
function mesmoNumero(a, b) {
  const va = variantesBrasil(a);
  return va.length > 0 && variantesBrasil(b).some(v => va.includes(v));
}

// +55 65 9••••-0000
function mascarar(valor) {
  const d = normalizar(valor);
  if (d.length < 12) return '••••';
  return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 5)}••••-${d.slice(-4)}`;
}

function mascararEmail(valor) {
  const [nome, dominio] = String(valor || '').split('@');
  if (!dominio) return '••••';
  return `${nome.slice(0, 1)}••@${dominio}`;
}

module.exports = { normalizar, valido, variantesBrasil, mesmoNumero, mascarar, mascararEmail };
