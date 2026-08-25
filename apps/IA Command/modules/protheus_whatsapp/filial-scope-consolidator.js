'use strict';

// Consolida a selecao estruturada da arvore de filiais (UI do chat embutido,
// IA Command) num unico estado { modo: 'especifica', chaves } que o
// lobo-guara-normalizer sabe aplicar — ele so entende UM modo por chamada,
// nunca uma mistura de "empresas inteiras" + "filiais avulsas" ao mesmo tempo
// (ver lobo-guara-normalizer.js::_resolverChavesEscopo). Este modulo faz essa
// mistura ANTES de chegar la, e valida que tudo que veio do browser realmente
// pertence a conexao Lobo Guara da empresa autenticada da sessao.
//
// Contrato de entrada (selecaoUi, vindo do payload do frontend):
//   { empresasInteiras: [empresaProtheusCodigo, ...],
//     filiaisAvulsas:   [filialChave, ...],
//     uiTouched: boolean }
//
// filiaisPermitidasSessao (opcional): lista de { codigoProtheus, filiais }
// vinda da sessao do token (FWUsrEmp/LoadFils, capturados no .prw na
// abertura do chat — ver token-service.js::filiaisPermitidasDaEmpresa).
// Quando presente para uma empresa, a validacao exige DUPLA aprovacao: a
// filial precisa existir na arvore cadastrada (protheus_company_tree) E
// estar entre as filiais que o ERP autoriza para aquele usuario — nunca so
// uma das duas. Ausente para uma empresa (compatibilidade — .prw antigo, ou
// LoadFils falhou para essa empresa na abertura) mantem o comportamento
// anterior: valida so contra a arvore cadastrada.
//
// Contrato de saida:
//   {
//     execucao: { modo: 'especifica', chaves: [...] } | null,
//     resolvido: { filiaisChave: [...] },
//     resultado: { solicitado, aplicado, erro },
//     selecaoUiValidada: { empresasInteiras: [...], filiaisAvulsas: [...] },
//   }
// `execucao` e null quando nao ha nada selecionado (equivalente a 'todas') —
// nesse caso o chamador simplesmente nao seta intent._filialLoboGuara.

const loboGuaraFilialResolver = require('../erp/totvs_protheus/SX/lobo-guara-filial-resolver');

function _listaTexto(valor) {
  return [...new Set((Array.isArray(valor) ? valor : [])
    .map(v => String(v || '').trim())
    .filter(Boolean))];
}

// Devolve o Set de filialChave que o ERP autoriza para essa empresa, ou null
// se a sessao nao tem essa informacao (nesse caso o chamador nao filtra por
// ela — so a arvore cadastrada decide).
function _filiaisErpDaEmpresa(filiaisPermitidasSessao, empresaProtheusCodigo) {
  if (!Array.isArray(filiaisPermitidasSessao)) return null;
  const item = filiaisPermitidasSessao.find(i => i.codigoProtheus === empresaProtheusCodigo);
  return item ? new Set(item.filiais) : null;
}

