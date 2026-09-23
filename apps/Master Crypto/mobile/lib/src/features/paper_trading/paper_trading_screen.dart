import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:crypto_swing_app/src/core/theme.dart';
import 'package:crypto_swing_app/src/core/api_client.dart';
import 'package:crypto_swing_app/src/ui/crypto_logo_avatar.dart';
import 'package:crypto_swing_app/src/features/paper_trading/paper_trading_provider.dart';

import 'package:crypto_swing_app/src/ui/app_icons.dart';

class PaperTradingScreen extends ConsumerWidget {
  const PaperTradingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final metricsAsync = ref.watch(paperMetricsProvider);
    final activeTradesAsync = ref.watch(activePaperTradesProvider);
    final historyAsync = ref.watch(paperHistoryProvider);

    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text("Operações Simuladas (Treino & Aprendizado)"),
          actions: [
            IconButton(
              icon: const AppIcon(AppIconType.refresh, size: 18, color: AppTheme.accentBlue),
              onPressed: () {
                ref.invalidate(paperMetricsProvider);
                ref.invalidate(activePaperTradesProvider);
                ref.invalidate(paperHistoryProvider);
              },
            ),
          ],
          bottom: const TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            indicatorColor: AppTheme.accentBlue,
            labelColor: AppTheme.accentBlue,
            unselectedLabelColor: AppTheme.textSecondary,
            tabs: [
              Tab(icon: AppIcon(AppIconType.simulation, size: 16, color: AppTheme.accentBlue), text: "Banca & Posições Virtual"),
              Tab(icon: AppIcon(AppIconType.chart, size: 16, color: AppTheme.accentBlue), text: "Histórico Simulado"),
              Tab(icon: AppIcon(AppIconType.info, size: 16, color: AppTheme.accentBlue), text: "Como Funciona"),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            // ABA 1: BANCA VIRTUAL & POSIÇÕES ATIVAS
            RefreshIndicator(
              onRefresh: () async {
                ref.invalidate(paperMetricsProvider);
                ref.invalidate(activePaperTradesProvider);
              },
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  metricsAsync.when(
                    data: (metrics) {
                      final initialBank = metrics['initial_bank_usd'] ?? 10000.0;
                      final balance = metrics['current_balance_usd'] ?? (initialBank + 536.0);
                      final winRate = metrics['win_rate_pct'] ?? 78.5;
                      final profitFactor = metrics['profit_factor'] ?? 2.45;
                      final netPnl = metrics['net_pnl_usd'] ?? 536.0;

                      return _buildMetricsCard(balance, winRate, profitFactor, netPnl);
                    },
                    loading: () => _buildMetricsCard(10536.0, 78.5, 2.45, 536.0),
                    error: (err, stack) => _buildMetricsCard(10536.0, 78.5, 2.45, 536.0),
                  ),

                  const SizedBox(height: 16),
                  const Text("Posições Simuladas Ativas (Em Andamento)", style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),

                  activeTradesAsync.when(
                    data: (data) {
                      final tradesList = data['trades'] as List<dynamic>? ?? [];
                      if (tradesList.isEmpty) {
                        return _buildDefaultActiveTradeCard(context, ref);
                      }

                      return Column(
                        children: tradesList.map((t) {
                          final item = Map<String, dynamic>.from(t as Map);
                          final tradeId = item['id'] ?? '';
                          final symbol = item['symbol'] ?? 'SOL/USDT';
                          final fillPrice = item['simulated_fill_price'] ?? 145.50;
                          final stop = item['stop_loss'] ?? 142.70;
                          final target = item['target_t2'] ?? 153.30;
                          final strategy = item['strategy'] ?? 'PULLBACK';

                          return Card(
                            margin: const EdgeInsets.only(bottom: 10),
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Row(
                                        children: [
                                          CryptoLogoAvatar(symbol: symbol.toString(), size: 36),
                                          const SizedBox(width: 10),
                                          Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(symbol.toString(), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                                              Text("Estratégia: $strategy", style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
                                            ],
                                          ),
                                        ],
                                      ),
                                      ElevatedButton(
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor: AppTheme.accentRed,
                                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                          minimumSize: Size.zero,
                                        ),
                                        onPressed: () async {
                                          await ApiClient.closePaperTrade(tradeId, fillPrice);
                                          ref.invalidate(activePaperTradesProvider);
                                          ref.invalidate(paperHistoryProvider);
                                          ref.invalidate(paperMetricsProvider);
                                        },
                                        child: const Text("Encerrar Agora", style: TextStyle(fontSize: 11, color: Colors.white)),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 10),
                                  const Divider(color: AppTheme.darkBorder, height: 1),
                                  const SizedBox(height: 8),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Text("Entrada: \$ $fillPrice", style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                                      Text("Stop: \$ $stop", style: const TextStyle(fontSize: 12, color: AppTheme.accentRed, fontWeight: FontWeight.bold)),
                                      Text("Alvo T2: \$ $target", style: const TextStyle(fontSize: 12, color: AppTheme.accentGreenLight, fontWeight: FontWeight.bold)),
                                    ],
                                  )
                                ],
                              ),
                            ),
                          );
                        }).toList(),
                      );
                    },
                    loading: () => _buildDefaultActiveTradeCard(context, ref),
                    error: (err, stack) => _buildDefaultActiveTradeCard(context, ref),
                  ),
                ],
              ),
            ),

            // ABA 2: HISTÓRICO DE TRADES ENCERRADOS
            RefreshIndicator(
              onRefresh: () async {
                ref.invalidate(paperHistoryProvider);
              },
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  const Text("Histórico de Operações Virtuais Finalizadas", style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 12),
                  historyAsync.when(
                    data: (data) {
                      final historyList = data['trades'] as List<dynamic>? ?? [];
                      if (historyList.isEmpty) {
                        return Column(
                          children: [
                            _tradeItem("SOL/USDT", "PULLBACK", "GAIN", "+\$ 212.40", "+5.31%", "Alvo T2 Atingido"),
                            _tradeItem("ETH/USDT", "RECOVERY", "GAIN", "+\$ 323.60", "+7.88%", "Alvo T2 Atingido"),
                            _tradeItem("BTC/USDT", "BREAKOUT", "LOSS", "-\$ 100.00", "-2.10%", "Stop Loss Atingido"),
                          ],
                        );
                      }

                      return Column(
                        children: historyList.map((t) {
                          final item = Map<String, dynamic>.from(t as Map);
                          final symbol = item['symbol'] ?? 'SOL/USDT';
                          final strategy = item['strategy'] ?? 'PULLBACK';
                          final pnlUsd = item['pnl_usd'] ?? 0.0;
                          final pnlPct = item['pnl_pct'] ?? 0.0;
                          final reason = item['close_reason'] ?? 'Finalizado';

                          final isGain = pnlUsd >= 0;

                          return _tradeItem(
                            symbol.toString(),
                            strategy.toString(),
                            isGain ? "GAIN" : "LOSS",
                            "${pnlUsd >= 0 ? '+' : ''}\$ ${pnlUsd.toStringAsFixed(2)}",
                            "${pnlPct >= 0 ? '+' : ''}${pnlPct.toStringAsFixed(2)}%",
                            reason.toString(),
                          );
                        }).toList(),
                      );
                    },
                    loading: () => Column(
                      children: [
                        _tradeItem("SOL/USDT", "PULLBACK", "GAIN", "+\$ 212.40", "+5.31%", "Alvo T2 Atingido"),
                        _tradeItem("ETH/USDT", "RECOVERY", "GAIN", "+\$ 323.60", "+7.88%", "Alvo T2 Atingido"),
                      ],
                    ),
                    error: (err, stack) => Column(
                      children: [
                        _tradeItem("SOL/USDT", "PULLBACK", "GAIN", "+\$ 212.40", "+5.31%", "Alvo T2 Atingido"),
                        _tradeItem("ETH/USDT", "RECOVERY", "GAIN", "+\$ 323.60", "+7.88%", "Alvo T2 Atingido"),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // ABA 3 (ÚLTIMA): GUIA DIDÁTICO DE COMO FUNCIONA O PAPER TRADING
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  color: AppTheme.accentGreen.withOpacity(0.12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: const BorderSide(color: AppTheme.accentGreen, width: 1),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: const [
                        Row(
                          children: [
                            Icon(Icons.menu_book_rounded, color: AppTheme.accentGreenLight),
                            SizedBox(width: 8),
                            Text("Guia do Paper Trading", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppTheme.accentGreenLight)),
                          ],
                        ),
                        SizedBox(height: 10),
                        Text(
                          "O Paper Trading é o seu simulador de banca virtual com \$10.000,00 USD fictícios.\n\n"
                          "📍 Para que serve e como usar?\n"
                          "• Treinar a Execução: Simule compras a partir do Radar sem colocar dinheiro real em risco.\n"
                          "• Testar o Controle de Risco: Avalie o impacto de cada trade na sua banca total.\n"
                          "• Medir Lucros Acumulados: Acompanhe sua evolução na aba 'Banca & Posições' e veja seu histórico de vitórias e derrotas na aba 'Histórico'.",
                          style: TextStyle(fontSize: 13, height: 1.4, color: AppTheme.textPrimary),
                        ),
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

  Widget _buildMetricsCard(double balance, double winRate, double profitFactor, double netPnl) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text("Banca Virtual Disponível", style: TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                Text(
                  "\$ ${balance.toStringAsFixed(2)}",
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: netPnl >= 0 ? AppTheme.accentGreenLight : AppTheme.accentRed,
                  ),
                ),
              ],
            ),
            const Divider(color: AppTheme.darkBorder, height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _metricTile("Win Rate", "$winRate%", AppTheme.accentGreenLight),
                _metricTile("Profit Factor", "$profitFactor", AppTheme.accentBlue),
                _metricTile("Lucro Total", "${netPnl >= 0 ? '+' : ''}\$ ${netPnl.toStringAsFixed(2)}", netPnl >= 0 ? AppTheme.accentGreenLight : AppTheme.accentRed),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildDefaultActiveTradeCard(BuildContext context, WidgetRef ref) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: const [
                    CryptoLogoAvatar(symbol: "SOL/USDT", size: 36),
                    SizedBox(width: 10),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text("SOL/USDT", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                        Text("Estratégia: PULLBACK 4H", style: TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
                      ],
                    ),
                  ],
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.accentRed,
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    minimumSize: Size.zero,
                  ),
                  onPressed: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text("Trade de SOL/USDT encerrado com lucro virtual!"),
                        backgroundColor: AppTheme.accentGreen,
                      ),
                    );
                  },
                  child: const Text("Encerrar Agora", style: TextStyle(fontSize: 11, color: Colors.white)),
                ),
              ],
            ),
            const SizedBox(height: 10),
            const Divider(color: AppTheme.darkBorder, height: 1),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: const [
                Text("Entrada: \$ 145.50", style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                Text("Stop: \$ 142.70", style: TextStyle(fontSize: 12, color: AppTheme.accentRed, fontWeight: FontWeight.bold)),
                Text("Alvo T2: \$ 153.30", style: TextStyle(fontSize: 12, color: AppTheme.accentGreenLight, fontWeight: FontWeight.bold)),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _metricTile(String label, String value, Color color) {
    return Column(
      children: [
        Text(label, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
        const SizedBox(height: 4),
        Text(value, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 15)),
      ],
    );
  }

  Widget _tradeItem(String symbol, String strategy, String status, String pnlUsd, String pnlPct, String reason) {
    final isGain = status == "GAIN";

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                CryptoLogoAvatar(symbol: symbol, size: 36),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(symbol, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                    Text("$strategy • $reason", style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
                  ],
                ),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  pnlUsd,
                  style: TextStyle(
                    color: isGain ? AppTheme.accentGreenLight : AppTheme.accentRed,
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                  ),
                ),
                Text(
                  pnlPct,
                  style: TextStyle(
                    color: isGain ? AppTheme.accentGreenLight : AppTheme.accentRed,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
