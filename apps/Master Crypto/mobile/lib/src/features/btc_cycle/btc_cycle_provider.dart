import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:crypto_swing_app/src/core/api_client.dart';

final btcCycleProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return await ApiClient.getBTCCycleComparison();
});
