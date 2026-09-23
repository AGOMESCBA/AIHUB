import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;

class CachedOpportunity {
  final String symbol;
  final String strategy;
  final double totalScore;
  final String regime;
  final double entryZoneMin;
  final double entryZoneMax;
  final double stopLoss;
  final double targetT2;
  final double riskRewardRatio;
  final Map<String, dynamic> jsonPayload;
  final DateTime cachedAt;

  CachedOpportunity({
    required this.symbol,
    required this.strategy,
    required this.totalScore,
    required this.regime,
    required this.entryZoneMin,
    required this.entryZoneMax,
    required this.stopLoss,
    required this.targetT2,
    required this.riskRewardRatio,
    required this.jsonPayload,
    required this.cachedAt,
  });

  Map<String, dynamic> toJson() => {
    'symbol': symbol,
    'strategy': strategy,
    'totalScore': totalScore,
    'regime': regime,
    'entryZoneMin': entryZoneMin,
    'entryZoneMax': entryZoneMax,
    'stopLoss': stopLoss,
    'targetT2': targetT2,
    'riskRewardRatio': riskRewardRatio,
    'jsonPayload': jsonPayload,
    'cachedAt': cachedAt.toIso8601String(),
  };

  factory CachedOpportunity.fromJson(Map<String, dynamic> json) => CachedOpportunity(
    symbol: json['symbol'] as String? ?? '',
    strategy: json['strategy'] as String? ?? '',
    totalScore: (json['totalScore'] as num?)?.toDouble() ?? 0.0,
    regime: json['regime'] as String? ?? '',
    entryZoneMin: (json['entryZoneMin'] as num?)?.toDouble() ?? 0.0,
    entryZoneMax: (json['entryZoneMax'] as num?)?.toDouble() ?? 0.0,
    stopLoss: (json['stopLoss'] as num?)?.toDouble() ?? 0.0,
    targetT2: (json['targetT2'] as num?)?.toDouble() ?? 0.0,
    riskRewardRatio: (json['riskRewardRatio'] as num?)?.toDouble() ?? 0.0,
    jsonPayload: json['jsonPayload'] as Map<String, dynamic>? ?? {},
    cachedAt: DateTime.tryParse(json['cachedAt'] as String? ?? '') ?? DateTime.now(),
  );
}

class LocalCacheManager {
  static const String _cacheFileName = 'opportunities_cache.json';

  Future<File> _getFile() async {
    final dir = Directory.systemTemp;
    return File(p.join(dir.path, _cacheFileName));
  }

  Future<void> saveOpportunities(List<Map<String, dynamic>> rawOpportunities) async {
    try {
      final file = await _getFile();
      final data = rawOpportunities.map((opp) {
        final opportunityObj = opp['opportunity'] as Map<String, dynamic>? ?? opp;
        final tradePlan = opportunityObj['trade_plan'] as Map<String, dynamic>? ?? {};
        return CachedOpportunity(
          symbol: opp['symbol'] as String? ?? opportunityObj['symbol'] as String? ?? 'N/A',
          strategy: tradePlan['strategy'] as String? ?? opportunityObj['strategy'] as String? ?? 'PULLBACK',
          totalScore: (opportunityObj['total_score'] as num?)?.toDouble() ?? 80.0,
          regime: opportunityObj['regime'] as String? ?? 'TRENDING_UP',
          entryZoneMin: (tradePlan['entry_zone_min'] as num?)?.toDouble() ?? 0.0,
          entryZoneMax: (tradePlan['entry_zone_max'] as num?)?.toDouble() ?? 0.0,
          stopLoss: (tradePlan['stop_loss'] as num?)?.toDouble() ?? 0.0,
          targetT2: (tradePlan['target_t2'] as num?)?.toDouble() ?? 0.0,
          riskRewardRatio: (tradePlan['risk_reward_ratio'] as num?)?.toDouble() ?? 2.0,
          jsonPayload: opp,
          cachedAt: DateTime.now(),
        ).toJson();
      }).toList();

      await file.writeAsString(json.encode(data));
    } catch (e) {
      // Ignora falhas silenciosamente ao salvar no cache
    }
  }

  Future<List<Map<String, dynamic>>> loadOpportunities() async {
    try {
      final file = await _getFile();
      if (!await file.exists()) return [];
      final content = await file.readAsString();
      final List<dynamic> decoded = json.decode(content);
      return decoded.map((item) {
        final cached = CachedOpportunity.fromJson(item as Map<String, dynamic>);
        return cached.jsonPayload;
      }).toList();
    } catch (e) {
      return [];
    }
  }
}

final globalLocalCache = LocalCacheManager();