// Valida que cada empresaProtheusCodigo/filialChave recebido do cliente
// realmente existe na arvore da conexao da empresa autenticada — nunca
// confia cegamente no payload do browser, mesmo que a arvore exibida na UI
// ja tenha sido filtrada pelo endpoint de leitura (defesa em profundidade:
// esta e a barreira que vale no momento de EXECUTAR o filtro, nao so no
// momento de listar options na tela). Quando filiaisPermitidasSessao esta
// presente, soma uma segunda barreira: acesso real do usuario no ERP.
function consolidarEscopoFilial({ db, ctx, selecaoUi, filiaisPermitidasSessao = null }) {
  const solicitado = !!(selecaoUi && (
    _listaTexto(selecaoUi.empresasInteiras).length ||
    _listaTexto(selecaoUi.filiaisAvulsas).length
  ));

  if (!ctx || !solicitado) {
    return {
      execucao: null,
      resolvido: { filiaisChave: [] },
      resultado: { solicitado, aplicado: false, erro: solicitado ? 'contexto_lobo_guara_indisponivel' : null },
      selecaoUiValidada: { empresasInteiras: [], filiaisAvulsas: [] },
    };
  }

  const arvore = loboGuaraFilialResolver.arvoreAgrupadaParaSelecao(db, ctx.connectionId);
  const empresasValidas = new Set(arvore.map(e => e.empresaProtheusCodigo));
  const filiaisValidasPorChave = new Map();
  for (const emp of arvore) {
    for (const fil of emp.filiais) filiaisValidasPorChave.set(fil.filialChave, emp.empresaProtheusCodigo);
  }

  const empresasInteirasPedidas = _listaTexto(selecaoUi.empresasInteiras);
  const filiaisAvulsasPedidas = _listaTexto(selecaoUi.filiaisAvulsas);

  // 1a barreira: existe na arvore cadastrada (protheus_company_tree).
  const empresasInteirasNaArvore = empresasInteirasPedidas.filter(cod => empresasValidas.has(cod));
  const filiaisAvulsasNaArvore = filiaisAvulsasPedidas.filter(chave => filiaisValidasPorChave.has(chave));

  // 2a barreira: acesso real do usuario no ERP (quando a sessao tem essa
  // informacao para a empresa). Filial avulsa e checada direto; empresa
  // "inteira" so e mantida como inteira se o ERP autorizar TODAS as filiais
  // dela na arvore — senao vira recorte parcial (so as filiais que o ERP
  // realmente permite), nunca a empresa inteira cadastrada.
  const empresasInteirasValidas = [];
  const filiaisDeEmpresaInteiraRecortada = [];
  for (const cod of empresasInteirasNaArvore) {
    const filiaisErp = _filiaisErpDaEmpresa(filiaisPermitidasSessao, cod);
    if (filiaisErp === null) {
      empresasInteirasValidas.push(cod); // sem info do ERP — mantem comportamento anterior
      continue;
    }
    const filiaisDaEmpresaNaArvore = arvore.find(e => e.empresaProtheusCodigo === cod)?.filiais || [];
    const todasAutorizadas = filiaisDaEmpresaNaArvore.every(f => filiaisErp.has(f.filialChave));
    if (todasAutorizadas) {
      empresasInteirasValidas.push(cod);
    } else {
      for (const f of filiaisDaEmpresaNaArvore) {
        if (filiaisErp.has(f.filialChave)) filiaisDeEmpresaInteiraRecortada.push(f.filialChave);
      }
    }
  }

  const filiaisAvulsasValidas = filiaisAvulsasNaArvore.filter((chave) => {
    const empresaDaFilial = filiaisValidasPorChave.get(chave);
    const filiaisErp = _filiaisErpDaEmpresa(filiaisPermitidasSessao, empresaDaFilial);
    return filiaisErp === null || filiaisErp.has(chave);
  });

  const houveDescarte =
    empresasInteirasNaArvore.length !== empresasInteirasPedidas.length ||
    filiaisAvulsasNaArvore.length !== filiaisAvulsasPedidas.length ||
    empresasInteirasValidas.length !== empresasInteirasNaArvore.length ||
    // Faltava: descarte de filial AVULSA na 2a barreira (ERP nao autoriza).
    // Sem esta linha, pedir uma filial avulsa autorizada + uma nao
    // autorizada (ambas cadastradas na arvore) aplicava so a autorizada mas
    // reportava erro:null, badge de sucesso sem sinalizar que parte da
    // selecao foi descartada.
    filiaisAvulsasValidas.length !== filiaisAvulsasNaArvore.length;

  const chavesExpandidas = empresasInteirasValidas
    .flatMap(cod => loboGuaraFilialResolver.expandirFiliaisDaEmpresa(db, ctx.connectionId, cod));

  const chavesConsolidadas = [...new Set([
    ...chavesExpandidas,
    ...filiaisDeEmpresaInteiraRecortada,
    ...filiaisAvulsasValidas,
  ])].filter(Boolean);

  // Filiais de uma "empresa inteira" que a dupla checagem rebaixou para
  // recorte parcial (ERP nao autoriza 100% da empresa) entram como avulsas
  // na auditoria — o registro precisa refletir o recorte real aplicado, nao
  // repetir o codigo de "empresa inteira" pedido pela UI quando na pratica
  // so uma parte foi honrada (senao a auditoria mente sobre o que rodou).
  const filiaisAvulsasParaAuditoria = [...new Set([...filiaisAvulsasValidas, ...filiaisDeEmpresaInteiraRecortada])];

  if (!chavesConsolidadas.length) {
    // Nada sobrou depois da validacao (ex.: todas as filiais pedidas estavam
    // orfas/desativadas, ou o ERP nao autoriza nenhuma delas) — nao aplica
    // filtro nenhum, mas registra que foi solicitado e nao pode ser
    // confirmado (mesmo tratamento do item 7: nunca mostrar badge de sucesso
    // para escopo que nao pode ser honrado).
    return {
      execucao: null,
      resolvido: { filiaisChave: [] },
      resultado: { solicitado: true, aplicado: false, erro: 'filiais_orfas' },
      selecaoUiValidada: { empresasInteiras: empresasInteirasValidas, filiaisAvulsas: filiaisAvulsasParaAuditoria },
    };
  }

  return {
    execucao: { modo: 'especifica', chaves: chavesConsolidadas },
    resolvido: { filiaisChave: chavesConsolidadas },
    resultado: { solicitado: true, aplicado: true, erro: houveDescarte ? 'selecao_parcialmente_orfa' : null },
    selecaoUiValidada: { empresasInteiras: empresasInteirasValidas, filiaisAvulsas: filiaisAvulsasParaAuditoria },
  };
}

module.exports = { consolidarEscopoFilial };
