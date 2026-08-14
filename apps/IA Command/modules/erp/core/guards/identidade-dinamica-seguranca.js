'use strict';

// Resolucao de identidade por papel para sistemas fora do Protheus (ex: SoftExpert),
// espelhando vendedor-seguranca.js — mas generico por erp, lendo whatsapp_numero_modulos
// (papel + codigo_identidade) em vez das colunas fixas erp_tipo/erp_id de
// whatsapp_allowed_numbers, que sao exclusivas do modelo Protheus legado.
//
// Papel "gestor" sempre libera acesso total (sem filtro). Qualquer outro papel exige
// codigo_identidade preenchido para filtrar; sem codigo, bloqueia (nao ha estado "sem
// restricao" aqui — diferente do Protheus, papel dinamico sempre é uma escolha explicita
// feita no cadastro do numero, entao ausencia de codigo é erro de cadastro, nao "sem
// perfil definido").

function resolverIdentidadeDinamica(remetente, empresaId, erp) {
  if (!remetente) return { estado: 'sem_remetente' };
  try {
    const { getDB } = require('../../../database');
    const channelStore = require('../../../whatsapp/channel-store');
    const db = getDB();

    const variantes = channelStore.variantesNumeroBrasil(remetente);
    const lid = channelStore.extrairLid(remetente);
    const placeholders = variantes.map(() => '?').join(',');

    const numero = db.prepare(
      `SELECT id, nome FROM whatsapp_allowed_numbers
        WHERE empresa_id = ? AND ativo = 1
          AND (numero IN (${placeholders}) OR wa_lid = ?)
        LIMIT 1`
    ).get(empresaId, ...variantes, lid);
    if (!numero) return { estado: 'nao_cadastrado' };

    const modulo = db.prepare(
      `SELECT papel, codigo_identidade FROM whatsapp_numero_modulos
        WHERE numero_id = ? AND LOWER(erp) = LOWER(?) AND liberado = 1
        LIMIT 1`
    ).get(numero.id, erp);
    if (!modulo) return { estado: 'nao_cadastrado' };

    const papel = String(modulo.papel || '').trim().toLowerCase();
    const codigo = String(modulo.codigo_identidade || '').trim().toUpperCase();

    if (!papel) return { estado: 'sem_papel', nome: numero.nome };
    if (papel === 'gestor') return { estado: 'gestor', nome: numero.nome };
    if (!codigo) return { estado: 'sem_codigo', papel, nome: numero.nome };
    return { estado: 'filtrado', papel, codigo, nome: numero.nome };
  } catch (e) {
    console.warn('[IdentidadeDinamicaSeguranca] Falha ao resolver identidade:', e.message);
    return { estado: 'erro' };
  }
}

module.exports = {
  resolverIdentidadeDinamica,
};
