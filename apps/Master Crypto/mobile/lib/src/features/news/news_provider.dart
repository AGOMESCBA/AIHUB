import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:crypto_swing_app/src/core/api_client.dart';

final newsLimitProvider = StateProvider<int>((ref) => 10);
final isTranslateToPtProvider = StateProvider<bool>((ref) => true);

final newsFeedProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final limit = ref.watch(newsLimitProvider);
  return await ApiClient.getNewsFeed(limit: limit);
});
