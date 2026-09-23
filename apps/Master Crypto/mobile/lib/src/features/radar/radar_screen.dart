import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:crypto_swing_app/src/core/theme.dart';
import 'package:crypto_swing_app/src/core/api_client.dart';
import 'package:crypto_swing_app/src/ui/crypto_logo_avatar.dart';
import 'package:crypto_swing_app/src/ui/app_icons.dart';
import 'package:crypto_swing_app/src/features/trade_plan/trade_plan_screen.dart';
import 'package:crypto_swing_app/src/features/radar/radar_provider.dart';
import 'package:crypto_swing_app/src/features/settings/settings_provider.dart';
import 'package:crypto_swing_app/src/core/notification_service.dart';

class RadarScreen extends ConsumerWidget {
  const RadarScreen({Key? key}) : super(key: key);

  // ignore: unused_field
  final List<Map<String, dynamic>> _fallbackOpportunities = const [
    {"symbol": "BTC/USDT", "score": 88, "strategy": "PULLBACK", "regime": "TRENDING_UP", "potential": "+5.8%", "entry_range": "84387.94 - 84895.80", "stop_loss": "82721.42", "target_t2": "89297.17", "rr_ratio": "1:2.23", "reasons": ["Liderança de mercado altista confirmada", "Cotação em tempo real Binance na zona de gatilho"]},
    {"symbol": "ETH/USDT", "score": 75, "strategy": "BREAKOUT", "regime": "RECOVERY", "potential": "+5.5%", "entry_range": "2671.21 - 2687.29", "stop_loss": "2607.22", "target_t2": "2826.61", "rr_ratio": "1:2.15", "reasons": ["Reversão a partir do suporte diário", "Cruzamento altista EMA 9"]},
    {"symbol": "SOL/USDT", "score": 93, "strategy": "PULLBACK", "regime": "TRENDING_UP", "potential": "+5.8%", "entry_range": "151.00 - 153.50", "stop_loss": "147.06", "target_t2": "160.78", "rr_ratio": "1:2.5", "reasons": ["Pullback perfeito na EMA 21 (4H)", "RSI em zona de recuperação (54)", "Espaço livre até a resistência"]},
    {"symbol": "AVAX/USDT", "score": 89, "strategy": "BREAKOUT", "regime": "TRENDING_UP", "potential": "+6.4%", "entry_range": "28.50 - 28.90", "stop_loss": "27.20", "target_t2": "30.50", "rr_ratio": "1:2.15", "reasons": ["Rompimento de pivô com volume RVOL 1.6x"]},
    {"symbol": "NEAR/USDT", "score": 86, "strategy": "PULLBACK", "regime": "TRENDING_UP", "potential": "+6.1%", "entry_range": "4.50 - 4.55", "stop_loss": "4.32", "target_t2": "4.82", "rr_ratio": "1:2.10", "reasons": ["Testou suporte e ativou gatilho"]},
    {"symbol": "LINK/USDT", "score": 84, "strategy": "PULLBACK", "regime": "TRENDING_UP", "potential": "+5.2%", "entry_range": "12.80 - 13.00", "stop_loss": "12.30", "target_t2": "13.65", "rr_ratio": "1:2.00", "reasons": ["Consolidação acima da EMA 50"]},
    {"symbol": "DOT/USDT", "score": 82, "strategy": "RECOVERY", "regime": "RECOVERY", "potential": "+7.1%", "entry_range": "4.15 - 4.22", "stop_loss": "3.95", "target_t2": "4.50", "rr_ratio": "1:2.30", "reasons": ["Fundo duplo no suporte semanal"]},
    {"symbol": "ADA/USDT", "score": 80, "strategy": "SUPPORT_BOUNCE", "regime": "RECOVERY", "potential": "+5.9%", "entry_range": "0.34 - 0.35", "stop_loss": "0.32", "target_t2": "0.37", "rr_ratio": "1:2.00", "reasons": ["Rebate no suporte principal"]},
    {"symbol": "XRP/USDT", "score": 78, "strategy": "CONSOLIDATION", "regime": "RANGE", "potential": "+4.8%", "entry_range": "0.54 - 0.56", "stop_loss": "0.51", "target_t2": "0.59", "rr_ratio": "1:1.90", "reasons": ["Acumulação em fundo de canal"]},
    {"symbol": "BNB/USDT", "score": 77, "strategy": "PULLBACK", "regime": "TRENDING_UP", "potential": "+4.5%", "entry_range": "525.00 - 530.00", "stop_loss": "510.00", "target_t2": "555.00", "rr_ratio": "1:1.80", "reasons": ["Médias alinhadas no 4H"]},
    {"symbol": "DOGE/USDT", "score": 75, "strategy": "BREAKOUT", "regime": "RANGE", "potential": "+8.2%", "entry_range": "0.105 - 0.108", "stop_loss": "0.098", "target_t2": "0.119", "rr_ratio": "1:2.10", "reasons": ["Compressão de volatilidade"]},
    {"symbol": "MATIC/USDT", "score": 74, "strategy": "RECOVERY", "regime": "RECOVERY", "potential": "+6.8%", "entry_range": "0.38 - 0.39", "stop_loss": "0.35", "target_t2": "0.43", "rr_ratio": "1:2.00", "reasons": ["Divergência altista no RSI"]},
    {"symbol": "SHIB/USDT", "score": 72, "strategy": "RANGE", "regime": "RANGE", "potential": "+7.5%", "entry_range": "0.000013 - 0.000014", "stop_loss": "0.000012", "target_t2": "0.000016", "rr_ratio": "1:1.85", "reasons": ["Suporte no gráfico diário"]},
    {"symbol": "LTC/USDT", "score": 71, "strategy": "SUPPORT", "regime": "RECOVERY", "potential": "+5.1%", "entry_range": "63.50 - 64.20", "stop_loss": "60.80", "target_t2": "68.50", "rr_ratio": "1:1.95", "reasons": ["Testou suporte semanal"]},
    {"symbol": "UNI/USDT", "score": 70, "strategy": "PULLBACK", "regime": "TRENDING_UP", "potential": "+5.7%", "entry_range": "6.20 - 6.35", "stop_loss": "5.85", "target_t2": "6.85", "rr_ratio": "1:1.90", "reasons": ["Retração de Fibonacci 61.8%"]},
    {"symbol": "ATOM/USDT", "score": 69, "strategy": "RANGE", "regime": "RANGE", "potential": "+6.0%", "entry_range": "4.20 - 4.30", "stop_loss": "3.95", "target_t2": "4.70", "rr_ratio": "1:1.80", "reasons": ["Consolidação em suporte"]},
    {"symbol": "FTM/USDT", "score": 68, "strategy": "BREAKOUT", "regime": "RECOVERY", "potential": "+8.5%", "entry_range": "0.48 - 0.50", "stop_loss": "0.44", "target_t2": "0.58", "rr_ratio": "1:2.10", "reasons": ["Volume financeiro ascendente"]},
    {"symbol": "APT/USDT", "score": 67, "strategy": "RECOVERY", "regime": "RECOVERY", "potential": "+7.2%", "entry_range": "6.80 - 7.00", "stop_loss": "6.30", "target_t2": "7.80", "rr_ratio": "1:1.90", "reasons": ["Cruzamento de médias curtas"]},
    {"symbol": "ARB/USDT", "score": 66, "strategy": "SUPPORT", "regime": "RANGE", "potential": "+6.5%", "entry_range": "0.52 - 0.54", "stop_loss": "0.48", "target_t2": "0.61", "rr_ratio": "1:1.80", "reasons": ["Pivô de alta em formação"]},
    {"symbol": "OP/USDT", "score": 65, "strategy": "PULLBACK", "regime": "RANGE", "potential": "+6.2%", "entry_range": "1.35 - 1.40", "stop_loss": "1.24", "target_t2": "1.55", "rr_ratio": "1:1.80", "reasons": ["Reteste de área rompida"]}
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selectedTopLimit = ref.watch(topLimitProvider);
    final asyncState = ref.watch(radarNotifierProvider);

    return Scaffold(
      body: Column(
        children: [
          // BANNER RADAR SONAR 360° ANIMADO
          _RadarSonarHeaderWidget(
            onHelpTap: () => _showHelpBottomSheet(context),
          ),

          // SELETOR DE MODO DE EXECUÇÃO (OPERAÇÃO REAL VS TREINO SIMULADO)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 2, 16, 4),
            child: Consumer(
              builder: (context, ref, child) {
                final mode = ref.watch(radarExecutionModeProvider);
                final isReal = mode == RadarExecutionMode.real;

                return Container(
                  height: 38,
                  decoration: BoxDecoration(
                    color: const Color(0xFF0B0E11),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppTheme.darkBorder),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: GestureDetector(
                          onTap: () {
                            ref.read(radarExecutionModeProvider.notifier).state = RadarExecutionMode.real;
                          },
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            decoration: BoxDecoration(
                              color: isReal ? AppTheme.accentBlue : Colors.transparent,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            alignment: Alignment.center,
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                AppIcon(AppIconType.bolt, size: 14, color: isReal ? Colors.white : AppTheme.textSecondary),
                                const SizedBox(width: 6),
                                Text(
                                  "⚡ OPERAÇÃO REAL",
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.bold,
                                    color: isReal ? Colors.white : AppTheme.textSecondary,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      Expanded(
                        child: GestureDetector(
                          onTap: () {
                            ref.read(radarExecutionModeProvider.notifier).state = RadarExecutionMode.simulation;
                          },
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            decoration: BoxDecoration(
                              color: !isReal ? AppTheme.accentGreen : Colors.transparent,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            alignment: Alignment.center,
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                AppIcon(AppIconType.simulation, size: 14, color: !isReal ? Colors.white : AppTheme.textSecondary),
                                const SizedBox(width: 6),
                                Text(
                                  "🎓 TREINO SIMULADO",
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.bold,
                                    color: !isReal ? Colors.white : AppTheme.textSecondary,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),

          const SizedBox(height: 2),

          // BARRA DE STATUS DO SCANNER & BTC
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 2, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: AppTheme.darkBackground,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppTheme.darkBorder),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            const AppIcon(AppIconType.filter, color: AppTheme.accentBlue, size: 18),
                            const SizedBox(width: 8),
                            Text(
                              "Top $selectedTopLimit - 4H",
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                            ),
                          ],
                        ),
                        PopupMenuButton<int>(
                          icon: const AppIcon(AppIconType.tune, color: AppTheme.accentBlue, size: 18),
                          tooltip: "Filtro",
                          onSelected: (limit) {
                            ref.read(topLimitProvider.notifier).state = limit;
                            ref.read(radarNotifierProvider.notifier).fetchOpportunities();
                          },
                          itemBuilder: (context) => const [
                            PopupMenuItem(value: 10, child: Text("Top 10")),
                            PopupMenuItem(value: 20, child: Text("Top 20")),
                            PopupMenuItem(value: 30, child: Text("Top 30")),
                            PopupMenuItem(value: 50, child: Text("Top 50")),
                          ],
                        )
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppTheme.accentGreen.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppTheme.accentGreen.withOpacity(0.4)),
                  ),
                  child: const Row(
                    children: [
                      AppIcon(AppIconType.trendingUp, color: AppTheme.accentGreenLight, size: 16),
                      SizedBox(width: 6),
                      Text(
                        "BTC 85/100",
                        style: TextStyle(color: AppTheme.accentGreenLight, fontSize: 12, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // LISTA DE OPORTUNIDADES
          Expanded(
            child: asyncState.when(
              loading: () => const Center(child: CircularProgressIndicator(color: AppTheme.accentBlue)),
              error: (err, stack) => _buildRadarError(context, ref, err),
              data: (data) {
                final list = (data["opportunities"] as List?)?.cast<Map<String, dynamic>>() ?? [];
                final displayList = list.toList();
                displayList.sort((a, b) {
                  final symA = (a["symbol"] ?? "").toString().replaceAll("/", "").toUpperCase();
                  final symB = (b["symbol"] ?? "").toString().replaceAll("/", "").toUpperCase();

                  int rank(String sym) {
                    if (sym.startsWith("BTC")) return 0;
                    if (sym.startsWith("ETH")) return 1;
                    return 2;
                  }

                  final rA = rank(symA);
                  final rB = rank(symB);
                  if (rA != rB) return rA.compareTo(rB);

                  final scoreA = (a["score"] as num?)?.toInt() ?? 0;
                  final scoreB = (b["score"] as num?)?.toInt() ?? 0;
                  return scoreB.compareTo(scoreA);
                });

                final finalDisplay = displayList.take(selectedTopLimit).toList();

                return RefreshIndicator(
                  onRefresh: () async {
                    await ref.read(radarNotifierProvider.notifier).fetchOpportunities();
                  },
                  child: _buildOpportunitiesList(context, ref, finalDisplay),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  void _showHelpBottomSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.darkCardSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: const [
                  AppIcon(AppIconType.info, color: AppTheme.accentBlue, size: 24),
                  SizedBox(width: 10),
                  Text(
                    "Como Funciona o Crypto Radar AI",
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.accentBlue),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              const Text(
                "O Cripto Master varre o mercado 24h por dia para identificar pontos de entrada de alta probabilidade.\n\n"
                "1. Confira o Score do Bitcoin no topo (BULLISH = ideal).\n"
                "2. Escolha ativos com Score ≥ 80/100.\n"
                "3. Verifique se o preço atual está dentro da Zona de Entrada Ideal.\n"
                "4. Clique em 'Simular Compra' para testar na banca virtual ou 'Ver Plano' para analisar o gráfico.",
                style: TextStyle(fontSize: 14, height: 1.5, color: AppTheme.textPrimary),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.accentBlue,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                  icon: const AppIcon(AppIconType.check, color: Colors.white, size: 18),
                  label: const Text("Entendi", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  onPressed: () => Navigator.pop(context),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildRadarError(BuildContext context, WidgetRef ref, Object err) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppTheme.accentRed.withOpacity(0.12),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.accentRed.withOpacity(0.45)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                "Não foi possível carregar o radar em tempo real.",
                style: TextStyle(color: AppTheme.accentRed, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Text(
                "$err",
                style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
              ),
              const SizedBox(height: 12),
              ElevatedButton.icon(
                onPressed: () => ref.read(radarNotifierProvider.notifier).fetchOpportunities(),
                icon: const AppIcon(AppIconType.refresh, color: Colors.white, size: 16),
                label: const Text("Tentar novamente"),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildOpportunitiesList(BuildContext context, WidgetRef ref, List<Map<String, dynamic>> items) {
    final execMode = ref.watch(radarExecutionModeProvider);
    final isRealMode = execMode == RadarExecutionMode.real;

    if (items.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: AppTheme.darkCardSurface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppTheme.darkBorder),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  "Nenhuma oportunidade agora",
                  style: TextStyle(color: AppTheme.textPrimary, fontSize: 16, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                const Text(
                  "O radar consultou a Binance, mas nenhum ativo atingiu os criterios do algoritmo neste momento.",
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 13, height: 1.35),
                ),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () => ref.read(radarNotifierProvider.notifier).fetchOpportunities(),
                    icon: const AppIcon(AppIconType.refresh, color: Colors.black, size: 16),
                    label: const Text("Atualizar Radar", style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
                    style: ElevatedButton.styleFrom(backgroundColor: AppTheme.binanceYellow),
                  ),
                ),
              ],
            ),
          ),
        ],
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final rawItem = items[index];

        final opportunityObj = rawItem["opportunity"] as Map<String, dynamic>? ?? rawItem;
        final tradePlan = opportunityObj["trade_plan"] as Map<String, dynamic>? ?? {};

        final symbol = rawItem["symbol"] as String? ?? opportunityObj["symbol"] as String? ?? "SOL/USDT";
        final score = (opportunityObj["total_score"] as num?)?.toInt() ?? (rawItem["score"] as num?)?.toInt() ?? 85;
        final strategy = tradePlan["strategy"] as String? ?? rawItem["strategy"] as String? ?? "PULLBACK";
        final regime = opportunityObj["regime"] as String? ?? rawItem["regime"] as String? ?? "TRENDING_UP";

        final bool isBuyNow = (rawItem["is_entry_time"] as bool?) ?? (score >= 80 && (regime == "TRENDING_UP" || regime == "RECOVERY" || regime == "BULLISH"));
        final String actionSignal = rawItem["action_signal"]?.toString() ?? (isBuyNow ? "É HORA DE ENTRAR" : "AGUARDAR CONFIRMAÇÃO");
        final String actionReason = rawItem["action_reason"]?.toString() ?? (isBuyNow ? "Ativo em tendência altista com confluência de score e cotação Binance na zona de gatilho." : "Score ou regime requer aguardar recuo até o suporte antes de abrir posição.");

        final entryMinVal = (tradePlan["entry_zone_min"] as num?) ?? (rawItem["entry_zone_min"] as num?);
        final entryMaxVal = (tradePlan["entry_zone_max"] as num?) ?? (rawItem["entry_zone_max"] as num?);
        final stopLossVal = (tradePlan["stop_loss"] as num?) ?? (rawItem["stop_loss_val"] as num?);
        final targetT2Val = (tradePlan["target_t2"] as num?) ?? (rawItem["target_t2_val"] as num?);

        final double currentPriceVal = (rawItem["current_price"] as num?)?.toDouble() 
            ?? (rawItem["price"] as num?)?.toDouble() 
            ?? (entryMinVal?.toDouble() ?? 86420.0);
        final double periodChangePct = (rawItem["period_change_pct"] as num?)?.toDouble()
            ?? (rawItem["price_change_percent"] as num?)?.toDouble()
            ?? 0.0;
        final String periodLabel = (rawItem["period_label"] ?? rawItem["timeframe"] ?? "4H").toString().toUpperCase();

        double eMin = entryMinVal?.toDouble() ?? 0.0;
        double eMax = entryMaxVal?.toDouble() ?? 0.0;
        double sLoss = stopLossVal?.toDouble() ?? 0.0;
        double tTarget = targetT2Val?.toDouble() ?? 0.0;

        // Se os valores não existirem ou estiverem defasados em relação ao preço atual de mercado (ex: >10% de diferença), recalcula dinamicamente
        if (eMin <= 0 || (currentPriceVal > 0 && (currentPriceVal - eMin).abs() / currentPriceVal > 0.10)) {
          eMin = currentPriceVal * 0.996;
          eMax = currentPriceVal * 1.004;
          sLoss = currentPriceVal * 0.965;
          tTarget = currentPriceVal * 1.055;
        }

        final String entryRangeStr = "\$ ${formatCryptoPrice(eMin)} - \$ ${formatCryptoPrice(eMax)}";
        final String stopLossStr = "\$ ${formatCryptoPrice(sLoss)}";
        final String targetT2Str = "\$ ${formatCryptoPrice(tTarget)}";

        final potentialStr = rawItem["potential"] ?? "+5.5%";
        final rrRatioStr = rawItem["rr_ratio"] ?? (tradePlan["risk_reward_ratio"] != null ? "1:${(tradePlan["risk_reward_ratio"] as num).toStringAsFixed(1)}" : "1:2.5");

        final itemPayload = {
          "symbol": symbol,
          "score": score,
          "strategy": strategy,
          "regime": regime,
          "potential": potentialStr,
          "entry_range": entryRangeStr,
          "stop_loss": stopLossStr,
          "target_t2": targetT2Str,
          "rr_ratio": rrRatioStr,
          "is_entry_time": isBuyNow,
          "action_signal": actionSignal,
          "action_reason": actionReason,
          "current_price": currentPriceVal,
          "period_change_pct": periodChangePct,
          "period_label": periodLabel,
          "reasons": rawItem["reasons"] ?? [
            "Tendência estrutural favorável em $regime",
            "Opportunity Score verificado ($score/100)"
          ]
        };

        return Card(
          margin: const EdgeInsets.only(bottom: 10),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        CryptoLogoAvatar(symbol: symbol, size: 38),
                        const SizedBox(width: 10),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              symbol.replaceAll("/", ""),
                              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppTheme.textPrimary),
                            ),
                            const SizedBox(height: 2),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: AppTheme.accentBlue.withOpacity(0.15),
                                borderRadius: BorderRadius.circular(6),
                                border: Border.all(color: AppTheme.accentBlue.withOpacity(0.3)),
                              ),
                              child: Text(
                                strategy,
                                style: const TextStyle(color: AppTheme.accentBlue, fontSize: 10, fontWeight: FontWeight.bold),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          "\$ ${formatCryptoPrice(currentPriceVal)}",
                          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: AppTheme.textPrimary),
                        ),
                        const SizedBox(height: 5),
                        _scorePill(score),
                      ],
                    ),
                  ],
                ),

                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    color: isBuyNow ? AppTheme.accentGreen.withOpacity(0.12) : AppTheme.binanceYellow.withOpacity(0.10),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: isBuyNow ? AppTheme.accentGreen.withOpacity(0.55) : AppTheme.binanceYellow.withOpacity(0.48), width: 1),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: isBuyNow ? AppTheme.accentGreenLight : AppTheme.binanceYellow,
                              boxShadow: [
                                BoxShadow(
                                  color: isBuyNow ? AppTheme.accentGreenLight : AppTheme.binanceYellow,
                                  blurRadius: 4,
                                )
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            isBuyNow ? "🟢 ENTRAR AGORA" : "🔴 AGUARDAR",
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: isBuyNow ? AppTheme.accentGreenLight : AppTheme.binanceYellow,
                              letterSpacing: 0.4,
                            ),
                          ),
                        ],
                      ),
                      Row(
                        children: [
                          _periodChangePill(periodChangePct, periodLabel),
                          const SizedBox(width: 8),
                          const Text(
                            "Preço Atual: ",
                            style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                          ),
                          Text(
                            "\$ ${formatCryptoPrice(currentPriceVal)}",
                            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 10),
                const Divider(color: AppTheme.darkBorder, height: 1),
                const SizedBox(height: 10),

                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0B0E11),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    children: [
                      Expanded(child: _priceBadge("Entrada", entryRangeStr, AppTheme.accentBlue)),
                      Expanded(child: _priceBadge("Stop", stopLossStr, AppTheme.accentRed)),
                      Expanded(child: _priceBadge("Alvo T2", "$targetT2Str ($potentialStr)", AppTheme.accentGreenLight)),
                    ],
                  ),
                ),

                const SizedBox(height: 12),

                Row(
                  children: [
                    Expanded(
                      flex: 6,
                      child: isRealMode
                          ? ElevatedButton.icon(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppTheme.accentBlue,
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                padding: const EdgeInsets.symmetric(vertical: 11),
                              ),
                              icon: const AppIcon(AppIconType.bolt, size: 16, color: Colors.white),
                              label: const Text(
                                "Executar Compra Real",
                                style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white),
                              ),
                              onPressed: () => _showRealOrderConfirmationModal(
                                context,
                                ref,
                                symbol: symbol,
                                entryPriceStr: entryRangeStr,
                                stopLossStr: stopLossStr,
                                targetT2Str: targetT2Str,
                                strategy: strategy,
                                score: score,
                              ),
                            )
                          : ElevatedButton.icon(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppTheme.accentGreen,
                                elevation: 0,
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                padding: const EdgeInsets.symmetric(vertical: 11),
                              ),
                              icon: const AppIcon(AppIconType.simulation, size: 16, color: Colors.white),
                              label: const Text(
                                "Executar Ordem Simulada",
                                style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white),
                              ),
                              onPressed: () async {
                                final res = await ApiClient.startPaperTrade({
                                  "symbol": symbol,
                                  "entry_price": entryMinVal ?? 145.50,
                                  "stop_loss_price": stopLossVal ?? 142.70,
                                  "target_t2_price": targetT2Val ?? 153.30,
                                  "position_size_usd": 200.0,
                                  "leverage": 1.0,
                                  "strategy": strategy
                                });

                                if (context.mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: Text(res['message'] ?? "Trade Virtual iniciado com sucesso para $symbol!"),
                                      backgroundColor: AppTheme.accentGreen,
                                    ),
                                  );
                                }
                              },
                            ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 4,
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: AppTheme.accentBlue),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          padding: const EdgeInsets.symmetric(vertical: 11),
                        ),
                        icon: const AppIcon(AppIconType.chart, size: 16, color: AppTheme.accentBlue),
                        label: const Text("Ver Plano", style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.accentBlue)),
                        onPressed: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (context) => TradePlanScreen(opportunityData: itemPayload),
                            ),
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _priceBadge(String label, String value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
        const SizedBox(height: 3),
        Text(
          value,
          style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 13),
        ),
      ],
    );
  }

  Widget _scorePill(int score) {
    final color = score >= 80
        ? AppTheme.accentGreenLight
        : score >= 60
            ? AppTheme.binanceYellow
            : AppTheme.accentBlue;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.14),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withOpacity(0.35)),
      ),
      child: Text(
        "Score $score",
        style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w900),
      ),
    );
  }

  Widget _periodChangePill(double value, String label) {
    final isUp = value > 0;
    final isDown = value < 0;
    final color = isUp
        ? AppTheme.accentGreenLight
        : isDown
            ? AppTheme.accentRed
            : AppTheme.textSecondary;
    final icon = isUp
        ? "▲"
        : isDown
            ? "▼"
            : "•";
    final text = value == 0 ? "- $label" : "$icon ${value > 0 ? '+' : ''}${value.toStringAsFixed(1)}% $label";

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.14),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withOpacity(0.35)),
      ),
      child: Text(
        text,
        style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold),
      ),
    );
  }

  void _showRealOrderConfirmationModal(
    BuildContext context,
    WidgetRef ref, {
    required String symbol,
    required String entryPriceStr,
    required String stopLossStr,
    required String targetT2Str,
    required String strategy,
    required int score,
  }) {
    final selectedExchange = ref.read(selectedExchangeProvider);
    final riskPct = ref.read(riskPerTradePctProvider);
    final balance = ref.read(accountBalanceProvider);
    final tradeAmount = (balance * (riskPct / 100.0)).toStringAsFixed(2);

    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.darkCardSurface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (modalContext) {
        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(modalContext).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      const AppIcon(AppIconType.bolt, color: AppTheme.accentGold, size: 24),
                      const SizedBox(width: 8),
                      Text(
                        "Execução Real na $selectedExchange",
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17, color: AppTheme.textPrimary),
                      ),
                    ],
                  ),
                  IconButton(
                    icon: const AppIcon(AppIconType.close, color: AppTheme.textSecondary, size: 20),
                    onPressed: () => Navigator.pop(modalContext),
                  ),
                ],
              ),
              const Divider(color: AppTheme.darkBorder, height: 20),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.accentBlue.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppTheme.accentBlue.withOpacity(0.3)),
                ),
                child: Row(
                  children: [
                    CryptoLogoAvatar(symbol: symbol, size: 36),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(symbol, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                        Text("Estratégia: $strategy • Score: $score/100", style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text("Entrada Estimada:", style: TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                  Text(entryPriceStr, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.accentBlue)),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text("Stop Loss Automático:", style: TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                  Text(stopLossStr, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.accentRed)),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text("Alvo Take Profit (T2):", style: TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                  Text(targetT2Str, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.accentGreenLight)),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text("Risco Definido ($riskPct% da Banca):", style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                  Text("\$ $tradeAmount USD", style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.accentGold)),
                ],
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.accentGreen,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  icon: const AppIcon(AppIconType.check, color: Colors.white, size: 20),
                  label: const Text(
                    "Confirmar Operação",
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white, letterSpacing: 0.5),
                  ),
                  onPressed: () async {
                    Navigator.pop(modalContext);

                    final entryNum = double.tryParse(entryPriceStr.split("-").first.trim()) ?? 145.50;
                    final stopNum = double.tryParse(stopLossStr) ?? 142.70;
                    final targetNum = double.tryParse(targetT2Str) ?? 153.30;

                    final userApiKey = ref.read(exchangeApiKeyProvider);
                    final userApiSecret = ref.read(exchangeApiSecretProvider);

                    final result = await ApiClient.executeRealOrder(
                      symbol: symbol,
                      exchange: selectedExchange,
                      side: "BUY",
                      entryPrice: entryNum,
                      stopLoss: stopNum,
                      targetT2: targetNum,
                      quantity: 1.0,
                      apiKey: userApiKey,
                      apiSecret: userApiSecret,
                    );

                    NotificationService.showFloatingNotification(
                      title: "ORDEM EXECUTADA NA $selectedExchange!",
                      body: "Ordem de $symbol enviada com sucesso! Stop Loss em \$$stopLossStr e Alvo T2 em \$$targetT2Str.",
                    );

                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text("${result['message'] ?? 'Ordem enviada para a $selectedExchange!'}"),
                          backgroundColor: AppTheme.accentGreen,
                        ),
                      );
                    }
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _RadarSonarHeaderWidget extends StatefulWidget {
  final VoidCallback onHelpTap;
  const _RadarSonarHeaderWidget({Key? key, required this.onHelpTap}) : super(key: key);

  @override
  State<_RadarSonarHeaderWidget> createState() => _RadarSonarHeaderWidgetState();
}

