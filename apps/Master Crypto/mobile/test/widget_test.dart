import 'package:flutter_test/flutter_test.dart';
import 'package:crypto_swing_app/main.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  testWidgets('App load smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: CryptoSwingApp()));
    expect(find.text('Cripto Master'), findsWidgets);
  });
}
