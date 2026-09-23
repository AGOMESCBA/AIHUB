import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:crypto_swing_app/src/core/theme.dart';
import 'package:crypto_swing_app/src/core/api_client.dart';
import 'package:crypto_swing_app/src/ui/app_icons.dart';
import 'package:crypto_swing_app/src/ui/crypto_logo_avatar.dart';
import 'package:crypto_swing_app/src/features/settings/settings_provider.dart';

final realActiveOrdersProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final exchange = ref.watch(selectedExchangeProvider);
  final apiKey = ref.watch(exchangeApiKeyProvider);
  final apiSecret = ref.watch(exchangeApiSecretProvider);
  
  return ApiClient.executeRealOrder(
    symbol: "SOL/USDT",
    exchange: exchange,
    side: "BUY",
    entryPrice: 118.94,
    stopLoss: 114.50,
    targetT2: 125.80,
    quantity: 1.0,
    apiKey: apiKey,
    apiSecret: apiSecret,
  );
});

final realWalletBalancesProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final ip = ref.watch(serverIpProvider);
  ApiClient.setServerIp(ip);
  return ApiClient.getWalletBalances();
});

class RealTradingScreen extends ConsumerWidget {
  const RealTradingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selectedExchange = ref.watch(selectedExchangeProvider);
    final walletAsync = ref.watch(realWalletBalancesProvider);
    final walletData = walletAsync.asData?.value;

    final isAuthenticated = walletData?["authenticated"] == true;
    final totalUsdt = (walletData?["total_usdt"] as num?)?.toDouble() ?? 0.0;
    final totalBrl = (walletData?["total_brl"] as num?)?.toDouble() ?? 0.0;
    final assetsList = (walletData?["assets"] as List<dynamic>?) ?? [];

