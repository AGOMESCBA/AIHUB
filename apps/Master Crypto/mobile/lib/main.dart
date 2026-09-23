import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:crypto_swing_app/src/core/theme.dart';
import 'package:crypto_swing_app/src/core/api_client.dart';
import 'package:crypto_swing_app/src/ui/app_icons.dart';
import 'package:crypto_swing_app/src/features/radar/radar_screen.dart';
import 'package:crypto_swing_app/src/features/paper_trading/paper_trading_screen.dart';
import 'package:crypto_swing_app/src/features/real_trading/real_trading_screen.dart';
import 'package:crypto_swing_app/src/features/market/market_hub_screen.dart';
import 'package:crypto_swing_app/src/features/settings/settings_screen.dart';
import 'package:crypto_swing_app/src/features/settings/settings_provider.dart';

void main() {
  runApp(
    const ProviderScope(
      child: CryptoSwingApp(),
    ),
  );
}

class CryptoSwingApp extends ConsumerStatefulWidget {
  const CryptoSwingApp({super.key});

  @override
  ConsumerState<CryptoSwingApp> createState() => _CryptoSwingAppState();
}

class _CryptoSwingAppState extends ConsumerState<CryptoSwingApp> {
  @override
  void initState() {
    super.initState();
    // Restaura as configurações salvas (IP, Exchange, API Keys) no arranque do app
    Future.microtask(() {
      SettingsStorageService.loadSavedSettings(ref);
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Cripto Master',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.darkTheme,
      home: const MainNavigationShell(),
    );
  }
}

class MainNavigationShell extends ConsumerStatefulWidget {
  const MainNavigationShell({super.key});

  @override
  ConsumerState<MainNavigationShell> createState() => _MainNavigationShellState();
}

class _MainNavigationShellState extends ConsumerState<MainNavigationShell> {
  int _currentIndex = 0;

  final List<Widget> _screens = const [
    RadarScreen(),
    PaperTradingScreen(),
    RealTradingScreen(),
    MarketHubScreen(),
  ];

  final List<String> _titles = const [
    "Oportunidades",
    "Treino Simulado",
    "Operações Reais",
    "Mercado & Ciclos",
  ];

  @override
  Widget build(BuildContext context) {
    final companyToken = ref.watch(companyTokenProvider);
    final companyName = ref.watch(companyNameProvider);

    final displayBadge = companyName.isNotEmpty
        ? companyName
        : (companyToken.length > 15 ? "Empresa #${ApiClient.numericCompanyId}" : "EMP: $companyToken");

    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 66,
        titleSpacing: 12,
        title: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                gradient: AppTheme.accentGradient,
                shape: BoxShape.circle,
                border: Border.all(color: AppTheme.accentBlue.withOpacity(0.5), width: 1.5),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.accentBlue.withOpacity(0.2),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Center(
                child: AppIcon(AppIconType.btc, size: 20, color: Colors.white),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Row(
                    children: [
                      const Text(
                        "Crypto Radar",
                        style: TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          letterSpacing: -0.3,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        "• ${_titles[_currentIndex]}",
                        style: const TextStyle(
                          color: AppTheme.accentGreenLight,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  InkWell(
                    onTap: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(builder: (context) => const SettingsScreen()),
                      );
                    },
                    borderRadius: BorderRadius.circular(4),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text("🏢 ", style: TextStyle(fontSize: 12)),
                        Flexible(
                          child: Text(
                            displayBadge,
                            overflow: TextOverflow.ellipsis,
                            maxLines: 1,
                            style: const TextStyle(
                              color: AppTheme.accentGold,
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 12),
            decoration: BoxDecoration(
              color: AppTheme.darkBackground,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppTheme.darkBorder),
            ),
            child: IconButton(
              icon: AppIcon(AppIconType.settings, size: 20, color: AppTheme.accentBlue),
              tooltip: "Configurações",
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (context) => const SettingsScreen()),
                );
              },
            ),
          ),
        ],
      ),

      body: IndexedStack(
        index: _currentIndex,
        children: _screens,
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: AppTheme.darkBorder, width: 1)),
        ),
        child: BottomNavigationBar(
          currentIndex: _currentIndex,
          selectedItemColor: AppTheme.accentGreenLight,
          unselectedItemColor: AppTheme.textSecondary,
          backgroundColor: AppTheme.darkCardSurface,
          type: BottomNavigationBarType.fixed,
          selectedFontSize: 11,
          unselectedFontSize: 10,
          onTap: (index) {
            setState(() {
              _currentIndex = index;
            });
          },
          items: [
            BottomNavigationBarItem(
              icon: AppIcon(AppIconType.home, size: 20, color: _currentIndex == 0 ? AppTheme.accentGreenLight : AppTheme.textSecondary),
              label: 'Home',
            ),
            BottomNavigationBarItem(
              icon: AppIcon(AppIconType.simulation, size: 20, color: _currentIndex == 1 ? AppTheme.accentGreenLight : AppTheme.textSecondary),
              label: 'Treino',
            ),
            BottomNavigationBarItem(
              icon: AppIcon(AppIconType.realTrading, size: 20, color: _currentIndex == 2 ? AppTheme.accentGreenLight : AppTheme.textSecondary),
              label: 'Conta Real',
            ),
            BottomNavigationBarItem(
              icon: AppIcon(AppIconType.market, size: 20, color: _currentIndex == 3 ? AppTheme.accentGreenLight : AppTheme.textSecondary),
              label: 'Mercado',
            ),
          ],
        ),
      ),
    );
  }
}
