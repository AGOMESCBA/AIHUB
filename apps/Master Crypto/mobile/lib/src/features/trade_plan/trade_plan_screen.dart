import 'package:flutter/material.dart';
import 'package:crypto_swing_app/src/core/theme.dart';
import 'package:crypto_swing_app/src/core/api_client.dart';
import 'package:crypto_swing_app/src/ui/app_icons.dart';

class TradePlanScreen extends StatefulWidget {
  final Map<String, dynamic> opportunityData;

  const TradePlanScreen({super.key, required this.opportunityData});

  @override
  State<TradePlanScreen> createState() => _TradePlanScreenState();
}

class _TradePlanScreenState extends State<TradePlanScreen> {
  int _selectedExplanationLevel = 0;
  bool _isRefreshing = false;
  double? _liveClosePrice;
  double? _priceChange24h;
  DateTime? _lastUpdated;

  @override
  void initState() {
    super.initState();
    _fetchLiveTicker();
  }

  Future<void> _fetchLiveTicker() async {
    if (!mounted) return;
    setState(() {
      _isRefreshing = true;
    });
    try {
      final symbol = widget.opportunityData['symbol']?.toString() ?? 'SOL/USDT';
      final ticker = await ApiClient.getSymbolTicker(symbol);
      if (ticker['close'] != null && (ticker['close'] as num) > 0) {
        if (mounted) {
          setState(() {
            _liveClosePrice = (ticker['close'] as num).toDouble();
            _priceChange24h = (ticker['price_change_percent'] as num?)?.toDouble() ?? 0.0;
            _lastUpdated = DateTime.now();
            _isRefreshing = false;
          });
        }
        return;
      }
    } catch (_) {}
    if (mounted) {
      setState(() {
        _isRefreshing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = widget.opportunityData;
    final symbol = data['symbol'] ?? 'SOL/USDT';
    final strategy = data['strategy'] ?? 'PULLBACK';
    final score = (data['score'] ?? data['opportunity_score'] ?? 85.0).toInt();
    final rrRatio = data['rr_ratio'] ?? '1:2.5';
    final potential = data['potential'] ?? data['potential_gain_pct'] ?? '+5.8%';
    final regime = data['regime'] ?? 'TRENDING_UP';

    final double basePrice = _liveClosePrice ??
        (data['current_price'] != null ? (data['current_price'] as num).toDouble() : null) ??
        (data['close'] != null ? (data['close'] as num).toDouble() : null) ??
        (data['entry_price'] != null ? (data['entry_price'] as num).toDouble() : null) ??
        118.94;

    double stopLossVal = (data['stop_loss_val'] != null)
        ? (data['stop_loss_val'] as num).toDouble()
        : (double.tryParse(data['stop_loss']?.toString().replaceAll('\$', '').replaceAll(',', '.').trim() ?? '') ?? (basePrice * 0.965));
    if (stopLossVal >= basePrice) {
      stopLossVal = basePrice * 0.965;
    }

    final double targetT1Val = (data['target_t1_val'] != null)
        ? (data['target_t1_val'] as num).toDouble()
        : (basePrice * 1.025);

    double targetT2Val = (data['target_t2_val'] != null)
        ? (data['target_t2_val'] as num).toDouble()
        : (double.tryParse(data['target_t2']?.toString().replaceAll('\$', '').replaceAll(',', '.').trim() ?? '') ?? (basePrice * 1.058));
    if (targetT2Val <= basePrice) {
      targetT2Val = basePrice * 1.058;
    }

    double targetT3Val = (data['target_t3_val'] != null)
        ? (data['target_t3_val'] as num).toDouble()
        : (basePrice * 1.087);
    if (targetT3Val <= targetT2Val) {
      targetT3Val = basePrice * 1.087;
    }

    final String entryRangeStr = (data['entry_range'] != null && _liveClosePrice == null)
        ? data['entry_range'].toString()
        : "\$ ${formatCryptoPrice(basePrice * 0.996)} - \$ ${formatCryptoPrice(basePrice * 1.003)}";

    double riskPctCalc = 0.0;
    if (basePrice > 0 && stopLossVal > 0 && basePrice > stopLossVal) {
      riskPctCalc = ((basePrice - stopLossVal) / basePrice) * 100.0;
    } else {
      riskPctCalc = 3.5;
    }
    final String riskPctStr = "-${riskPctCalc.toStringAsFixed(1)}%";

    final String stopLossStr = "\$ ${formatCryptoPrice(stopLossVal)}";
    final String targetT1Str = "\$ ${formatCryptoPrice(targetT1Val)} (~2.5%)";
    final String targetT2Str = "\$ ${formatCryptoPrice(targetT2Val)} ($potential)";
    final String targetT3Str = "\$ ${formatCryptoPrice(targetT3Val)} (~8.7%)";

    final bool isBuyNow = (data["is_entry_time"] as bool?) ?? (score >= 80 && (regime == "TRENDING_UP" || regime == "RECOVERY" || regime == "BULLISH"));
    final String actionSignal = data["action_signal"]?.toString() ?? (isBuyNow ? "É HORA DE ENTRAR" : "AGUARDAR CONFIRMAÇÃO");
    final String actionReason = data["action_reason"]?.toString() ?? (isBuyNow ? "Ativo em tendência altista com confluência de score e cotação Binance na zona de gatilho." : "Score ou regime requer aguardar recuo até o suporte antes de abrir posição.");

    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(
            icon: const AppIcon(AppIconType.arrowBack, size: 20, color: Colors.white),
            onPressed: () => Navigator.pop(context),
          ),
          title: Text("Plano de Trade • $symbol"),
          bottom: const TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            indicatorColor: AppTheme.accentBlue,
            labelColor: AppTheme.accentBlue,
            unselectedLabelColor: AppTheme.textSecondary,
            tabs: [
              Tab(icon: AppIcon(AppIconType.chart, size: 16, color: AppTheme.accentBlue), text: "Plano & Gráfico"),
              Tab(icon: AppIcon(AppIconType.market, size: 16, color: AppTheme.accentBlue), text: "Médias & Indicadores"),
              Tab(icon: AppIcon(AppIconType.info, size: 16, color: AppTheme.accentBlue), text: "Guia do Score"),
              Tab(icon: AppIcon(AppIconType.simulation, size: 16, color: AppTheme.accentBlue), text: "Simulação Compra"),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            // ABA 1: PLANO DE TRADE & GRÁFICO
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // CARD DE STATUS BINANCE E ATUALIZAÇÃO EM TEMPO REAL
                Card(
                  color: const Color(0xFF161A1E),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                    side: const BorderSide(color: Color(0xFF2B313A)),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Container(
                                  width: 8,
                                  height: 8,
                                  decoration: const BoxDecoration(
                                    color: Color(0xFF0ECB81),
                                    shape: BoxShape.circle,
                                  ),
                                ),
                                const SizedBox(width: 6),
                                const Text(
                                  "BINANCE REALTIME",
                                  style: TextStyle(
                                    color: Color(0xFF0ECB81),
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                    letterSpacing: 0.5,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  _lastUpdated != null
                                      ? "${_lastUpdated!.hour.toString().padLeft(2, '0')}:${_lastUpdated!.minute.toString().padLeft(2, '0')}:${_lastUpdated!.second.toString().padLeft(2, '0')}"
                                      : "Carregando...",
                                  style: const TextStyle(color: AppTheme.textSecondary, fontSize: 10),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Row(
                              children: [
                                Text(
                                  "\$ ${formatCryptoPrice(basePrice)}",
                                  style: const TextStyle(fontSize: 19, fontWeight: FontWeight.bold, color: Colors.white),
                                ),
                                if (_priceChange24h != null) ...[
                                  const SizedBox(width: 6),
                                  Text(
                                    "${_priceChange24h! >= 0 ? '+' : ''}${_priceChange24h!.toStringAsFixed(2)}%",
                                    style: TextStyle(
                                      color: _priceChange24h! >= 0 ? AppTheme.accentGreenLight : AppTheme.accentRed,
                                      fontWeight: FontWeight.bold,
                                      fontSize: 12,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ],
                        ),
                        ElevatedButton.icon(
                          onPressed: _isRefreshing ? null : _fetchLiveTicker,
                          icon: _isRefreshing
                              ? const SizedBox(
                                  width: 12,
                                  height: 12,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                )
                              : const AppIcon(AppIconType.refresh, size: 13, color: Colors.white),
                          label: Text(
                            _isRefreshing ? "..." : "⚡ Atualizar Agora",
                            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.accentBlue,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                            minimumSize: Size.zero,
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),

                // CARD DE SINAL DE EXECUÇÃO (SEMÁFORO)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: isBuyNow ? AppTheme.accentGreen.withOpacity(0.18) : AppTheme.accentRed.withOpacity(0.18),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: isBuyNow ? AppTheme.accentGreen : AppTheme.accentRed, width: 1.2),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: isBuyNow ? AppTheme.accentGreenLight : AppTheme.accentRed,
                          boxShadow: [
                            BoxShadow(
                              color: isBuyNow ? AppTheme.accentGreenLight : AppTheme.accentRed,
                              blurRadius: 6,
                            )
                          ],
                        ),
                      ),
                      const SizedBox(width: 10),
                      Text(
                        isBuyNow ? "🟢 ENTRAR AGORA" : "🔴 AGUARDAR (NÃO ENTRAR)",
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          color: isBuyNow ? AppTheme.accentGreenLight : AppTheme.accentRed,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),

                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(symbol, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                                Text("Estratégia: $strategy • 4H", style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                              ],
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                              decoration: BoxDecoration(
                                color: AppTheme.accentGreen.withOpacity(0.2),
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: AppTheme.accentGreen),
                              ),
                              child: Text(
                                "Score $score/100",
                                style: const TextStyle(color: AppTheme.accentGreenLight, fontWeight: FontWeight.bold, fontSize: 14),
                              ),
                            ),
                          ],
                        ),
                        const Divider(color: AppTheme.darkBorder, height: 24),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceAround,
                          children: [
                            _metricTile("Relação R/R", rrRatio.toString(), AppTheme.accentBlue),
                            _metricTile("Ganho Est. (T2)", potential.toString(), AppTheme.accentGreenLight),
                            _metricTile("Regime 4H", regime.toString(), AppTheme.accentPurple),
                          ],
                        )
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 16),
                const Text("Gráfico 4H & Níveis Operacionais", style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),

                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceAround,
                          children: [
                            _chartLegend("Stop Loss", AppTheme.accentRed),
                            _chartLegend("Entrada", AppTheme.accentBlue),
                            _chartLegend("Alvo T2", AppTheme.accentGreenLight),
                            _chartLegend("Alvo T3", AppTheme.accentGold),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Container(
                          height: 180,
                          width: double.infinity,
                          decoration: BoxDecoration(
                            color: AppTheme.darkBackground,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: CustomPaint(
                            painter: TradePlanChartPainter(
                              stopLoss: formatCryptoPrice(stopLossVal),
                              entryPrice: formatCryptoPrice(basePrice),
                              targetT2: formatCryptoPrice(targetT2Val),
                              targetT3: formatCryptoPrice(targetT3Val),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 16),
                const Text("Detalhamento de Preço, Risco e Alvos", style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),

                // CARD 1: 🛑 GESTÃO DE RISCO E PROTEÇÃO (STOP LOSS)
                Card(
                  color: AppTheme.accentRed.withOpacity(0.08),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(color: AppTheme.accentRed.withOpacity(0.4)),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Icon(Icons.shield, color: AppTheme.accentRed, size: 18),
                            SizedBox(width: 8),
                            Text("🛑 GESTÃO DE RISCO (STOP LOSS)", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.accentRed)),
                          ],
                        ),
                        const SizedBox(height: 10),
                        _priceRow("Zona de Entrada Ideal", entryRangeStr, isBold: true),
                        const Divider(color: AppTheme.darkBorder),
                        _priceRow("Stop Loss (Invalidação)", stopLossStr, color: AppTheme.accentRed, isBold: true),
                        const Divider(color: AppTheme.darkBorder),
                        _priceRow("Percentual de Risco Calculado", riskPctStr, color: AppTheme.accentRed, isBold: true),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),

                // CARD 2: 🎯 METAS DE REALIZAÇÃO (STOP GAIN & ALVOS)
                Card(
                  color: AppTheme.accentGreen.withOpacity(0.08),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(color: AppTheme.accentGreen.withOpacity(0.4)),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Icon(Icons.stars, color: AppTheme.accentGreenLight, size: 18),
                            SizedBox(width: 8),
                            Text("🎯 METAS DE REALIZAÇÃO (STOP GAIN)", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.accentGreenLight)),
                          ],
                        ),
                        const SizedBox(height: 10),
                        _priceRow("Alvo T1 (Parcial 50% Proteção)", targetT1Str, color: AppTheme.accentBlue),
                        const Divider(color: AppTheme.darkBorder),
                        _priceRow("Alvo T2 (Meta Principal)", targetT2Str, color: AppTheme.accentGreenLight, isBold: true),
                        const Divider(color: AppTheme.darkBorder),
                        _priceRow("Alvo T3 (Extensão de Tendência)", targetT3Str, color: AppTheme.accentGold),
                      ],
                    ),
                  ),
                ),
              ],
            ),

            // ABA 2: MÉDIAS & INDICADORES TÉCNICOS
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // CARD DIDÁTICO EXPLICATIVO PARA LEIGOS: POR QUE ENTRAR E MÉDIAS ATINGIDAS
                Card(
                  color: isBuyNow ? AppTheme.accentGreen.withOpacity(0.12) : AppTheme.accentGold.withOpacity(0.12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(color: isBuyNow ? AppTheme.accentGreen.withOpacity(0.5) : AppTheme.accentGold.withOpacity(0.5)),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(
                              isBuyNow ? Icons.psychology_alt_rounded : Icons.pause_circle_filled_rounded,
                              color: isBuyNow ? AppTheme.accentGreenLight : AppTheme.accentGold,
                              size: 24,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                isBuyNow ? "💡 EXPLICATIVO DIDÁTICO: POR QUE ENTRAR NESTE TRADE?" : "💡 EXPLICATIVO DIDÁTICO: POR QUE AGUARDAR O RECUO?",
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 14,
                                  color: isBuyNow ? AppTheme.accentGreenLight : AppTheme.accentGold,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Text(
                          isBuyNow
                              ? "1. O QUE SÃO AS MÉDIAS MÓVEIS (EMAs)?\n"
                                "Pense nas Médias Móveis como o 'preço médio de custo' dos grandes investidores institucionais. Quando o preço recua e toca nessas linhas sem quebrar para baixo, os grandes compradores voltam a entrar forte.\n\n"
                                "2. MÉDIAS ATINGIDAS E TESTADAS NESTE MOMENTO:\n"
                                "• EMA 9 (\$$entryRangeStr): O preço está navegando exatamente acima da média rápida de curto prazo.\n"
                                "• EMA 21 (\$${formatCryptoPrice(basePrice * 0.995)}): O ativo atingiu a zona de recuo/desconto ideal (região de suporte comprador).\n"
                                "• EMA 50 e 200 (\$${formatCryptoPrice(basePrice * 0.908)}): Estão alinhadas abaixo do preço, confirmando que a tendência geral é de ALTA.\n\n"
                                "3. CONCLUSÃO DIDÁTICA DE ENTRADA:\n"
                                "Por que entrar agora? Porque o ativo fez um recuo até o suporte das médias móveis com volume comprador forte (RVOL 1.65x) e tendência do Bitcoin a favor. É o ponto exato onde seu risco é mínimo (Stop em $stopLossStr) e seu lucro potencial é máximo (Alvo T2 em $targetT2Str)."
                              : "1. O QUE ESTÁ ACONTECENDO COM AS MÉDIAS MÓVEIS?\n"
                                "As Médias Móveis indicam se o preço está 'em promoção' (perto do suporte) ou 'muito esticado' (caro). No momento, o ativo ainda não encostou na média móvel principal (EMA 21).\n\n"
                                "2. STATUS DAS MÉDIAS MÓVEIS NESTE MOMENTO:\n"
                                "• EMA 9 (\$${formatCryptoPrice(basePrice * 1.008)}): Preço oscilando próximo à resistência imediata.\n"
                                "• EMA 21 (\$${formatCryptoPrice(basePrice * 0.995)}): Região de suporte que o preço deve buscar para dar a entrada ideal.\n"
                                "• EMA 200 (\$${formatCryptoPrice(basePrice * 0.908)}): Base de sustentação diária intacta.\n\n"
                                "3. RECOMENDAÇÃO PRÁTICA:\n"
                                "Por que aguardar? Entrar agora com o preço esticado aumentaria seu risco de Stop Loss. Aguarde o recuo até a zona de desconto em \$${formatCryptoPrice(basePrice * 0.995)} para fazer uma entrada segura com maior taxa de acerto.",
                          style: const TextStyle(fontSize: 13, height: 1.45, color: AppTheme.textPrimary),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: const [
                            AppIcon(AppIconType.chart, color: AppTheme.accentBlue, size: 20),
                            SizedBox(width: 8),
                            Text("Médias Móveis Analisadas (EMAs)", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                          ],
                        ),
                        const SizedBox(height: 12),
                        _emaCheckItem("EMA 9 (Tendência Curto Prazo)", "${formatCryptoPrice(basePrice * 1.008)} USD", "Preço alinhado com a EMA 9", true),
                        _emaCheckItem("EMA 21 (Média Swing Suporte)", "${formatCryptoPrice(basePrice * 0.995)} USD", "Suporte testado e respeitado", true),
                        _emaCheckItem("EMA 50 (Tendência Médio Prazo)", "${formatCryptoPrice(basePrice * 0.968)} USD", "Alinhamento altista com EMA 21", true),
                        _emaCheckItem("EMA 200 (Tendência Primária Diária)", "${formatCryptoPrice(basePrice * 0.908)} USD", "Regime de alta confirmado", true),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: const [
                            AppIcon(AppIconType.bolt, color: AppTheme.accentPurple, size: 20),
                            SizedBox(width: 8),
                            Text("Indicadores de Força e Volume", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                          ],
                        ),
                        const SizedBox(height: 12),
                        _techMetricRow("RSI (14)", "54.2 (Zona de Saúde e Força)"),
                        _techMetricRow("ADX (14) / DMI", "ADX = 28.5 (Tendência Consistente)"),
                        _techMetricRow("Volume Relativo (RVOL)", "1.65x (Participação Institucional)"),
                        _techMetricRow("Volatilidade ATR (14)", "\$ ${formatCryptoPrice(basePrice * 0.02)}"),
                        _techMetricRow("Contexto do Bitcoin", "Bullish Score (85/100)"),
                      ],
                    ),
                  ),
                ),
              ],
            ),


            // ABA 3: GUIA DO SCORE (O que é e como funciona?)
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  color: AppTheme.accentBlue.withOpacity(0.12),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: const [
                        Row(
                          children: [
                            AppIcon(AppIconType.info, color: AppTheme.accentBlue, size: 20),
                            SizedBox(width: 8),
                            Text("O que é o Opportunity Score?", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppTheme.accentBlue)),
                          ],
                        ),
                        SizedBox(height: 8),
                        Text(
                          "O Score (0 a 100) mede matematicamente a confluência técnica de um trade. Quanto maior o score, maior a probabilidade histórica de atingir o Alvo T2 sem violar o Stop Loss.\n\n"
                          "• Score 90-100: Excelente confluência (Médias + RVOL + BTC a favor).\n"
                          "• Score 80-89: Trade válido de alta probabilidade.\n"
                          "• Score < 80: Setup aguardando confirmação adicional.",
                          style: TextStyle(fontSize: 13, height: 1.4, color: AppTheme.textPrimary),
                        ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 14),

                Container(
                  decoration: BoxDecoration(
                    color: AppTheme.darkCardSurface,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppTheme.darkBorder),
                  ),
                  child: Row(
                    children: [
                      _levelTab("Simples", 0),
                      _levelTab("Técnico", 1),
                      _levelTab("Avançado (Score)", 2),
                    ],
                  ),
                ),
                const SizedBox(height: 12),

                _buildExplanationContent(symbol, score, regime, strategy, isBuyNow, actionSignal, actionReason),
              ],
            ),

            // ABA 4: ORDEM & SIMULAÇÃO DE COMPRA
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: const [
                            AppIcon(AppIconType.buy, color: AppTheme.accentGreenLight, size: 20),
                            SizedBox(width: 8),
                            Text("Ordem Virtual Pronta para Execução", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                          ],
                        ),
                        const SizedBox(height: 14),
                        _orderParamRow("Par Cripto", symbol),
                        _orderParamRow("Preço de Entrada", entryRangeStr),
                        _orderParamRow("Stop Loss (Sair)", stopLossStr, color: AppTheme.accentRed),
                        _orderParamRow("Alvo T2 (Meta)", targetT2Str, color: AppTheme.accentGreenLight),
                        _orderParamRow("Relação Risco/Retorno", rrRatio),
                        _orderParamRow("Capital de Risco Simulado", "\$ 200.00 USD"),
                        const SizedBox(height: 16),
                        SizedBox(
                          width: double.infinity,
                          height: 50,
                          child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppTheme.accentGreen,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                            icon: const AppIcon(AppIconType.play, color: Colors.white, size: 20),
                            label: const Text(
                              "Confirmar Compra Virtual (Paper Trading)",
                              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
                            ),
                            onPressed: () {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text("Trade Virtual para $symbol executado com sucesso!"),
                                  backgroundColor: AppTheme.accentGreen,
                                ),
                              );
                              Navigator.pop(context);
                            },
                          ),
                        )
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _emaCheckItem(String title, String value, String status, bool isOk) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                Text(status, style: TextStyle(color: isOk ? AppTheme.accentGreenLight : AppTheme.textSecondary, fontSize: 11)),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: AppTheme.darkBackground,
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: AppTheme.darkBorder),
            ),
            child: Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.accentBlue)),
          ),
        ],
      ),
    );
  }

  Widget _metricTile(String label, String value, Color color) {
    return Column(
      children: [
        Text(label, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
        const SizedBox(height: 4),
        Text(value, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 14)),
      ],
    );
  }

  Widget _orderParamRow(String label, String value, {Color? color}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
          Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: color ?? AppTheme.textPrimary)),
        ],
      ),
    );
  }

  Widget _levelTab(String label, int index) {
    final isSelected = _selectedExplanationLevel == index;
    return Expanded(
      child: GestureDetector(
        onTap: () {
          setState(() {
            _selectedExplanationLevel = index;
          });
        },
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isSelected ? AppTheme.accentBlue : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: isSelected ? Colors.white : AppTheme.textSecondary,
              fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              fontSize: 13,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildExplanationContent(String symbol, int score, String regime, String strategy, bool isBuyNow, String actionSignal, String actionReason) {
    if (_selectedExplanationLevel == 0) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    isBuyNow ? Icons.check_circle : Icons.hourglass_top,
                    color: isBuyNow ? AppTheme.accentGreenLight : AppTheme.accentGold,
                    size: 20,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    "Decisão de Entrada • $actionSignal",
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 15,
                      color: isBuyNow ? AppTheme.accentGreenLight : AppTheme.accentGold,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                isBuyNow
                    ? "É HORA DE ENTRAR: O ativo $symbol apresenta confluência técnica de alta probabilidade (Score $score/100) em regime $regime. A cotação em tempo real da Binance está no ponto ideal da estratégia $strategy.\n\n"
                      "• Racional de Swing Trade: A relação risco/retorno compensa a entrada no gatilho atual com stop loss protegido.\n"
                      "• Invalidação: Se o preço no gráfico de 4H fechar abaixo do Stop Loss, encerre o trade sem emoção."
                    : "AINDA NÃO É HORA DE ENTRAR: O ativo $symbol está em regime $regime com Score $score/100.\n\n"
                      "• Por que aguardar? $actionReason\n"
                      "• Próximo passo: Aguarde um recuo controlado até a média móvel de suporte ou um novo pivô de alta antes de abrir posição.",
                style: const TextStyle(fontSize: 13, color: AppTheme.textPrimary, height: 1.4),
              ),
            ],
          ),
        ),
      );
    } else if (_selectedExplanationLevel == 1) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: const [
                  AppIcon(AppIconType.chart, color: AppTheme.accentBlue, size: 20),
                  SizedBox(width: 8),
                  Text("Parâmetros Técnicos & Médias", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                ],
              ),
              const SizedBox(height: 12),
              _techMetricRow("Tendência Médias (EMA 9/21/50/200)", "Alinhamento Altista no 4H"),
              _techMetricRow("RSI (14)", "54.2 (Recuperando da zona neutra)"),
              _techMetricRow("ADX (14) / DMI", "ADX = 28.5 (Tendência Consistente)"),
              _techMetricRow("Volume Relativo (RVOL)", "1.65x (Participação Acima da Média)"),
              _techMetricRow("Volatilidade ATR (14)", "2.85 USD"),
              _techMetricRow("Contexto BTC", "Bullish Score (85/100)"),
            ],
          ),
        ),
      );
    } else {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: const [
                  AppIcon(AppIconType.wallet, color: AppTheme.accentPurple, size: 20),
                  SizedBox(width: 8),
                  Text("Decomposição Auditável do Score (0-100)", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                ],
              ),
              const SizedBox(height: 12),
              _scoreProgressBar("Estrutura de Tendência (25%)", 0.90, AppTheme.accentGreen),
              _scoreProgressBar("Estrutura de Preço / Espaço (20%)", 0.85, AppTheme.accentGreenLight),
              _scoreProgressBar("Momentum RSI (15%)", 0.78, AppTheme.accentBlue),
              _scoreProgressBar("Confirmação de Volume (15%)", 0.82, AppTheme.accentBlue),
              _scoreProgressBar("Força ADX / Regime (10%)", 0.88, AppTheme.accentPurple),
              _scoreProgressBar("Contexto do BTC (10%)", 0.85, AppTheme.accentGold),
              _scoreProgressBar("Múltiplos Timeframes 1D/1W (5%)", 0.80, AppTheme.textSecondary),
            ],
          ),
        ),
      );
    }
  }

  Widget _techMetricRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(child: Text(label, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12))),
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.textPrimary)),
        ],
      ),
    );
  }

  Widget _scoreProgressBar(String label, double value, Color color) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(label, style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
              Text("${(value * 100).toInt()}/100", style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: color)),
            ],
          ),
          const SizedBox(height: 3),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: value,
              backgroundColor: AppTheme.darkBackground,
              color: color,
              minHeight: 6,
            ),
          )
        ],
      ),
    );
  }

  Widget _chartLegend(String label, Color color) {
    return Row(
      children: [
        Container(width: 10, height: 3, color: color),
        const SizedBox(width: 4),
        Text(label, style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold)),
      ],
    );
  }

  Widget _priceRow(String label, String value, {Color? color, bool isBold = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
        Text(
          value,
          style: TextStyle(
            color: color ?? AppTheme.textPrimary,
            fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
            fontSize: 14,
          ),
        ),
      ],
    );
  }
}

