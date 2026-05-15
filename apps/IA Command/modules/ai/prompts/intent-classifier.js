const INTENCOES = [
  'consultar_faturamento',
  'consultar_faturamento_por_cliente',
  'consultar_faturamento_por_vendedor',
  'consultar_top_clientes',
  'consultar_titulos_abertos',
  'consultar_pedidos_abertos',
  'comparar_faturamento',
  'consultar_ticket_medio',
  'consultar_clientes_inativos',
  'consultar_produtos_mais_vendidos',
  'desconhecido',
];

function buildPrompt(mensagem) {
  return `Você é um classificador de intenções para consultas de ERP (Protheus/TOTVS).
Analise a mensagem do usuário e retorne um JSON com os campos abaixo.

Intenções permitidas:
${INTENCOES.map((i) => `- ${i}`).join('\n')}

Campos obrigatórios do JSON:
- intencao: string (uma das intenções acima)
- modulo: string (faturamento | financeiro | pedidos | clientes | produtos)
- acao: string (resumo | detalhado | top_n | comparacao | ticket_medio)
- periodo: object { tipo: "mes_atual"|"mes_anterior"|"ano_atual"|"ultimo_trimestre"|"personalizado"|"nenhum", meses_atras: number|null }
- filtros: object (campos extras: cliente, vendedor, produto, filial, status)
- agrupar_por: string|null
- ordenar_por: string|null (campo:asc|desc)
- limite: number|null (para top N)
- confianca: number (0.0 a 1.0)
- precisa_confirmacao: boolean
- origem: "texto"

Regras:
1. Se não reconhecer a intenção, use "desconhecido" e confianca < 0.5.
2. Extraia período de expressões como "este mês", "mês passado", "esse ano", "último trimestre", "janeiro", "nos últimos 3 meses".
3. Para "desconhecido", deixe modulo="", acao="".

Mensagem do usuário:
"${mensagem.replace(/"/g, '\\"')}"

Responda SOMENTE com o JSON, sem markdown.`;
}

module.exports = { buildPrompt, INTENCOES };
