import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:crypto_swing_app/src/core/api_client.dart';
import 'package:crypto_swing_app/src/core/websocket_client.dart';
import 'package:crypto_swing_app/src/local_db/app_database.dart';

final topLimitProvider = StateProvider<int>((ref) => 20);

enum RadarExecutionMode { real, simulation }
final radarExecutionModeProvider = StateProvider<RadarExecutionMode>((ref) => RadarExecutionMode.real);

class RadarStateNotifier extends StateNotifier<AsyncValue<Map<String, dynamic>>> {
  final Ref ref;
  StreamSubscription? _wsSubscription;

  RadarStateNotifier(this.ref) : super(const AsyncValue.loading()) {
    fetchOpportunities();
    _initWebSocket();
  }

  Future<void> fetchOpportunities() async {
    final limit = ref.read(topLimitProvider);
    state = const AsyncValue.loading();
    try {
      final liveData = await ApiClient.getActiveOpportunities(topLimit: limit);
      final opps = (liveData["opportunities"] as List?)?.cast<Map<String, dynamic>>() ?? [];
      
      if (opps.isNotEmpty) {
        await globalLocalCache.saveOpportunities(opps);
        state = AsyncValue.data(liveData);
      } else {
        // Se a API retornar vazia ou falhar, tenta ler do cache local
        final cached = await globalLocalCache.loadOpportunities();
        if (cached.isNotEmpty) {
          state = AsyncValue.data({
            "timeframe": "4h",
            "top_limit": limit,
            "active_opportunities_count": cached.length,
            "opportunities": cached,
            "is_cached": true
          });
        } else {
          state = AsyncValue.data(liveData);
        }
      }
    } catch (e, stack) {
      final cached = await globalLocalCache.loadOpportunities();
      if (cached.isNotEmpty) {
        state = AsyncValue.data({
          "timeframe": "4h",
          "top_limit": limit,
          "active_opportunities_count": cached.length,
          "opportunities": cached,
          "is_cached": true
        });
      } else {
        state = AsyncValue.error(e, stack);
      }
    }
  }

  void _initWebSocket() {
    globalWsClient.connect();
    _wsSubscription = globalWsClient.stream.listen((message) {
      if (message["type"] == "TICKER_UPDATE" || message["type"] == "RESCAN") {
        fetchOpportunities();
      }
    });
  }

  @override
  void dispose() {
    _wsSubscription?.cancel();
    super.dispose();
  }
}

final radarNotifierProvider = StateNotifierProvider.autoDispose<RadarStateNotifier, AsyncValue<Map<String, dynamic>>>((ref) {
  return RadarStateNotifier(ref);
});

final radarOpportunitiesProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final limit = ref.watch(topLimitProvider);
  return await ApiClient.getActiveOpportunities(topLimit: limit);
});