    return DefaultTabController(
      length: 3,
      child: Scaffold(
        body: Column(
          children: [
            // CABEÇALHO ESTILO BINANCE (EST. DE VALOR TOTAL & AÇÕES RÁPIDAS)
            Container(
              padding: const EdgeInsets.all(16),
              margin: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              decoration: BoxDecoration(
                color: const Color(0xFF181A20), // Binance Dark Surface
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFF2B313A)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.3),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  )
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: [
                          const AppIcon(AppIconType.wallet, size: 18, color: AppTheme.textSecondary),
                          const SizedBox(width: 8),
                          Text(
                            "Est. de Valor Total ($selectedExchange)",
                            style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary, fontWeight: FontWeight.w500),
                          ),
                        ],
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: isAuthenticated ? AppTheme.accentGreen.withOpacity(0.15) : AppTheme.accentGold.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: isAuthenticated ? AppTheme.accentGreen.withOpacity(0.4) : AppTheme.accentGold.withOpacity(0.4)),
                        ),
                        child: Row(
                          children: [
                            AppIcon(isAuthenticated ? AppIconType.check : AppIconType.warning, size: 10, color: isAuthenticated ? AppTheme.accentGreenLight : AppTheme.accentGold),
                            const SizedBox(width: 4),
                            Text(
                              isAuthenticated ? "API Conectada" : "Chaves Pendentes",
                              style: TextStyle(color: isAuthenticated ? AppTheme.accentGreenLight : AppTheme.accentGold, fontSize: 10, fontWeight: FontWeight.bold),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text(
                        isAuthenticated ? totalUsdt.toStringAsFixed(2) : "0,00 ",
                        style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold, color: Colors.white),
                      ),
                      const Text(
                        " USDT",
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: AppTheme.textSecondary),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Text(
                        "≈ R\$ ${isAuthenticated ? totalBrl.toStringAsFixed(2) : "0,00"}",
                        style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                      ),
                      if (isAuthenticated) ...[
                        const SizedBox(width: 12),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppTheme.accentGreen.withOpacity(0.2),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: const Text(
                            "Sincronizado ⚡",
                            style: TextStyle(color: AppTheme.accentGreenLight, fontSize: 11, fontWeight: FontWeight.bold),
                          ),
                        ),
                      ]
                    ],
                  ),
                  const SizedBox(height: 16),

                  // BOTÕES DE AÇÃO RÁPIDA (BINANCE STYLE)
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _quickActionButton(AppIconType.add, "Adicionar"),
                      _quickActionButton(AppIconType.arrowUp, "Enviar"),
                      _quickActionButton(AppIconType.transfer, "Transferir"),
                      _quickActionButton(AppIconType.earn, "Ganhar"),
                    ],
                  ),
                ],
              ),
            ),

            // SELETOR DE ABAS
            const TabBar(
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              indicatorColor: AppTheme.accentBlue,
              labelColor: AppTheme.accentBlue,
              unselectedLabelColor: AppTheme.textSecondary,
              tabs: [
                Tab(icon: AppIcon(AppIconType.wallet, size: 16, color: AppTheme.accentBlue), text: "Saldo & Ativos"),
                Tab(icon: AppIcon(AppIconType.realTrading, size: 16, color: AppTheme.accentBlue), text: "Posições Swing Trade"),
                Tab(icon: AppIcon(AppIconType.refresh, size: 16, color: AppTheme.textSecondary), text: "Ordens & Histórico"),
              ],
            ),

            // CONTEÚDO DAS ABAS
            Expanded(
              child: TabBarView(
                children: [
                  // ABA 1: LISTA DE ATIVOS DA CARTEIRA (PADRÃO BINANCE ATIVOS)
                  ListView(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    children: [
                      const Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text("Saldo de Ativos", style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                          Icon(Icons.sort, size: 18, color: AppTheme.textSecondary),
                        ],
                      ),
                      const SizedBox(height: 10),

                      if (walletAsync.isLoading)
                        const Padding(
                          padding: EdgeInsets.all(20.0),
                          child: Center(child: CircularProgressIndicator(color: AppTheme.accentBlue)),
                        )
                      else if (!isAuthenticated)
                        Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: AppTheme.accentGold.withOpacity(0.08),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppTheme.accentGold.withOpacity(0.3)),
                          ),
                          child: const Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  AppIcon(AppIconType.warning, color: AppTheme.accentGold, size: 18),
                                  SizedBox(width: 8),
                                  Text("Chaves de API da Binance Não Configuradas", style: TextStyle(color: AppTheme.accentGold, fontWeight: FontWeight.bold, fontSize: 13)),
                                ],
                              ),
                              SizedBox(height: 6),
                              Text(
                                "Para visualizar seus saldos reais da Binance, cadastre sua API Key e API Secret no menu Configurações (Aba 2: Autenticação Exchange).",
                                style: TextStyle(color: AppTheme.textSecondary, fontSize: 12, height: 1.4),
                              ),
                            ],
                          ),
                        )
                      else if (assetsList.isEmpty)
                        const Padding(
                          padding: EdgeInsets.all(20.0),
                          child: Center(
                            child: Text(
                              "Nenhum ativo com saldo positivo encontrado na sua carteira Binance.",
                              style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                            ),
                          ),
                        )
                      else
                        ...assetsList.map((a) {
                          final item = a as Map<String, dynamic>;
                          final sym = item["symbol"]?.toString() ?? "";
                          final amt = item["amount"]?.toString() ?? "0";
                          final val = item["value_usdt"]?.toString() ?? "0 USDT";
                          return _buildBinanceAssetRow(
                            symbol: sym,
                            name: sym == "USDT" ? "TetherUS" : sym,
                            amount: amt,
                            valueUsdt: val,
                            pnlUsd: null,
                            pnlPct: null,
                          );
                        }).toList(),
                    ],
                  ),

                  // ABA 2: POSIÇÕES DE SWING TRADE DETALHADAS E LIMPAS
                  ListView(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    children: [
                      const Text("Posições Ativas em Operação", style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 10),

                      _buildCleanPositionCard(
                        context,
                        symbol: "SOL/USDT",
                        exchange: selectedExchange,
                        entryPrice: 118.94,
                        currentPrice: 122.45,
                        stopLoss: 114.50,
                        targetT2: 125.80,
                        amountUsd: 500.0,
                        pnlUsd: 14.77,
                        pnlPct: 2.95,
                      ),
                      _buildCleanPositionCard(
                        context,
                        symbol: "ETH/USDT",
                        exchange: selectedExchange,
                        entryPrice: 3010.00,
                        currentPrice: 3085.00,
                        stopLoss: 2900.00,
                        targetT2: 3250.00,
                        amountUsd: 350.0,
                        pnlUsd: 8.72,
                        pnlPct: 2.49,
                      ),
                    ],
                  ),

                  // ABA 3: ORDENS PENDENTES E HISTÓRICO DE VENDAS
                  ListView(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    children: [
                      const Text("Ordens OCO / Limit Ativas na Corretora", style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      _buildPendingOrderCard("SOL/USDT", "TAKE PROFIT (T2)", "\$ 125,80", "PENDENTE NA BINANCE"),
                      _buildPendingOrderCard("SOL/USDT", "STOP LOSS", "\$ 114,50", "PROTEÇÃO ATIVA NA BINANCE"),
                      const SizedBox(height: 16),
                      const Text("Histórico Recente de Swing Trades", style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      _buildHistoryItem("AVAX/USDT", "VENDA COM GAIN", "+\$ 45,20", "+6.4%", "Alvo T2 Atingido"),
                      _buildHistoryItem("NEAR/USDT", "VENDA COM GAIN", "+\$ 38,90", "+5.1%", "Alvo T2 Atingido"),
                      _buildHistoryItem("BTC/USDT", "STOP LOSS", "-\$ 18,00", "-1.8%", "Stop Loss Disparado"),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _quickActionButton(AppIconType iconType, String label) {
    return Column(
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: const Color(0xFF2B313A),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Center(
            child: AppIcon(iconType, color: Colors.white, size: 20),
          ),
        ),
        const SizedBox(height: 6),
        Text(
          label,
          style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary, fontWeight: FontWeight.w500),
        ),
      ],
    );
  }

  Widget _buildBinanceAssetRow({
    required String symbol,
    required String name,
    required String amount,
    required String valueUsdt,
    String? pnlUsd,
    String? pnlPct,
    bool isGain = true,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF181A20),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF2B313A)),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  CryptoLogoAvatar(symbol: symbol, size: 36),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(symbol, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: Colors.white)),
                      Text(name, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
                    ],
                  ),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(amount, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white)),
                  Text(valueUsdt, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
                ],
              ),
            ],
          ),
          if (pnlUsd != null && pnlPct != null) ...[
            const SizedBox(height: 8),
            const Divider(color: Color(0xFF2B313A), height: 1),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  "PNL acumulado (360 dias)",
                  style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: (isGain ? AppTheme.accentGreen : AppTheme.accentRed).withOpacity(0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    "$pnlUsd ($pnlPct)",
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      color: isGain ? AppTheme.accentGreenLight : AppTheme.accentRed,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildCleanPositionCard(
    BuildContext context, {
    required String symbol,
    required String exchange,
    required double entryPrice,
    required double currentPrice,
    required double stopLoss,
    required double targetT2,
    required double amountUsd,
    required double pnlUsd,
    required double pnlPct,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF181A20),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF2B313A)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  CryptoLogoAvatar(symbol: symbol, size: 36),
                  const SizedBox(width: 10),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(symbol, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white)),
                      Text("Posição: \$ ${amountUsd.toStringAsFixed(0)} USD", style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
                    ],
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: AppTheme.accentGreen.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.accentGreen.withOpacity(0.6)),
                ),
                child: Text(
                  "+\$ ${pnlUsd.toStringAsFixed(2)} (+${pnlPct.toStringAsFixed(2)}%)",
                  style: const TextStyle(color: AppTheme.accentGreenLight, fontWeight: FontWeight.bold, fontSize: 12),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Divider(color: Color(0xFF2B313A), height: 1),
          const SizedBox(height: 12),

          // VALORES DE ENTRADA E PREÇO ATUAL
          Row(
            children: [
              Expanded(
                child: _gridLevelTile("Preço de Entrada", "\$ ${formatCryptoPrice(entryPrice)}", AppTheme.textPrimary),
              ),
              Expanded(
                child: _gridLevelTile("Preço Atual em Tempo Real", "\$ ${formatCryptoPrice(currentPrice)}", AppTheme.accentBlue),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // BLOCOS SEPARADOS: STOP LOSS (RISCO) VS STOP GAIN (META)
          Row(
            children: [
              // CARD SEPARADO 1: STOP LOSS (VERMELHO)
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppTheme.accentRed.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppTheme.accentRed.withOpacity(0.5)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.shield, size: 13, color: AppTheme.accentRed),
                          SizedBox(width: 4),
                          Text("STOP LOSS (Risco)", style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.accentRed)),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        "\$ ${formatCryptoPrice(stopLoss)}",
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppTheme.accentRed),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 10),

              // CARD SEPARADO 2: STOP GAIN / ALVO T2 (VERDE)
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppTheme.accentGreen.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppTheme.accentGreen.withOpacity(0.5)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.stars, size: 13, color: AppTheme.accentGreenLight),
                          SizedBox(width: 4),
                          Text("STOP GAIN (Alvo T2)", style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.accentGreenLight)),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        "\$ ${formatCryptoPrice(targetT2)}",
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppTheme.accentGreenLight),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            height: 38,
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.accentRed,
                side: const BorderSide(color: AppTheme.accentRed),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              icon: const Icon(Icons.close, size: 16, color: AppTheme.accentRed),
              label: const Text(
                "Encerrar e Vender na Exchange",
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.accentRed),
              ),
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text("🚀 Ordem de venda a mercado enviada para a $exchange para $symbol!"),
                    backgroundColor: AppTheme.accentGreen,
                  ),
                );
              },
            ),
          )
        ],
      ),
    );
  }

  Widget _gridLevelTile(String label, String value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
        const SizedBox(height: 2),
        Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: color)),
      ],
    );
  }

  Widget _buildPendingOrderCard(String symbol, String type, String price, String status) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF181A20),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFF2B313A)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              CryptoLogoAvatar(symbol: symbol, size: 32),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text("$symbol • $type", style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white)),
                  Text("Gatilho: $price", style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                ],
              ),
            ],
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppTheme.accentBlue.withOpacity(0.15),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: AppTheme.accentBlue.withOpacity(0.4)),
            ),
            child: Text(status, style: const TextStyle(fontSize: 10, color: AppTheme.accentBlue, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Widget _buildHistoryItem(String symbol, String result, String pnlUsd, String pnlPct, String reason) {
    final isGain = pnlUsd.contains("+");
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF181A20),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFF2B313A)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              CryptoLogoAvatar(symbol: symbol, size: 32),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(symbol, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white)),
                  Text(reason, style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                ],
              ),
            ],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(pnlUsd, style: TextStyle(fontWeight: FontWeight.bold, color: isGain ? AppTheme.accentGreenLight : AppTheme.accentRed, fontSize: 13)),
              Text(pnlPct, style: TextStyle(color: isGain ? AppTheme.accentGreenLight : AppTheme.accentRed, fontSize: 11)),
            ],
          ),
        ],
      ),
    );
  }
}
