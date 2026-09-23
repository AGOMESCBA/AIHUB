import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:crypto_swing_app/src/core/theme.dart';

/// Widget de Ícones Vetoriais Garantidos (CustomPainter)
/// Impossível exibir caixa de colchetes [] em qualquer celular.
class AppIcon extends StatelessWidget {
  final AppIconType type;
  final double size;
  final Color? color;

  const AppIcon(
    this.type, {
    super.key,
    this.size = 20.0,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final iconColor = color ?? AppTheme.accentBlue;

    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        size: Size(size, size),
        painter: _AppIconPainter(type, iconColor),
      ),
    );
  }
}

enum AppIconType {
  settings,
  arrowBack,
  home,
  analyst,
  simulation,
  realTrading,
  market,
  chart,
  buy,
  filter,
  btc,
  check,
  warning,
  info,
  refresh,
  close,
  bolt,
  wallet,
  tune,
  send,
  news,
  history,
  trendingUp,
  trendingDown,
  copy,
  delete,
  search,
  play,
  arrowDown,
  arrowUp,
  transfer,
  earn,
  add,
}

class _AppIconPainter extends CustomPainter {
  final AppIconType type;
  final Color color;

  _AppIconPainter(this.type, this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final strokePaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.1
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final fillPaint = Paint()
      ..color = color
      ..style = PaintingStyle.fill;

    switch (type) {
      case AppIconType.settings:
        // Engrenagem Executiva (Estilo IAMeet)
        final center = Offset(w / 2, h / 2);
        final outerR = w * 0.42;
        final innerR = w * 0.28;
        final holeR = w * 0.14;

        canvas.drawCircle(center, holeR, strokePaint);

        final teeth = 6;
        final toothPath = Path();
        for (int i = 0; i < teeth; i++) {
          final angle = (i * 2 * 3.14159265) / teeth;
          final x1 = center.dx + innerR * math.cos(angle - 0.2);
          final y1 = center.dy + innerR * math.sin(angle - 0.2);
          final x2 = center.dx + outerR * math.cos(angle - 0.15);
          final y2 = center.dy + outerR * math.sin(angle - 0.15);
          final x3 = center.dx + outerR * math.cos(angle + 0.15);
          final y3 = center.dy + outerR * math.sin(angle + 0.15);
          final x4 = center.dx + innerR * math.cos(angle + 0.2);
          final y4 = center.dy + innerR * math.sin(angle + 0.2);

          if (i == 0) toothPath.moveTo(x1, y1);
          toothPath.lineTo(x2, y2);
          toothPath.lineTo(x3, y3);
          toothPath.lineTo(x4, y4);
        }
        toothPath.close();
        canvas.drawPath(toothPath, fillPaint);
        canvas.drawCircle(center, innerR, strokePaint);
        break;

      case AppIconType.arrowBack:
        // Seta para Esquerda (Voltar)
        final p = Path()
          ..moveTo(w * 0.7, h * 0.2)
          ..lineTo(w * 0.3, h * 0.5)
          ..lineTo(w * 0.7, h * 0.8);
        canvas.drawPath(p, strokePaint);
        canvas.drawLine(Offset(w * 0.3, h * 0.5), Offset(w * 0.85, h * 0.5), strokePaint);
        break;

      case AppIconType.home:
        // Casa (Home)
        final p = Path()
          ..moveTo(w * 0.15, h * 0.5)
          ..lineTo(w * 0.5, h * 0.18)
          ..lineTo(w * 0.85, h * 0.5)
          ..lineTo(w * 0.85, h * 0.85)
          ..lineTo(w * 0.15, h * 0.85)
          ..close();
        canvas.drawPath(p, strokePaint);
        break;

      case AppIconType.analyst:
        // Robô IA (Analista)
        canvas.drawRRect(RRect.fromLTRBR(w * 0.2, h * 0.3, w * 0.8, h * 0.8, Radius.circular(w * 0.12)), strokePaint);
        canvas.drawCircle(Offset(w * 0.38, h * 0.52), w * 0.08, fillPaint);
        canvas.drawCircle(Offset(w * 0.62, h * 0.52), w * 0.08, fillPaint);
        canvas.drawLine(Offset(w * 0.38, h * 0.68), Offset(w * 0.62, h * 0.68), strokePaint);
        canvas.drawLine(Offset(w * 0.5, h * 0.3), Offset(w * 0.5, h * 0.12), strokePaint);
        canvas.drawCircle(Offset(w * 0.5, h * 0.1), w * 0.06, fillPaint);
        break;

      case AppIconType.simulation:
        // Treino / Simulação (Chapéu Formatura ou Troféu)
        final p = Path()
          ..moveTo(w * 0.5, h * 0.2)
          ..lineTo(w * 0.85, h * 0.4)
          ..lineTo(w * 0.5, h * 0.6)
          ..lineTo(w * 0.15, h * 0.4)
          ..close();
        canvas.drawPath(p, strokePaint);
        canvas.drawLine(Offset(w * 0.3, h * 0.52), Offset(w * 0.3, h * 0.78), strokePaint);
        canvas.drawLine(Offset(w * 0.3, h * 0.78), Offset(w * 0.7, h * 0.78), strokePaint);
        canvas.drawLine(Offset(w * 0.7, h * 0.78), Offset(w * 0.7, h * 0.52), strokePaint);
        break;

      case AppIconType.realTrading:
        // Operações Reais / Carteira
        canvas.drawRRect(RRect.fromLTRBR(w * 0.15, h * 0.3, w * 0.85, h * 0.85, Radius.circular(w * 0.1)), strokePaint);
        canvas.drawRRect(RRect.fromLTRBR(w * 0.55, h * 0.48, w * 0.85, h * 0.68, Radius.circular(w * 0.06)), fillPaint);
        break;

      case AppIconType.market:
        // Mercado / Gráfico de Velas
        canvas.drawLine(Offset(w * 0.25, h * 0.3), Offset(w * 0.25, h * 0.75), strokePaint);
        canvas.drawRect(Rect.fromLTWH(w * 0.18, h * 0.4, w * 0.14, h * 0.25), fillPaint);

        canvas.drawLine(Offset(w * 0.5, h * 0.15), Offset(w * 0.5, h * 0.85), strokePaint);
        canvas.drawRect(Rect.fromLTWH(w * 0.43, h * 0.25, w * 0.14, h * 0.45), fillPaint);

        canvas.drawLine(Offset(w * 0.75, h * 0.35), Offset(w * 0.75, h * 0.7), strokePaint);
        canvas.drawRect(Rect.fromLTWH(w * 0.68, h * 0.45, w * 0.14, h * 0.18), fillPaint);
        break;

      case AppIconType.chart:
        // Gráfico de Linha (Ver Plano)
        final p = Path()
          ..moveTo(w * 0.15, h * 0.75)
          ..lineTo(w * 0.38, h * 0.5)
          ..lineTo(w * 0.58, h * 0.62)
          ..lineTo(w * 0.85, h * 0.25);
        canvas.drawPath(p, strokePaint);
        canvas.drawCircle(Offset(w * 0.85, h * 0.25), w * 0.08, fillPaint);
        break;

      case AppIconType.buy:
        // Sacola / Compra (Executar Compra)
        final p = Path()
          ..moveTo(w * 0.2, h * 0.35)
          ..lineTo(w * 0.8, h * 0.35)
          ..lineTo(w * 0.75, h * 0.85)
          ..lineTo(w * 0.25, h * 0.85)
          ..close();
        canvas.drawPath(p, strokePaint);
        final handle = Path()
          ..addArc(Rect.fromLTWH(w * 0.35, h * 0.15, w * 0.3, h * 0.35), 3.1415, 3.1415);
        canvas.drawPath(handle, strokePaint);
        break;

      case AppIconType.filter:
        // Filtro / Scanner
        final p = Path()
          ..moveTo(w * 0.15, h * 0.2)
          ..lineTo(w * 0.85, h * 0.2)
          ..lineTo(w * 0.58, h * 0.55)
          ..lineTo(w * 0.58, h * 0.85)
          ..lineTo(w * 0.42, h * 0.75)
          ..lineTo(w * 0.42, h * 0.55)
          ..close();
        canvas.drawPath(p, strokePaint);
        break;

      case AppIconType.btc:
        // Bitcoin (Círculo B)
        canvas.drawCircle(Offset(w / 2, h / 2), w * 0.42, strokePaint);
        final p = Path()
          ..moveTo(w * 0.4, h * 0.28)
          ..lineTo(w * 0.4, h * 0.72)
          ..moveTo(w * 0.4, h * 0.28)
          ..lineTo(w * 0.58, h * 0.28)
          ..arcToPoint(Offset(w * 0.58, h * 0.5), radius: Radius.circular(w * 0.11))
          ..lineTo(w * 0.4, h * 0.5)
          ..moveTo(w * 0.4, h * 0.5)
          ..lineTo(w * 0.62, h * 0.5)
          ..arcToPoint(Offset(w * 0.62, h * 0.72), radius: Radius.circular(w * 0.11))
          ..lineTo(w * 0.4, h * 0.72);
        canvas.drawPath(p, strokePaint);
        break;

      case AppIconType.check:
        // Check / Confirmado
        final p = Path()
          ..moveTo(w * 0.2, h * 0.5)
          ..lineTo(w * 0.42, h * 0.72)
          ..lineTo(w * 0.82, h * 0.28);
        canvas.drawPath(p, strokePaint);
        break;

      case AppIconType.warning:
        // Alerta
        final p = Path()
          ..moveTo(w * 0.5, h * 0.15)
          ..lineTo(w * 0.88, h * 0.82)
          ..lineTo(w * 0.12, h * 0.82)
          ..close();
        canvas.drawPath(p, strokePaint);
        canvas.drawLine(Offset(w * 0.5, h * 0.4), Offset(w * 0.5, h * 0.62), strokePaint);
        canvas.drawCircle(Offset(w * 0.5, h * 0.73), w * 0.05, fillPaint);
        break;

      case AppIconType.info:
        // Informação
        canvas.drawCircle(Offset(w / 2, h / 2), w * 0.42, strokePaint);
        canvas.drawCircle(Offset(w * 0.5, h * 0.32), w * 0.06, fillPaint);
        canvas.drawLine(Offset(w * 0.5, h * 0.45), Offset(w * 0.5, h * 0.72), strokePaint);
        break;

      case AppIconType.refresh:
        // Recarregar
        canvas.drawArc(Rect.fromLTWH(w * 0.15, h * 0.15, w * 0.7, h * 0.7), 0.5, 5.2, false, strokePaint);
        final arrow = Path()
          ..moveTo(w * 0.75, h * 0.25)
          ..lineTo(w * 0.9, h * 0.4)
          ..lineTo(w * 0.65, h * 0.45);
        canvas.drawPath(arrow, strokePaint);
        break;

      case AppIconType.close:
        // Fechar (X)
        canvas.drawLine(Offset(w * 0.25, h * 0.25), Offset(w * 0.75, h * 0.75), strokePaint);
        canvas.drawLine(Offset(w * 0.75, h * 0.25), Offset(w * 0.25, h * 0.75), strokePaint);
        break;

      case AppIconType.bolt:
        // Raio
        final p = Path()
          ..moveTo(w * 0.55, h * 0.1)
          ..lineTo(w * 0.2, h * 0.55)
          ..lineTo(w * 0.48, h * 0.55)
          ..lineTo(w * 0.42, h * 0.9)
          ..lineTo(w * 0.8, h * 0.45)
          ..lineTo(w * 0.52, h * 0.45)
          ..close();
        canvas.drawPath(p, fillPaint);
        break;

      case AppIconType.wallet:
        // Carteira
        canvas.drawRRect(RRect.fromLTRBR(w * 0.15, h * 0.25, w * 0.85, h * 0.85, Radius.circular(w * 0.1)), strokePaint);
        canvas.drawLine(Offset(w * 0.15, h * 0.42), Offset(w * 0.85, h * 0.42), strokePaint);
        canvas.drawCircle(Offset(w * 0.7, h * 0.62), w * 0.08, fillPaint);
        break;

      case AppIconType.tune:
        // Sliders de Ajuste
        canvas.drawLine(Offset(w * 0.2, h * 0.3), Offset(w * 0.8, h * 0.3), strokePaint);
        canvas.drawCircle(Offset(w * 0.4, h * 0.3), w * 0.08, fillPaint);
        canvas.drawLine(Offset(w * 0.2, h * 0.7), Offset(w * 0.8, h * 0.7), strokePaint);
        canvas.drawCircle(Offset(w * 0.6, h * 0.7), w * 0.08, fillPaint);
        break;

      case AppIconType.send:
        // Aviãozinho de Envio
        final p = Path()
          ..moveTo(w * 0.15, h * 0.15)
          ..lineTo(w * 0.85, h * 0.5)
          ..lineTo(w * 0.15, h * 0.85)
          ..lineTo(w * 0.35, h * 0.5)
          ..close();
        canvas.drawPath(p, fillPaint);
        break;

      case AppIconType.news:
        // Jornal / Notícia
        canvas.drawRect(Rect.fromLTWH(w * 0.2, h * 0.2, w * 0.6, h * 0.6), strokePaint);
        canvas.drawLine(Offset(w * 0.3, h * 0.35), Offset(w * 0.7, h * 0.35), strokePaint);
        canvas.drawLine(Offset(w * 0.3, h * 0.5), Offset(w * 0.7, h * 0.5), strokePaint);
        canvas.drawLine(Offset(w * 0.3, h * 0.65), Offset(w * 0.55, h * 0.65), strokePaint);
        break;

      case AppIconType.history:
        // Relógio / Histórico
        canvas.drawCircle(Offset(w / 2, h / 2), w * 0.38, strokePaint);
        canvas.drawLine(Offset(w * 0.5, h * 0.5), Offset(w * 0.5, h * 0.25), strokePaint);
        canvas.drawLine(Offset(w * 0.5, h * 0.5), Offset(w * 0.7, h * 0.5), strokePaint);
        break;

      case AppIconType.trendingUp:
        // Seta Altista
        final p = Path()
          ..moveTo(w * 0.15, h * 0.75)
          ..lineTo(w * 0.45, h * 0.45)
          ..lineTo(w * 0.62, h * 0.6)
          ..lineTo(w * 0.85, h * 0.25);
        canvas.drawPath(p, strokePaint);
        final arrow = Path()
          ..moveTo(w * 0.62, h * 0.25)
          ..lineTo(w * 0.85, h * 0.25)
          ..lineTo(w * 0.85, h * 0.48);
        canvas.drawPath(arrow, strokePaint);
        break;

      case AppIconType.trendingDown:
        // Seta Baixista
        final p = Path()
          ..moveTo(w * 0.15, h * 0.25)
          ..lineTo(w * 0.45, h * 0.55)
          ..lineTo(w * 0.62, h * 0.4)
          ..lineTo(w * 0.85, h * 0.75);
        canvas.drawPath(p, strokePaint);
        final arrow = Path()
          ..moveTo(w * 0.62, h * 0.75)
          ..lineTo(w * 0.85, h * 0.75)
          ..lineTo(w * 0.85, h * 0.52);
        canvas.drawPath(arrow, strokePaint);
        break;

      case AppIconType.copy:
        // Copiar (Dois papéis)
        canvas.drawRect(Rect.fromLTWH(w * 0.18, h * 0.35, w * 0.45, h * 0.5), strokePaint);
        canvas.drawRect(Rect.fromLTWH(w * 0.35, h * 0.18, w * 0.45, h * 0.5), strokePaint);
        break;

      case AppIconType.delete:
        // Lixeira
        canvas.drawLine(Offset(w * 0.2, h * 0.3), Offset(w * 0.8, h * 0.3), strokePaint);
        canvas.drawRect(Rect.fromLTWH(w * 0.3, h * 0.3, w * 0.4, h * 0.55), strokePaint);
        canvas.drawLine(Offset(w * 0.4, h * 0.2), Offset(w * 0.6, h * 0.2), strokePaint);
        break;

      case AppIconType.search:
        // Lupa
        canvas.drawCircle(Offset(w * 0.42, h * 0.42), w * 0.25, strokePaint);
        canvas.drawLine(Offset(w * 0.6, h * 0.6), Offset(w * 0.82, h * 0.82), strokePaint);
        break;

      case AppIconType.play:
        // Play
        final p = Path()
          ..moveTo(w * 0.3, h * 0.2)
          ..lineTo(w * 0.8, h * 0.5)
          ..lineTo(w * 0.3, h * 0.8)
          ..close();
        canvas.drawPath(p, fillPaint);
        break;

      case AppIconType.arrowDown:
        final p = Path()
          ..moveTo(w * 0.5, h * 0.15)
          ..lineTo(w * 0.5, h * 0.8)
          ..moveTo(w * 0.25, h * 0.55)
          ..lineTo(w * 0.5, h * 0.8)
          ..lineTo(w * 0.75, h * 0.55);
        canvas.drawPath(p, strokePaint);
        break;

      case AppIconType.arrowUp:
        final p = Path()
          ..moveTo(w * 0.5, h * 0.85)
          ..lineTo(w * 0.5, h * 0.2)
          ..moveTo(w * 0.25, h * 0.45)
          ..lineTo(w * 0.5, h * 0.2)
          ..lineTo(w * 0.75, h * 0.45);
        canvas.drawPath(p, strokePaint);
        break;

      case AppIconType.transfer:
        canvas.drawLine(Offset(w * 0.2, h * 0.35), Offset(w * 0.75, h * 0.35), strokePaint);
        canvas.drawLine(Offset(w * 0.55, h * 0.2), Offset(w * 0.75, h * 0.35), strokePaint);
        canvas.drawLine(Offset(w * 0.25, h * 0.65), Offset(w * 0.8, h * 0.65), strokePaint);
        canvas.drawLine(Offset(w * 0.25, h * 0.65), Offset(w * 0.45, h * 0.8), strokePaint);
        break;

      case AppIconType.earn:
        canvas.drawCircle(Offset(w * 0.5, h * 0.55), w * 0.3, strokePaint);
        canvas.drawCircle(Offset(w * 0.5, h * 0.25), w * 0.12, strokePaint);
        canvas.drawLine(Offset(w * 0.38, h * 0.85), Offset(w * 0.38, h * 0.95), strokePaint);
        canvas.drawLine(Offset(w * 0.62, h * 0.85), Offset(w * 0.62, h * 0.95), strokePaint);
        break;

      case AppIconType.add:
        canvas.drawLine(Offset(w * 0.5, h * 0.2), Offset(w * 0.5, h * 0.8), strokePaint);
        canvas.drawLine(Offset(w * 0.2, h * 0.5), Offset(w * 0.8, h * 0.5), strokePaint);
        break;
    }
  }

  @override
  bool shouldRepaint(covariant _AppIconPainter oldDelegate) =>
      oldDelegate.type != type || oldDelegate.color != color;
}
