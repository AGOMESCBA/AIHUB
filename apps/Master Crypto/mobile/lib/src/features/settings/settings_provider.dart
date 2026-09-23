import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:crypto_swing_app/src/core/api_client.dart';

final accountBalanceProvider = StateProvider<double>((ref) => 10000.0);
final riskPerTradePctProvider = StateProvider<double>((ref) => 2.0);
final preferredTimeframeProvider = StateProvider<String>((ref) => '4h');
final enableScoreAlertsProvider = StateProvider<bool>((ref) => true);
final enableInvalidationAlertsProvider = StateProvider<bool>((ref) => true);
final serverIpProvider = StateProvider<String>((ref) => '137.131.212.29');
final selectedExchangeProvider = StateProvider<String>((ref) => 'BINANCE');
final exchangeApiKeyProvider = StateProvider<String>((ref) => '');
final exchangeApiSecretProvider = StateProvider<String>((ref) => '');
final companyTokenProvider = StateProvider<String>((ref) => '1001');
final companyNameProvider = StateProvider<String>((ref) => '');

class SettingsStorageService {
  static const _kServerIp = 'master_crypto_server_ip';
  static const _kSelectedExchange = 'master_crypto_selected_exchange';
  static const _kApiKey = 'master_crypto_api_key';
  static const _kApiSecret = 'master_crypto_api_secret';
  static const _kRiskPct = 'master_crypto_risk_pct';
  static const _kBalance = 'master_crypto_balance';
  static const _kCompanyToken = 'master_crypto_company_token';
  static const _kCompanyName = 'master_crypto_company_name';

  static Future<void> loadSavedSettings(WidgetRef ref) async {
    try {
      final prefs = await SharedPreferences.getInstance();

      final ip = prefs.getString(_kServerIp);
      if (ip != null && ip.isNotEmpty) {
        ref.read(serverIpProvider.notifier).state = ip;
        ApiClient.setServerIp(ip);
      } else {
        ApiClient.setServerIp('137.131.212.29');
      }

      final token = prefs.getString(_kCompanyToken);
      if (token != null && token.isNotEmpty) {
        ref.read(companyTokenProvider.notifier).state = token;
        ApiClient.setCompanyToken(token);
      } else {
        ApiClient.setCompanyToken('1001');
      }

      final name = prefs.getString(_kCompanyName);
      if (name != null && name.isNotEmpty) {
        ref.read(companyNameProvider.notifier).state = name;
      }

      final ex = prefs.getString(_kSelectedExchange);
      if (ex != null && ex.isNotEmpty) {
        ref.read(selectedExchangeProvider.notifier).state = ex;
      }

      final key = prefs.getString(_kApiKey);
      if (key != null) {
        ref.read(exchangeApiKeyProvider.notifier).state = key;
      }

      final secret = prefs.getString(_kApiSecret);
      if (secret != null) {
        ref.read(exchangeApiSecretProvider.notifier).state = secret;
      }

      final risk = prefs.getDouble(_kRiskPct);
      if (risk != null) {
        ref.read(riskPerTradePctProvider.notifier).state = risk;
      }

      final bal = prefs.getDouble(_kBalance);
      if (bal != null) {
        ref.read(accountBalanceProvider.notifier).state = bal;
      }
    } catch (_) {}
  }

  static Future<void> saveCompanyToken(String token) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kCompanyToken, token);
      ApiClient.setCompanyToken(token);
    } catch (_) {}
  }

  static Future<void> saveCompanyName(WidgetRef ref, String name) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kCompanyName, name);
      ref.read(companyNameProvider.notifier).state = name;
    } catch (_) {}
  }

  static Future<void> saveServerIp(String ip) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kServerIp, ip);
    } catch (_) {}
  }

  static Future<void> saveExchangeCredentials({
    required String exchange,
    required String apiKey,
    required String apiSecret,
  }) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kSelectedExchange, exchange);
      await prefs.setString(_kApiKey, apiKey);
      await prefs.setString(_kApiSecret, apiSecret);
    } catch (_) {}
  }

  static Future<void> saveRiskSettings(double riskPct, double balance) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setDouble(_kRiskPct, riskPct);
      await prefs.setDouble(_kBalance, balance);
    } catch (_) {}
  }
}

