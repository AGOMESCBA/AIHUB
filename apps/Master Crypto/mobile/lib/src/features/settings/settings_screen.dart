import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:crypto_swing_app/src/core/theme.dart';
import 'package:crypto_swing_app/src/core/api_client.dart';
import 'package:crypto_swing_app/src/core/notification_service.dart';
import 'package:crypto_swing_app/src/features/settings/settings_provider.dart';
import 'package:crypto_swing_app/src/features/radar/radar_provider.dart';
import 'package:crypto_swing_app/src/ui/app_icons.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  late TextEditingController _balanceController;
  late TextEditingController _serverIpController;
  late TextEditingController _companyTokenController;
  late TextEditingController _apiKeyController;
  late TextEditingController _apiSecretController;
  bool _isTestingConnection = false;
  String? _connectionStatusMessage;
  bool? _connectionSuccess;

  bool _obscureApiKey = true;
  bool _obscureApiSecret = true;
  bool _isTestingExchange = false;
  String? _exchangeTestMessage;
  bool? _exchangeTestSuccess;

  bool _isValidatingToken = false;
  String? _validationStatusMessage;
  bool? _validationSuccess;

  void _validateCompanyToken() async {
    final token = _companyTokenController.text.trim();
    if (token.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Por favor insira um Token de Empresa válido!"), backgroundColor: AppTheme.accentRed),
      );
      return;
    }

    setState(() {
      _isValidatingToken = true;
      _validationStatusMessage = null;
    });

    ref.read(companyTokenProvider.notifier).state = token;
    ApiClient.setCompanyToken(token);
    await SettingsStorageService.saveCompanyToken(token);

    final res = await ApiClient.validateCompanyToken(token);

    if (mounted) {
      final isValid = res["valid"] == true;
      final compName = res["company_name"] as String? ?? (isValid ? "Empresa #${ApiClient.numericCompanyId}" : "");
      
      if (isValid && compName.isNotEmpty) {
        await SettingsStorageService.saveCompanyName(ref, compName);
      }

      setState(() {
        _isValidatingToken = false;
        _validationSuccess = isValid;
        _validationStatusMessage = isValid
            ? "⚡ Token validado! Empresa reconhecida: $compName"
            : (res["reason"] as String? ?? "Token não validado pelo servidor.");
      });
    }
  }

  @override
  void initState() {
    super.initState();
    final currentBalance = ref.read(accountBalanceProvider);
    final currentIp = ref.read(serverIpProvider);
    final currentToken = ref.read(companyTokenProvider);
    final currentKey = ref.read(exchangeApiKeyProvider);
    final currentSecret = ref.read(exchangeApiSecretProvider);
    _balanceController = TextEditingController(text: currentBalance.toInt().toString());
    _serverIpController = TextEditingController(text: currentIp);
    _companyTokenController = TextEditingController(text: currentToken);
    _apiKeyController = TextEditingController(text: currentKey);
    _apiSecretController = TextEditingController(text: currentSecret);
  }

  @override
  void dispose() {
    _balanceController.dispose();
    _serverIpController.dispose();
    _companyTokenController.dispose();
    _apiKeyController.dispose();
    _apiSecretController.dispose();
    super.dispose();
  }

  void _testExchangeConnection() async {
    setState(() {
      _isTestingExchange = true;
      _exchangeTestMessage = null;
    });

    final ex = ref.read(selectedExchangeProvider);

    final res = await ApiClient.testExchangeConnection(
      exchange: ex,
    );

    if (mounted) {
      setState(() {
        _isTestingExchange = false;
        _exchangeTestSuccess = res["success"] == true;
        _exchangeTestMessage = res["message"] ?? "Resultado do teste desconhecido.";
      });
    }
  }



  void _testConnection() async {
    final ip = _serverIpController.text.trim();
    if (ip.isNotEmpty) {
      ref.read(serverIpProvider.notifier).state = ip;
      ApiClient.setServerIp(ip);
      await SettingsStorageService.saveServerIp(ip);
    }

    setState(() {
      _isTestingConnection = true;
      _connectionStatusMessage = null;
    });

    final isOk = await ApiClient.testConnection(ip);

    if (mounted) {
      setState(() {
        _isTestingConnection = false;
        _connectionSuccess = isOk;
        _connectionStatusMessage = isOk
            ? "Conexão estabelecida com sucesso! IP Salvo."
            : "Falha ao conectar. Verifique se o servidor está rodando no IP $ip";
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final riskPct = ref.watch(riskPerTradePctProvider);
    final topLimit = ref.watch(topLimitProvider);
    final timeframe = ref.watch(preferredTimeframeProvider);
    final enableScoreAlerts = ref.watch(enableScoreAlertsProvider);
    final enableInvalidation = ref.watch(enableInvalidationAlertsProvider);

    return DefaultTabController(
      length: 7,
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(
            icon: const AppIcon(AppIconType.arrowBack, size: 20, color: Colors.white),
            onPressed: () => Navigator.pop(context),
          ),
          title: const Text("Central de Configurações"),
          bottom: TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            indicatorColor: AppTheme.accentBlue,
            labelColor: AppTheme.accentBlue,
            unselectedLabelColor: AppTheme.textSecondary,
            tabs: const [
              Tab(icon: AppIcon(AppIconType.info, size: 16, color: AppTheme.accentGold), text: "1. Empresa & Licença"),
              Tab(icon: AppIcon(AppIconType.settings, size: 16, color: AppTheme.accentGreenLight), text: "2. Corretora & Binance API"),
              Tab(icon: AppIcon(AppIconType.wallet, size: 16, color: AppTheme.accentBlue), text: "3. Banca & Risco"),
              Tab(icon: AppIcon(AppIconType.realTrading, size: 16, color: AppTheme.accentBlue), text: "4. Servidor & Rede"),
              Tab(icon: AppIcon(AppIconType.filter, size: 16, color: AppTheme.accentGold), text: "5. Scanner & Algoritmo"),
              Tab(icon: AppIcon(AppIconType.warning, size: 16, color: AppTheme.accentRed), text: "6. Alertas & Notificações"),
              Tab(icon: AppIcon(AppIconType.info, size: 16, color: AppTheme.textSecondary), text: "7. Guia de Uso"),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            // ABA 1: EMPRESA & LICENÇA
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text("Licenciamento & Identificação da Empresa", style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.accentGold)),
                const SizedBox(height: 8),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text("Token / ID de Licença da Empresa", style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                        const SizedBox(height: 6),
                        TextField(
                          controller: _companyTokenController,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            border: OutlineInputBorder(),
                            prefixIcon: Padding(
                              padding: EdgeInsets.all(10),
                              child: AppIcon(AppIconType.info, color: AppTheme.accentGold, size: 18),
                            ),
                            hintText: "Ex: 1001",
                            isDense: true,
                          ),
                          onChanged: (val) {
                            if (val.trim().isNotEmpty) {
                              ref.read(companyTokenProvider.notifier).state = val.trim();
                              ApiClient.setCompanyToken(val.trim());
                            }
                          },
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          "⚠️ Sem o Token de Empresa configurado, o aplicativo é bloqueado pelo backend por motivos de segurança multi-empresa.",
                          style: TextStyle(fontSize: 11, color: AppTheme.textSecondary, height: 1.3),
                        ),
                        const SizedBox(height: 14),
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppTheme.accentGold,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                            ),
                            icon: _isValidatingToken
                                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                                : const AppIcon(AppIconType.bolt, color: Colors.black, size: 18),
                            label: const Text("⚡ Validar Token & Buscar Nome da Empresa", style: TextStyle(fontWeight: FontWeight.bold, color: Colors.black)),
                            onPressed: _isValidatingToken ? null : _validateCompanyToken,
                          ),
                        ),
                        if (_validationStatusMessage != null) ...[
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: (_validationSuccess == true ? AppTheme.accentGreen : AppTheme.accentRed).withOpacity(0.15),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: (_validationSuccess == true ? AppTheme.accentGreen : AppTheme.accentRed).withOpacity(0.4)),
                            ),
                            child: Row(
                              children: [
                                AppIcon(
                                  _validationSuccess == true ? AppIconType.check : AppIconType.warning,
                                  color: _validationSuccess == true ? AppTheme.accentGreenLight : AppTheme.accentRed,
                                  size: 18,
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    _validationStatusMessage!,
                                    style: TextStyle(
                                      color: _validationSuccess == true ? AppTheme.accentGreenLight : AppTheme.accentRed,
                                      fontSize: 12,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ]
                      ],
                    ),
                  ),
                ),
              ],
            ),

            // ABA 2: CORRETORA & BINANCE API
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text("Conexão de Exchange & API Keys por Empresa", style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.accentGreenLight)),
                const SizedBox(height: 8),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text("Corretora Selecionada", style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                            DropdownButton<String>(
                              value: ref.watch(selectedExchangeProvider),
                              items: const [
                                DropdownMenuItem(value: "BINANCE", child: Text("Binance")),
                                DropdownMenuItem(value: "BYBIT", child: Text("Bybit")),
                                DropdownMenuItem(value: "OKX", child: Text("OKX")),
                                DropdownMenuItem(value: "KUCOIN", child: Text("KuCoin")),
                                DropdownMenuItem(value: "COINBASE", child: Text("Coinbase")),
                                DropdownMenuItem(value: "MERCADO_BITCOIN", child: Text("Mercado Bitcoin")),
                              ],
                              onChanged: (val) {
                                if (val != null) {
                                  ref.read(selectedExchangeProvider.notifier).state = val;
                                }
                              },
                            ),
                          ],
                        ),
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppTheme.accentGreen.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: AppTheme.accentGreen.withOpacity(0.3)),
                          ),
                          child: const Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  AppIcon(AppIconType.check, color: AppTheme.accentGreenLight, size: 20),
                                  SizedBox(width: 8),
                                  Text(
                                    "Gerenciamento Centralizado na Retaguarda",
                                    style: TextStyle(color: AppTheme.accentGreenLight, fontWeight: FontWeight.bold, fontSize: 13),
                                  ),
                                ],
                              ),
                              SizedBox(height: 8),
                              Text(
                                "As chaves de API da Binance (API Key e Secret) são cadastradas e salvas com segurança no Painel Web da sua empresa.\n\nO aplicativo se conecta via Token da Empresa e utiliza a autenticação segura do Servidor.",
                                style: TextStyle(color: AppTheme.textSecondary, fontSize: 12, height: 1.4),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppTheme.accentGold,
                              foregroundColor: Colors.black,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                            ),
                            icon: _isTestingExchange
                                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                                : const AppIcon(AppIconType.bolt, color: Colors.black, size: 20),
                            label: const Text("Testar Conexão com a Corretora", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                            onPressed: _isTestingExchange ? null : _testExchangeConnection,
                          ),
                        ),
                        if (_exchangeTestMessage != null) ...[
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: (_exchangeTestSuccess == true) ? AppTheme.accentGreen.withOpacity(0.15) : AppTheme.accentRed.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: (_exchangeTestSuccess == true) ? AppTheme.accentGreen : AppTheme.accentRed),
                            ),
                            child: Row(
                              children: [
                                AppIcon(
                                  (_exchangeTestSuccess == true) ? AppIconType.check : AppIconType.warning,
                                  color: (_exchangeTestSuccess == true) ? AppTheme.accentGreenLight : AppTheme.accentRed,
                                  size: 20,
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    _exchangeTestMessage!,
                                    style: TextStyle(
                                      color: (_exchangeTestSuccess == true) ? AppTheme.accentGreenLight : AppTheme.accentRed,
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          )
                        ],
                        const SizedBox(height: 16),
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppTheme.accentBlue.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: AppTheme.accentBlue.withOpacity(0.3)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Row(
                                children: [
                                  AppIcon(AppIconType.info, color: AppTheme.accentBlue, size: 16),
                                  SizedBox(width: 8),
                                  Text(
                                    "🔒 Segurança de IP Fixo na Binance",
                                    style: TextStyle(color: AppTheme.accentBlue, fontWeight: FontWeight.bold, fontSize: 13),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 6),
                              const Text(
                                "Como a rede móvel do celular possui IP dinâmico, todas as ordens e consultas são processadas com segurança máxima através do nosso Gateway de IP Fixo Estático.\n\nNa Binance, marque 'Restringir acesso apenas a IPs confiáveis' e cadastre o IP do Servidor:",
                                style: TextStyle(color: AppTheme.textSecondary, fontSize: 11, height: 1.4),
                              ),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                    decoration: BoxDecoration(
                                      color: AppTheme.darkBackground,
                                      borderRadius: BorderRadius.circular(6),
                                      border: Border.all(color: AppTheme.darkBorder),
                                    ),
                                    child: const Text(
                                      "137.131.212.29",
                                      style: TextStyle(color: AppTheme.accentGreenLight, fontWeight: FontWeight.bold, fontSize: 12),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  OutlinedButton.icon(
                                    style: OutlinedButton.styleFrom(
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                      side: const BorderSide(color: AppTheme.accentBlue),
                                    ),
                                    icon: const AppIcon(AppIconType.copy, color: AppTheme.accentBlue, size: 14),
                                    label: const Text("Copiar IP", style: TextStyle(fontSize: 11, color: AppTheme.accentBlue)),
                                    onPressed: () {
                                      Clipboard.setData(const ClipboardData(text: "137.131.212.29"));
                                      ScaffoldMessenger.of(context).showSnackBar(
                                        const SnackBar(content: Text("IP do Servidor (137.131.212.29) copiado com sucesso!"), backgroundColor: AppTheme.accentGreen),
                                      );
                                    },
                                  ),
                                ],
                              )
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),


            // ABA 3: BANCA & RISCO
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text("Gestão Financeira & Risco", style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.accentBlue)),
                const SizedBox(height: 8),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text("Sua Banca Total para Cálculo (\$ USD)", style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                        const SizedBox(height: 6),
                        TextField(
                          controller: _balanceController,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            border: OutlineInputBorder(),
                            prefixText: "\$ ",
                            isDense: true,
                          ),
                          onChanged: (val) {
                            final parsed = double.tryParse(val);
                            if (parsed != null && parsed > 0) {
                              ref.read(accountBalanceProvider.notifier).state = parsed;
                            }
                          },
                        ),
                        const SizedBox(height: 16),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text("Risco Máximo por Operação", style: TextStyle(fontSize: 13)),
                            Text("${riskPct.toStringAsFixed(1)}%", style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.accentRed)),
                          ],
                        ),
                        Slider(
                          value: riskPct,
                          min: 0.5,
                          max: 5.0,
                          divisions: 9,
                          activeColor: AppTheme.accentRed,
                          label: "${riskPct.toStringAsFixed(1)}%",
                          onChanged: (val) {
                            ref.read(riskPerTradePctProvider.notifier).state = val;
                          },
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),

            // ABA 4: SERVIDOR & REDE
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text("Endereço do Servidor Backend Python", style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.accentBlue)),
                const SizedBox(height: 8),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text("Endereço IP do Servidor (ex: 192.168.1.100)", style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                        const SizedBox(height: 6),
                        TextField(
                          controller: _serverIpController,
                          keyboardType: TextInputType.url,
                          decoration: const InputDecoration(
                            border: OutlineInputBorder(),
                            prefixIcon: Padding(
                              padding: EdgeInsets.all(10),
                              child: AppIcon(AppIconType.bolt, color: AppTheme.accentBlue, size: 18),
                            ),
                            hintText: "192.168.199.37",
                            isDense: true,
                          ),
                          onChanged: (val) {
                            ref.read(serverIpProvider.notifier).state = val;
                            ApiClient.setServerIp(val);
                          },
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            const AppIcon(AppIconType.info, size: 14, color: AppTheme.accentGold),
                            const SizedBox(width: 4),
                            const Expanded(
                              child: Text(
                                "IP do seu PC no Wi-Fi: 192.168.199.37",
                                style: TextStyle(fontSize: 11, color: AppTheme.accentGold),
                              ),
                            ),
                            InkWell(
                              onTap: () {
                                _serverIpController.text = "192.168.199.37";
                                ref.read(serverIpProvider.notifier).state = "192.168.199.37";
                                ApiClient.setServerIp("192.168.199.37");
                              },
                              child: const Text(
                                "Preencher com 192.168.199.37",
                                style: TextStyle(fontSize: 11, color: AppTheme.accentBlue, fontWeight: FontWeight.bold, decoration: TextDecoration.underline),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 14),
                        SizedBox(
                          width: double.infinity,
                          child: OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              side: const BorderSide(color: AppTheme.accentBlue),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                            ),
                            icon: _isTestingConnection
                                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.accentBlue))
                                : const AppIcon(AppIconType.refresh, color: AppTheme.accentBlue, size: 18),
                            label: const Text("Salvar e Testar Conexão", style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.accentBlue)),
                            onPressed: _isTestingConnection ? null : _testConnection,
                          ),
                        ),
                        if (_connectionStatusMessage != null) ...[
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: (_connectionSuccess == true) ? AppTheme.accentGreen.withOpacity(0.15) : AppTheme.accentRed.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: (_connectionSuccess == true) ? AppTheme.accentGreen : AppTheme.accentRed),
                            ),
                            child: Row(
                              children: [
                                Icon(
                                  (_connectionSuccess == true) ? Icons.check_circle_rounded : Icons.error_rounded,
                                  color: (_connectionSuccess == true) ? AppTheme.accentGreenLight : AppTheme.accentRed,
                                  size: 20,
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    _connectionStatusMessage!,
                                    style: TextStyle(
                                      color: (_connectionSuccess == true) ? AppTheme.accentGreenLight : AppTheme.accentRed,
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          )
                        ]
                      ],
                    ),
                  ),
                ),
              ],
            ),

            // ABA 5: SCANNER & ALGORITMO
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text("Filtros de Mercado e Profundidade", style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.accentGold)),
                const SizedBox(height: 8),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text("Profundidade Padrão do Scanner", style: TextStyle(fontSize: 13)),
                        const SizedBox(height: 8),
                        SegmentedButton<int>(
                          segments: const [
                            ButtonSegment(value: 10, label: Text("Top 10")),
                            ButtonSegment(value: 20, label: Text("Top 20")),
                            ButtonSegment(value: 30, label: Text("Top 30")),
                            ButtonSegment(value: 50, label: Text("Top 50")),
                          ],
                          selected: {topLimit},
                          onSelectionChanged: (Set<int> newSelection) {
                            ref.read(topLimitProvider.notifier).state = newSelection.first;
                          },
                        ),
                        const SizedBox(height: 16),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text("Timeframe Principal", style: TextStyle(fontSize: 13)),
                            DropdownButton<String>(
                              value: timeframe,
                              items: const [
                                DropdownMenuItem(value: "4h", child: Text("4H (Baseline)")),
                                DropdownMenuItem(value: "1d", child: Text("1D (Diário)")),
                              ],
                              onChanged: (val) {
                                if (val != null) {
                                  ref.read(preferredTimeframeProvider.notifier).state = val;
                                }
                              },
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),

            // ABA 6: ALERTAS & NOTIFICAÇÕES
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text("Alertas e Notificações de Mercado", style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.accentRed)),
                const SizedBox(height: 8),
                Card(
                  child: Column(
                    children: [
                      SwitchListTile(
                        title: const Text("Variação de Score (Δ ≥ 10)", style: TextStyle(fontSize: 14)),
                        subtitle: const Text("Notificar quando uma oportunidade ganhar ou perder 10 pontos de score", style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                        value: enableScoreAlerts,
                        activeColor: AppTheme.accentGreenLight,
                        onChanged: (val) {
                          ref.read(enableScoreAlertsProvider.notifier).state = val;
                        },
                      ),
                      const Divider(height: 1, color: AppTheme.darkBorder),
                      SwitchListTile(
                        title: const Text("Invalidação de Setup", style: TextStyle(fontSize: 14)),
                        subtitle: const Text("Alerta imediato ao romper a zona de Stop Loss", style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                        value: enableInvalidation,
                        activeColor: AppTheme.accentRed,
                        onChanged: (val) {
                          ref.read(enableInvalidationAlertsProvider.notifier).state = val;
                        },
                      ),
                      const Divider(height: 1, color: AppTheme.darkBorder),
                      Padding(
                        padding: const EdgeInsets.all(12),
                        child: SizedBox(
                          width: double.infinity,
                          child: OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              side: const BorderSide(color: AppTheme.accentGold),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                            ),
                            icon: const AppIcon(AppIconType.warning, color: AppTheme.accentGold, size: 18),
                            label: const Text("Simular Notificação Flutuante no Celular", style: TextStyle(color: AppTheme.accentGold, fontSize: 12, fontWeight: FontWeight.bold)),
                            onPressed: () {
                              NotificationService.showFloatingNotification(
                                title: "ALERTA: SOL/USDT Imperdível!",
                                body: "Score 93/100 na zona de entrada ideal (145.20 - 146.10). Alvo T2 153.30 (+5.8%).",
                              );
                              NotificationService.showInAppFloatingBanner(
                                context,
                                title: "OPORTUNIDADE IMPERDÍVEL DISPARADA!",
                                message: "SOL/USDT atingiu Score 93/100 na Zona Ideal. Clique para abrir!",
                              );
                            },
                          ),
                        ),
                      )
                    ],
                  ),
                ),
              ],
            ),

            // ABA 7: GUIA & COMO USAR
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  color: AppTheme.accentBlue.withOpacity(0.12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: const BorderSide(color: AppTheme.accentBlue, width: 1),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: const [
                        Row(
                          children: [
                            AppIcon(AppIconType.info, color: AppTheme.accentBlue, size: 20),
                            SizedBox(width: 8),
                            Text("Guia de Ajustes do Sistema", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppTheme.accentBlue)),
                          ],
                        ),
                        SizedBox(height: 10),
                        Text(
                          "Cada aba contém o controle exclusivo de uma operação ou processo do aplicativo:\n\n"
                          "1. Empresa & Licença: Alterne ou configure o Token de Licença da sua Empresa.\n"
                          "2. Corretora & Binance: Cadastre as API Keys públicas e secretas para envio de ordens.\n"
                          "3. Banca & Risco: Defina o seu capital inicial e teto de risco (máx 2%).\n"
                          "4. Servidor & Rede: Teste a comunicação com seu computador ou servidor cloud.\n"
                          "5. Scanner & Algoritmo: Ajuste o limite do Top Market Cap e Timeframe.\n"
                          "6. Alertas: Ative notificações de Score e Invalidação de Setup.",
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
}