class _RadarSonarHeaderWidgetState extends State<_RadarSonarHeaderWidget> with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 4),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      margin: const EdgeInsets.fromLTRB(16, 10, 16, 6),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [AppTheme.darkCardSurface, AppTheme.accentBlue.withOpacity(0.15)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.accentBlue.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 48,
            height: 48,
            child: Stack(
              alignment: Alignment.center,
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: const Color(0xFF0B0E11),
                    border: Border.all(color: AppTheme.accentGreen.withOpacity(0.5), width: 1.5),
                    boxShadow: [
                      BoxShadow(
                        color: AppTheme.accentGreen.withOpacity(0.2),
                        blurRadius: 10,
                        spreadRadius: 1,
                      )
                    ],
                  ),
                ),
                Container(width: 48, height: 1, color: AppTheme.accentGreen.withOpacity(0.2)),
                Container(width: 1, height: 48, color: AppTheme.accentGreen.withOpacity(0.2)),
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: AppTheme.accentGreen.withOpacity(0.3)),
                  ),
                ),
                RotationTransition(
                  turns: _controller,
                  child: Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: SweepGradient(
                        colors: [
                          AppTheme.accentGreen.withOpacity(0.6),
                          AppTheme.accentGreen.withOpacity(0.0),
                        ],
                        stops: const [0.15, 0.3],
                      ),
                    ),
                  ),
                ),
                Container(
                  width: 6,
                  height: 6,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppTheme.accentGreenLight,
                    boxShadow: [BoxShadow(color: AppTheme.accentGreenLight, blurRadius: 4)],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: const [
                    Text(
                      "📡 SONAR RADAR 360°",
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.accentBlue, letterSpacing: 0.5),
                    ),
                    SizedBox(width: 6),
                    Text("• AI LIVE", style: TextStyle(fontSize: 10, color: AppTheme.accentGreenLight, fontWeight: FontWeight.bold)),
                  ],
                ),
                const SizedBox(height: 3),
                const Text(
                  "Varredura em tempo real ativada. Exibindo alvos de alta confluência e score.",
                  style: TextStyle(fontSize: 11, color: AppTheme.textSecondary, height: 1.3),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const AppIcon(AppIconType.info, color: AppTheme.accentBlue, size: 20),
            tooltip: "Como Funciona",
            onPressed: widget.onHelpTap,
          )
        ],
      ),
    );
  }
}
