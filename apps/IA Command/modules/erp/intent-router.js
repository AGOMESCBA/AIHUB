const FaturamentoService = require('../services/FaturamentoService');
const FinanceiroService  = require('../services/FinanceiroService');
const PedidosService     = require('../services/PedidosService');
const ClientesService    = require('../services/ClientesService');
const ProdutosService    = require('../services/ProdutosService');

const ROUTES = {
  consultar_faturamento:              FaturamentoService,
  consultar_faturamento_por_cliente:  FaturamentoService,
  consultar_faturamento_por_vendedor: FaturamentoService,
  consultar_top_clientes:             FaturamentoService,
  comparar_faturamento:               FaturamentoService,
  consultar_ticket_medio:             FaturamentoService,
  consultar_titulos_abertos:          FinanceiroService,
  consultar_pedidos_abertos:          PedidosService,
  consultar_clientes_inativos:        ClientesService,
  consultar_produtos_mais_vendidos:   ProdutosService,
};

async function rotear(intent, empresaId) {
  if (intent.intencao === 'desconhecido') {
    return { tipo: 'desconhecido', mensagem: intent._erro || 'Não entendi sua pergunta. Pode reformular?' };
  }

  const service = ROUTES[intent.intencao];
  if (!service) {
    return { tipo: 'erro', mensagem: `Intenção não implementada: ${intent.intencao}` };
  }

  try {
    const resultado = await service.executar(intent, empresaId);
    return { tipo: 'sucesso', ...resultado };
  } catch (err) {
    throw err;
  }
}

module.exports = { rotear };
