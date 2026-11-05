'use strict';

// Um id posicional só é compatível dentro do agrupamento legado congelado.
// Novos relatórios usam assinatura técnica e versão da interpretação.
function mesmoGrupo(a, b, versaoA = 1, versaoB = 1) {
  if (versaoA !== versaoB) return false;
  if (a.assinatura && b.assinatura) return a.assinatura === b.assinatura;
  return versaoA === 1 && a.id === b.id && a.titulo === b.titulo && a.rotina === b.rotina && a.linhas?.[0] === b.linhas?.[0];
}

module.exports = { mesmoGrupo };
