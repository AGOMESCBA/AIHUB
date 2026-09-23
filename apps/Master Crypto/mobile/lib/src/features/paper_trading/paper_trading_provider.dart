import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:crypto_swing_app/src/core/api_client.dart';

final paperMetricsProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return await ApiClient.getPaperTradingMetrics();
});

final activePaperTradesProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return await ApiClient.getActivePaperTrades();
});

final paperHistoryProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return await ApiClient.getPaperTradeHistory();
});
