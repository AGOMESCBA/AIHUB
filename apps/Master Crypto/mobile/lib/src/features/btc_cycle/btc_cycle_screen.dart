import 'package:flutter/material.dart';
import 'package:crypto_swing_app/src/core/theme.dart';

class BTCCycleScreen extends StatefulWidget {
  const BTCCycleScreen({Key? key}) : super(key: key);

  @override
  State<BTCCycleScreen> createState() => _BTCCycleScreenState();
}

class _BTCCycleScreenState extends State<BTCCycleScreen> {
  int _selectedComparisonCycleIndex = 0; // 0 = 2020, 1 = 2016, 2 = 2012, 3 = Média Histórica

  final List<Map<String, dynamic>> _comparisonCycles = const [
    {
      "title": "Ciclo 2020 (Halving 2020)",
      "top_price": "\$ 69.000",
      "correlation": "86.5%",
      "days_to_peak": "548 Dias",
      "gain_from_halving": "+650%",
      "color": AppTheme.accentGreenLight,
      "description": "Ciclo de adoção institucional pós-Covid e aprovação de ETFs Spot."
    },
    {
      "title": "Ciclo 2016 (Halving 2016)",
      "top_price": "\$ 19.800",
      "correlation": "79.2%",
      "days_to_peak": "526 Dias",
      "gain_from_halving": "+2.900%",
      "color": AppTheme.accentBlue,
      "description": "Ciclo da corrida das Altcoins (ICO boom) e amadurecimento das exchanges."
    },
    {
      "title": "Ciclo 2012 (Halving 2012)",
      "top_price": "\$ 1.200",
      "correlation": "68.4%",
      "days_to_peak": "371 Dias",
      "gain_from_halving": "+9.000%",
      "color": AppTheme.accentGold,
      "description": "Primeiro grande ciclo histórico com forte volatilidade inicial."
    },
    {
      "title": "Média dos 3 Ciclos Passados",
      "top_price": "\$ 138.000 (Projeção)",
      "correlation": "84.8%",
      "days_to_peak": "481 Dias",
      "gain_from_halving": "+1.200%",
      "color": AppTheme.accentPurple,
      "description": "Modelo matemático ponderado consolidando os 3 ciclos prévios."
    }
  ];

