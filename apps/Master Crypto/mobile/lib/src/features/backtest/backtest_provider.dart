import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:crypto_swing_app/src/core/api_client.dart';

final selectedBacktestSymbolProvider = StateProvider<String>((ref) => 'SOLUSDT');
final selectedBacktestTimeframeProvider = StateProvider<String>((ref) => '4h');

final backtestResultProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final symbol = ref.watch(selectedBacktestSymbolProvider);
  final timeframe = ref.watch(selectedBacktestTimeframeProvider);
  return await ApiClient.runBacktest(symbol: symbol, timeframe: timeframe, limit: 300);
});
