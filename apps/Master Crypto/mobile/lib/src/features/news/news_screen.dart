import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:crypto_swing_app/src/core/theme.dart';
import 'package:crypto_swing_app/src/features/news/news_provider.dart';

class NewsScreen extends ConsumerWidget {
  const NewsScreen({super.key});

  static final List<Map<String, dynamic>> _fallbackNews = [
    {
      "id": "binance-1",
      "title": "Binance Flash News: Solana (SOL) breaks key resistance with \$1.2B daily volume",
      "title_pt": "Binance Notícias: Solana (SOL) rompe resistência chave com \$1.2B em volume diário",
      "source": "Binance News Feed",
      "category": "BINANCE / SPOT",
      "sentiment": "BULLISH",
      "summary": "Solana leads altcoin market recovery after EMA 21 bounce, attracting institutional inflows on Binance Spot.",
      "summary_pt": "Solana lidera a recuperação do mercado de altcoins após repique na EMA 21, atraindo fluxo de capital institucional na Binance Spot.",
      "published_at": "Há 10 minutos",
      "url": "https://binance.com"
    },
    {
      "id": "binance-2",
      "title": "Bitcoin holds strong above \$62,000 as Fed signals interest rate policy shift",
      "title_pt": "Bitcoin se mantém forte acima de \$62.000 enquanto o Fed sinaliza mudança na política de juros",
      "source": "Binance Macro / Bloomberg",
      "category": "MACRO / FED",
      "sentiment": "BULLISH",
      "summary": "Macro environment remains favorable for crypto swing trading as inflation metrics moderate.",
      "summary_pt": "O ambiente macroeconômico permanece favorável para Swing Trade em cripto à medida que a inflação desacelera.",
      "published_at": "Há 35 minutos",
      "url": "https://binance.com"
    },
    {
      "id": "binance-3",
      "title": "Binance Research: Top 5 Layer-1 Tokens presenting Pullback opportunities",
      "title_pt": "Binance Research: As 5 principais altcoins de 1ª camada com oportunidade de Pullback",
      "source": "Binance Research",
      "category": "ALTCOINS",
      "sentiment": "BULLISH",
      "summary": "Analytical report shows NEAR, ETH, and SOL maintaining healthy moving average structures.",
      "summary_pt": "Relatório analítico mostra NEAR, ETH e SOL mantendo estrutura saudável acima das médias móveis principais.",
      "published_at": "Há 1 hora",
      "url": "https://research.binance.com"
    },
    {
      "id": "binance-4",
      "title": "Crypto Fear & Greed Index rises to 68 (Moderate Greed)",
      "title_pt": "Índice de Medo e Ganância Cripto sobe para 68 (Ganância Moderada)",
      "source": "Alternative.me / Binance Analytics",
      "category": "SENTIMENTO",
      "sentiment": "BULLISH",
      "summary": "Trader optimism supports continuation of upward swings across major pairs.",
      "summary_pt": "O otimismo dos traders apoia a continuidade das pernadas de alta nos principais pares.",
      "published_at": "Há 2 horas",
      "url": "https://binance.com"
    }
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final newsAsync = ref.watch(newsFeedProvider);
    final isPt = ref.watch(isTranslateToPtProvider);

    return Column(
      children: [
        // Translation Switch Header
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                "Notícias Binance & Sentimento Macro",
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.textSecondary),
              ),
              Row(
                children: [
                  Text(
                    isPt ? "🇧🇷 PT" : "🇺🇸 EN",
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                  ),
                  Switch(
                    value: isPt,
                    activeColor: AppTheme.accentGreenLight,
                    onChanged: (val) {
                      ref.read(isTranslateToPtProvider.notifier).state = val;
                    },
                  ),
                ],
              ),
            ],
          ),
        ),

        Expanded(
          child: newsAsync.when(
            data: (data) {
              final summary = data['sentiment_summary'] as Map<String, dynamic>? ?? {};
              final rawArticles = data['articles'] as List<dynamic>? ?? _fallbackNews;
              final articles = (rawArticles.isEmpty ? _fallbackNews : rawArticles).take(10).toList();

              return RefreshIndicator(
                onRefresh: () async {
                  ref.invalidate(newsFeedProvider);
                },
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _buildSentimentHeaderCard(summary),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          "Feed Binance & Notícias (${articles.length}/10)",
                          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
                        ),
                        Text(
                          isPt ? "Tradução Automática" : "Original EN",
                          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    ...articles.map((item) {
                      final mapItem = Map<String, dynamic>.from(item as Map);
                      return _buildNewsCard(context, mapItem, isPt);
                    }),
                  ],
                ),
              );
            },
            loading: () => const Center(
              child: CircularProgressIndicator(color: AppTheme.accentBlue),
            ),
            error: (err, stack) => _buildFallbackFeed(context, ref, isPt),
          ),
        ),
      ],
    );
  }

  Widget _buildSentimentHeaderCard(Map<String, dynamic> summary) {
    final fearGreed = summary['fear_and_greed_index'] ?? 68;
    final statusPt = summary['status_pt'] ?? "GANÂNCIA MODERADA (Otimista)";
    final macroBias = summary['macro_bias'] ?? "BULLISH";
    final bullishRatio = summary['bullish_ratio'] ?? "75%";
    final bearishRatio = summary['bearish_ratio'] ?? "25%";

    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: AppTheme.accentBlue, width: 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Row(
                  children: [
                    Icon(Icons.speed, color: AppTheme.accentGold, size: 20),
                    SizedBox(width: 8),
                    Text(
                      "Índice Sentimento Binance",
                      style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: macroBias == "BULLISH"
                        ? AppTheme.accentGreen.withOpacity(0.2)
                        : AppTheme.accentRed.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    macroBias,
                    style: TextStyle(
                      color: macroBias == "BULLISH" ? AppTheme.accentGreenLight : AppTheme.accentRed,
                      fontWeight: FontWeight.bold,
                      fontSize: 11,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                Column(
                  children: [
                    Text(
                      "$fearGreed / 100",
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: AppTheme.accentGold),
                    ),
                    Text(
                      statusPt,
                      style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                    ),
                  ],
                ),
                Container(height: 35, width: 1, color: AppTheme.darkBorder),
                Column(
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.arrow_upward, color: AppTheme.accentGreenLight, size: 14),
                        Text(" $bullishRatio Bullish", style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.accentGreenLight)),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        const Icon(Icons.arrow_downward, color: AppTheme.accentRed, size: 14),
                        Text(" $bearishRatio Bearish", style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.accentRed)),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNewsCard(BuildContext context, Map<String, dynamic> item, bool isPt) {
    final title = isPt ? (item['title_pt'] ?? item['title']) : item['title'];
    final summary = isPt ? (item['summary_pt'] ?? item['summary']) : item['summary'];
    final source = item['source'] ?? 'Binance News';
    final category = item['category'] ?? 'CRYPTO';
    final sentiment = item['sentiment'] ?? 'NEUTRAL';
    final timeStr = item['published_at'] ?? 'Recente';

    final isBullish = sentiment == 'BULLISH';
    final isBearish = sentiment == 'BEARISH';
    final sentimentColor = isBullish
        ? AppTheme.accentGreenLight
        : (isBearish ? AppTheme.accentRed : AppTheme.accentBlue);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: AppTheme.darkBackground,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: AppTheme.darkBorder),
                  ),
                  child: Text(
                    "$category • $source",
                    style: const TextStyle(color: AppTheme.textSecondary, fontSize: 10, fontWeight: FontWeight.bold),
                  ),
                ),
                Row(
                  children: [
                    Icon(
                      isBullish ? Icons.trending_up : (isBearish ? Icons.trending_down : Icons.remove),
                      color: sentimentColor,
                      size: 14,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      sentiment,
                      style: TextStyle(color: sentimentColor, fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              title.toString(),
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, height: 1.25),
            ),
            const SizedBox(height: 6),
            Text(
              summary.toString(),
              style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary, height: 1.35),
            ),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  timeStr.toString(),
                  style: const TextStyle(color: AppTheme.textSecondary, fontSize: 10),
                ),
                TextButton(
                  style: TextButton.styleFrom(
                    padding: EdgeInsets.zero,
                    minimumSize: const Size(50, 20),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  onPressed: () {},
                  child: const Row(
                    children: [
                      Text("Ler fonte ", style: TextStyle(fontSize: 11, color: AppTheme.accentBlue)),
                      Icon(Icons.open_in_new, size: 12, color: AppTheme.accentBlue),
                    ],
                  ),
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildFallbackFeed(BuildContext context, WidgetRef ref, bool isPt) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildSentimentHeaderCard(const {
          "fear_and_greed_index": 68,
          "status_pt": "GANÂNCIA MODERADA (Otimista)",
          "macro_bias": "BULLISH",
          "bullish_ratio": "75%",
          "bearish_ratio": "25%"
        }),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: const [
            Text(
              "Feed Binance (Modo Offline / Reserva)",
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
            ),
          ],
        ),
        const SizedBox(height: 12),
        ..._fallbackNews.map((item) => _buildNewsCard(context, item, isPt)),
      ],
    );
  }
}