  @override
  Widget build(BuildContext context) {
    final currentCycle = _comparisonCycles[_selectedComparisonCycleIndex];

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Explicativo em Linguagem Simples
          Card(
            color: AppTheme.accentGold.withOpacity(0.1),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: BorderSide(color: AppTheme.accentGold.withOpacity(0.5), width: 1),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: const [
                  Row(
                    children: [
                      Icon(Icons.insights, color: AppTheme.accentGold, size: 22),
                      SizedBox(width: 8),
                      Text(
                        "O que são os Ciclos do Bitcoin?",
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppTheme.accentGold),
                      ),
                    ],
                  ),
                  SizedBox(height: 8),
                  Text(
                    "O Bitcoin possui um evento programado a cada 4 anos chamado Halving, que reduz a emissão de novos moedas pela metade. Históricamente, isso gera um ciclo previsível:\n\n"
                    "1. Acumulação (Ano pós-queda)\n"
                    "2. Rompimento de Topo (Ano do Halving)\n"
                    "3. Parabólica de Alta / Altseason (Ano 2 pós-Halving - FASE ATUAL)\n"
                    "4. Correção Geral de Mercado.",
                    style: TextStyle(fontSize: 13, height: 1.4, color: AppTheme.textPrimary),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 16),
          const Text("Selecione o Ciclo para Comparação Histórica", style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),

          // Selector Interativo de Anos / Ciclos
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: List.generate(_comparisonCycles.length, (idx) {
                final cycle = _comparisonCycles[idx];
                final isSelected = idx == _selectedComparisonCycleIndex;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    selected: isSelected,
                    label: Text(
                      cycle['title'],
                      style: TextStyle(
                        color: isSelected ? Colors.white : AppTheme.textSecondary,
                        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                        fontSize: 12,
                      ),
                    ),
                    selectedColor: AppTheme.accentBlue,
                    backgroundColor: AppTheme.darkCardSurface,
                    side: BorderSide(color: isSelected ? AppTheme.accentBlue : AppTheme.darkBorder),
                    onSelected: (val) {
                      if (val) {
                        setState(() {
                          _selectedComparisonCycleIndex = idx;
                        });
                      }
                    },
                  ),
                );
              }),
            ),
          ),

          const SizedBox(height: 16),

          // Card do Gráfico de Sobreposição (Overlay Chart)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          "Atual vs ${currentCycle['title']}",
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: AppTheme.accentGreen.withOpacity(0.18),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          "Correlação ${currentCycle['correlation']}",
                          style: const TextStyle(color: AppTheme.accentGreenLight, fontWeight: FontWeight.bold, fontSize: 11),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: SizedBox(
                      height: 180,
                      width: double.infinity,
                      child: CustomPaint(
                        painter: DetailedCycleChartPainter(cycleIndex: _selectedComparisonCycleIndex),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 12,
                    runSpacing: 6,
                    children: [
                      _legendItem("Ciclo Atual (2024-2028)", AppTheme.accentPurple),
                      _legendItem(currentCycle['title'], currentCycle['color']),
                    ],
                  )
                ],
              ),
            ),
          ),

          const SizedBox(height: 16),
          const Text("Métricas do Ciclo Atual (2024-2028)", style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),

          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _metricTile("Dias Pós-Halving", "512 Dias", AppTheme.accentBlue),
                      _metricTile("Progresso", "58%", AppTheme.accentGold),
                      _metricTile("Projeção Topo", currentCycle['top_price'], AppTheme.accentGreenLight),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: const [
                          Text("Progresso Temporal (Dia 0 a 1.400)", style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                          Text("58% Concluído", style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.accentGold)),
                        ],
                      ),
                      const SizedBox(height: 6),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: const LinearProgressIndicator(
                          value: 0.58,
                          backgroundColor: AppTheme.darkBackground,
                          color: AppTheme.accentGold,
                          minHeight: 8,
                        ),
                      )
                    ],
                  )
                ],
              ),
            ),
          ),

          const SizedBox(height: 16),
          const Text("Diagnóstico do Co-piloto para Altcoins", style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),

          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: const [
                      Icon(Icons.lightbulb_outline, color: AppTheme.accentGold, size: 20),
                      SizedBox(width: 8),
                      Text("O que fazer neste momento do ciclo?", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.accentGold)),
                    ],
                  ),
                  const Divider(color: AppTheme.darkBorder, height: 20),
                  Text(
                    "• ${currentCycle['description']}\n\n"
                    "• Historicamente, quando o Bitcoin ultrapassa 500 dias pós-Halving com o mercado em tendência de alta, ocorre a maior rotação de capital para Altcoins (Altseason).\n\n"
                    "• Recomendação para o Radar: Priorize os setups de Pullback e Breakout em altcoins de 1ª camada (como SOL, NEAR, AVAX) no timeframe 4H com Stop Loss bem posicionado.",
                    style: const TextStyle(fontSize: 13, height: 1.4, color: AppTheme.textPrimary),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  Widget _legendItem(String label, Color color) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 10, height: 4, color: color),
        const SizedBox(width: 6),
        Text(label, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.bold)),
      ],
    );
  }

  Widget _metricTile(String label, String value, Color color) {
    return Column(
      children: [
        Text(label, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
        const SizedBox(height: 4),
        Text(value, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 13)),
      ],
    );
  }
}

class DetailedCycleChartPainter extends CustomPainter {
  final int cycleIndex;

  DetailedCycleChartPainter({required this.cycleIndex});