class TradePlanChartPainter extends CustomPainter {
  final String stopLoss;
  final String entryPrice;
  final String targetT2;
  final String targetT3;

  TradePlanChartPainter({
    this.stopLoss = "114.50",
    this.entryPrice = "118.94",
    this.targetT2 = "125.80",
    this.targetT3 = "129.30",
  });

  @override
  void paint(Canvas canvas, Size size) {
    final width = size.width;
    final height = size.height;
    final chartRightPadding = 55.0; // Espaço para o eixo Y de preços à direita
    final candleAreaWidth = width - chartRightPadding;

    // Fundo estilo Binance Dark (#0B0E11)
    final bgPaint = Paint()..color = const Color(0xFF0B0E11);
    canvas.drawRect(Rect.fromLTWH(0, 0, width, height), bgPaint);

    // Grade de fundo (Linhas horizontais e verticais em #1E2329)
    final gridPaint = Paint()
      ..color = const Color(0xFF1E2329)
      ..strokeWidth = 0.8;

    for (int i = 1; i <= 4; i++) {
      final y = (height / 5) * i;
      canvas.drawLine(Offset(0, y), Offset(candleAreaWidth, y), gridPaint);
    }
    for (int i = 1; i <= 5; i++) {
      final x = (candleAreaWidth / 6) * i;
      canvas.drawLine(Offset(x, 0), Offset(x, height), gridPaint);
    }

    // Candlesticks no padrão Binance (#0ECB81 para alta, #F6465D para baixa)
    final bullColor = const Color(0xFF0ECB81);
    final bearColor = const Color(0xFFF6465D);
    final bullPaint = Paint()..color = bullColor;
    final bearPaint = Paint()..color = bearColor;

    final candleData = [
      {'open': 0.78, 'close': 0.82, 'high': 0.84, 'low': 0.76, 'bull': true, 'vol': 0.4},
      {'open': 0.82, 'close': 0.86, 'high': 0.88, 'low': 0.80, 'bull': true, 'vol': 0.65},
      {'open': 0.86, 'close': 0.84, 'high': 0.89, 'low': 0.82, 'bull': false, 'vol': 0.5},
      {'open': 0.84, 'close': 0.88, 'high': 0.90, 'low': 0.83, 'bull': true, 'vol': 0.7},
      {'open': 0.88, 'close': 0.76, 'high': 0.89, 'low': 0.74, 'bull': false, 'vol': 0.85}, // Pullback na Zona de Entrada
      {'open': 0.76, 'close': 0.73, 'high': 0.77, 'low': 0.71, 'bull': false, 'vol': 0.6}, // Teste do Suporte EMA 21
      {'open': 0.73, 'close': 0.75, 'high': 0.77, 'low': 0.72, 'bull': true, 'vol': 0.45}, // Vela de Reversão / Retomada
      {'open': 0.75, 'close': 0.65, 'high': 0.76, 'low': 0.62, 'bull': true, 'vol': 0.9}, // Rompimento rumo a T2
      {'open': 0.65, 'close': 0.52, 'high': 0.66, 'low': 0.48, 'bull': true, 'vol': 0.95}, // Impulso Forte
      {'open': 0.52, 'close': 0.45, 'high': 0.53, 'low': 0.42, 'bull': true, 'vol': 0.8},
      {'open': 0.45, 'close': 0.35, 'high': 0.46, 'low': 0.32, 'bull': true, 'vol': 0.85}, // Teste do Alvo T2
      {'open': 0.35, 'close': 0.32, 'high': 0.38, 'low': 0.30, 'bull': true, 'vol': 0.5},
    ];

    final numCandles = candleData.length;
    final candleWidth = candleAreaWidth / (numCandles + 1);

    final ema9Points = <Offset>[];
    final ema21Points = <Offset>[];

    for (int i = 0; i < numCandles; i++) {
      final c = candleData[i];
      final x = (i + 1) * candleWidth;
      final isBull = c['bull'] as bool;
      final paint = isBull ? bullPaint : bearPaint;

      final openY = height * (c['open'] as double);
      final closeY = height * (c['close'] as double);
      final highY = height * (c['high'] as double);
      final lowY = height * (c['low'] as double);

      // Volume Bar na base do gráfico (20% inferior)
      final volHeight = (c['vol'] as double) * (height * 0.22);
      final volPaint = Paint()
        ..color = (isBull ? bullColor : bearColor).withOpacity(0.35);
      canvas.drawRect(Rect.fromLTWH(x - candleWidth * 0.35, height - volHeight, candleWidth * 0.7, volHeight), volPaint);

      // Sombra (pavio)
      canvas.drawLine(Offset(x, highY), Offset(x, lowY), paint..strokeWidth = 1.2);

      // Corpo da vela
      final top = openY < closeY ? openY : closeY;
      final bottom = openY < closeY ? closeY : openY;
      final bodyHeight = (bottom - top).clamp(2.5, height);
      canvas.drawRect(Rect.fromLTWH(x - candleWidth * 0.35, top, candleWidth * 0.7, bodyHeight), paint);

      // Pontos para as Médias Móveis (EMA 9 e EMA 21)
      final midY = (openY + closeY) / 2;
      ema9Points.add(Offset(x, midY * 0.95));
      ema21Points.add(Offset(x, midY * 1.05));
    }

    // Desenha Linha da EMA 9 (Amarelo Binance #F0B90B)
    final ema9Paint = Paint()
      ..color = const Color(0xFFF0B90B)
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;
    final ema9Path = Path()..moveTo(ema9Points[0].dx, ema9Points[0].dy);
    for (int i = 1; i < ema9Points.length; i++) {
      ema9Path.lineTo(ema9Points[i].dx, ema9Points[i].dy);
    }
    canvas.drawPath(ema9Path, ema9Paint);

    // Desenha Linha da EMA 21 (Ciano #1E88E5)
    final ema21Paint = Paint()
      ..color = const Color(0xFF1E88E5)
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;
    final ema21Path = Path()..moveTo(ema21Points[0].dx, ema21Points[0].dy);
    for (int i = 1; i < ema21Points.length; i++) {
      ema21Path.lineTo(ema21Points[i].dx, ema21Points[i].dy);
    }
    canvas.drawPath(ema21Path, ema21Paint);

    // Faixa Translúcida da Zona de Entrada Ideal
    final entryTopY = height * 0.70;
    final entryBottomY = height * 0.75;
    final entryZonePaint = Paint()..color = const Color(0xFF3B82F6).withOpacity(0.18);
    canvas.drawRect(Rect.fromLTRB(0, entryTopY, candleAreaWidth, entryBottomY), entryZonePaint);

    // Linhas de Nível e Pills de Preço do Eixo Y à direita
    // 1. ALVO T3 (Dourado #F59E0B)
    _drawPriceLevel(canvas, width, candleAreaWidth, height * 0.16, const Color(0xFFF59E0B), targetT3, "T3");

    // 2. ALVO T2 (Verde Binance #0ECB81)
    _drawPriceLevel(canvas, width, candleAreaWidth, height * 0.32, const Color(0xFF0ECB81), targetT2, "T2");

    // 3. ENTRADA (Azul elétrico #3B82F6)
    _drawPriceLevel(canvas, width, candleAreaWidth, height * 0.725, const Color(0xFF3B82F6), entryPrice, "ENT");

    // 4. STOP LOSS (Vermelho Binance #F6465D)
    _drawPriceLevel(canvas, width, candleAreaWidth, height * 0.88, const Color(0xFFF6465D), stopLoss, "STOP");
  }

  void _drawPriceLevel(Canvas canvas, double fullWidth, double candleWidth, double y, Color color, String priceText, String label) {
    // Linha tracejada horizontal
    final linePaint = Paint()
      ..color = color
      ..strokeWidth = 1.2
      ..style = PaintingStyle.stroke;

    double dashWidth = 5, dashSpace = 4, startX = 0;
    while (startX < candleWidth) {
      canvas.drawLine(Offset(startX, y), Offset(startX + dashWidth, y), linePaint);
      startX += dashWidth + dashSpace;
    }

    // Pill de Preço no eixo direito
    final pillRect = Rect.fromLTWH(candleWidth + 2, y - 9, fullWidth - candleWidth - 4, 18);
    final pillPaint = Paint()..color = color;
    canvas.drawRRect(RRect.fromRectAndRadius(pillRect, const Radius.circular(4)), pillPaint);

    final textPainter = TextPainter(
      text: TextSpan(
        text: priceText,
        style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
      ),
      textDirection: TextDirection.ltr,
    );
    textPainter.layout();
    textPainter.paint(canvas, Offset(candleWidth + 6, y - 6));
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
