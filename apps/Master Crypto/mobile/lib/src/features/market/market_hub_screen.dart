import 'package:flutter/material.dart';
import 'package:crypto_swing_app/src/core/theme.dart';
import 'package:crypto_swing_app/src/features/btc_cycle/btc_cycle_screen.dart';
import 'package:crypto_swing_app/src/features/backtest/backtest_screen.dart';
import 'package:crypto_swing_app/src/features/news/news_screen.dart';

class MarketHubScreen extends StatefulWidget {
  const MarketHubScreen({super.key});

  @override
  State<MarketHubScreen> createState() => _MarketHubScreenState();
}

class _MarketHubScreenState extends State<MarketHubScreen> {
  int _selectedTabIndex = 0; // 0 = Ciclo BTC, 1 = Backtest, 2 = Notícias

  final List<Widget> _subScreens = const [
    BTCCycleScreen(),
    BacktestScreen(),
    NewsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Seletor de Abas estilo Pill Chips (Inspirado no IAMeet)
        Container(
          margin: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
            color: AppTheme.darkCardSurface,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppTheme.darkBorder),
          ),
          child: Row(
            children: [
              _buildPillTab(0, "Ciclo BTC", Icons.currency_bitcoin),
              _buildPillTab(1, "Backtest", Icons.science),
              _buildPillTab(2, "Notícias", Icons.article),
            ],
          ),
        ),

        // Conteúdo da Sub-tela
        Expanded(
          child: IndexedStack(
            index: _selectedTabIndex,
            children: _subScreens,
          ),
        ),
      ],
    );
  }

  Widget _buildPillTab(int index, String label, IconData icon) {
    final isSelected = _selectedTabIndex == index;
    return Expanded(
      child: GestureDetector(
        onTap: () {
          setState(() {
            _selectedTabIndex = index;
          });
        },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: isSelected ? AppTheme.accentBlue : Colors.transparent,
            borderRadius: BorderRadius.circular(16),
            boxShadow: isSelected
                ? [
                    BoxShadow(
                      color: AppTheme.accentBlue.withOpacity(0.3),
                      blurRadius: 6,
                      offset: const Offset(0, 2),
                    ),
                  ]
                : [],
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                size: 16,
                color: isSelected ? Colors.white : AppTheme.textSecondary,
              ),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                  color: isSelected ? Colors.white : AppTheme.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