  @override
  void paint(Canvas canvas, Size size) {
    final width = size.width;
    final height = size.height;
    final chartRightPadding = 42.0;
    final candleAreaWidth = width - chartRightPadding;

    // Fundo Slate Dark (#0F172A)
    final bgPaint = Paint()..color = const Color(0xFF0F172A);
    canvas.drawRect(Rect.fromLTWH(0, 0, width, height), bgPaint);

    // Grade de fundo
    final gridPaint = Paint()
      ..color = const Color(0xFF1E293B)
      ..strokeWidth = 0.8;

    for (int i = 1; i <= 4; i++) {
      final y = (height / 5) * i;
      canvas.drawLine(Offset(0, y), Offset(candleAreaWidth, y), gridPaint);
    }
    for (int i = 1; i <= 4; i++) {
      final x = (candleAreaWidth / 5) * i;
      canvas.drawLine(Offset(x, 0), Offset(x, height), gridPaint);
    }

    final historicalColors = [
      const Color(0xFF0ECB81), // Verde Binance
      const Color(0xFF3B82F6), // Azul Elétrico
      const Color(0xFFF59E0B), // Dourado
      const Color(0xFF818CF8), // Roxo
    ];

    final histColor = historicalColors[cycleIndex % historicalColors.length];

    // Desenha Curva Histórica
    final pathHistorical = Path();
    if (cycleIndex == 0) {
      pathHistorical.moveTo(0, height * 0.88);
      pathHistorical.quadraticBezierTo(candleAreaWidth * 0.35, height * 0.82, candleAreaWidth * 0.65, height * 0.32);
      pathHistorical.quadraticBezierTo(candleAreaWidth * 0.85, height * 0.45, candleAreaWidth, height * 0.1);
    } else if (cycleIndex == 1) {
      pathHistorical.moveTo(0, height * 0.90);
      pathHistorical.quadraticBezierTo(candleAreaWidth * 0.4, height * 0.75, candleAreaWidth * 0.7, height * 0.25);
      pathHistorical.quadraticBezierTo(candleAreaWidth * 0.9, height * 0.35, candleAreaWidth, height * 0.05);
    } else if (cycleIndex == 2) {
      pathHistorical.moveTo(0, height * 0.92);
      pathHistorical.quadraticBezierTo(candleAreaWidth * 0.25, height * 0.5, candleAreaWidth * 0.5, height * 0.15);
      pathHistorical.quadraticBezierTo(candleAreaWidth * 0.75, height * 0.6, candleAreaWidth, height * 0.3);
    } else {
      pathHistorical.moveTo(0, height * 0.89);
      pathHistorical.quadraticBezierTo(candleAreaWidth * 0.33, height * 0.78, candleAreaWidth * 0.62, height * 0.28);
      pathHistorical.quadraticBezierTo(candleAreaWidth * 0.82, height * 0.4, candleAreaWidth, height * 0.08);
    }

    // Preenchimento de Gradiente sob a Curva Histórica
    final fillPathHist = Path.from(pathHistorical);
    fillPathHist.lineTo(candleAreaWidth, height);
    fillPathHist.lineTo(0, height);
    fillPathHist.close();

    final histGradPaint = Paint()
      ..shader = LinearGradient(
        colors: [histColor.withOpacity(0.25), histColor.withOpacity(0.0)],
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
      ).createShader(Rect.fromLTWH(0, 0, candleAreaWidth, height));
    canvas.drawPath(fillPathHist, histGradPaint);

    final paintHistorical = Paint()
      ..color = histColor
      ..strokeWidth = 2.2
      ..style = PaintingStyle.stroke;
    canvas.drawPath(pathHistorical, paintHistorical);

    // Desenha Curva do Ciclo Atual (2024-2028)
    final pathCurrent = Path();
    pathCurrent.moveTo(0, height * 0.85);
    pathCurrent.quadraticBezierTo(candleAreaWidth * 0.3, height * 0.9, candleAreaWidth * 0.58, height * 0.45);

    final fillPathCurrent = Path.from(pathCurrent);
    fillPathCurrent.lineTo(candleAreaWidth * 0.58, height);
    fillPathCurrent.lineTo(0, height);
    fillPathCurrent.close();

    final currGradPaint = Paint()
      ..shader = LinearGradient(
        colors: [const Color(0xFF818CF8).withOpacity(0.35), const Color(0xFF818CF8).withOpacity(0.0)],
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
      ).createShader(Rect.fromLTWH(0, 0, candleAreaWidth * 0.58, height));
    canvas.drawPath(fillPathCurrent, currGradPaint);

    final paintCurrent = Paint()
      ..color = const Color(0xFF818CF8)
      ..strokeWidth = 3.2
      ..style = PaintingStyle.stroke;
    canvas.drawPath(pathCurrent, paintCurrent);

    // Ponto Pulsante de Cabeça no Ciclo Atual
    final headPoint = Offset(candleAreaWidth * 0.58, height * 0.45);
    final glowPaint = Paint()..color = const Color(0xFF818CF8).withOpacity(0.4);
    canvas.drawCircle(headPoint, 8, glowPaint);
    final headPaint = Paint()..color = Colors.white;
    canvas.drawCircle(headPoint, 3.5, headPaint);

    // Eixo Y à Direita com Percentuais de Retorno
    _drawAxisLabel(canvas, candleAreaWidth + 4, height * 0.1, "+1000%", const Color(0xFF0ECB81));
    _drawAxisLabel(canvas, candleAreaWidth + 4, height * 0.4, "+500%", const Color(0xFFF59E0B));
    _drawAxisLabel(canvas, candleAreaWidth + 4, height * 0.7, "+200%", const Color(0xFF3B82F6));
    _drawAxisLabel(canvas, candleAreaWidth + 4, height * 0.9, "0%", AppTheme.textSecondary);
  }

  void _drawAxisLabel(Canvas canvas, double x, double y, String text, Color color) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(color: color, fontSize: 9, fontWeight: FontWeight.bold),
      ),
      textDirection: TextDirection.ltr,
    );
    textPainter.layout();
    textPainter.paint(canvas, Offset(x, y - 5));
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}
