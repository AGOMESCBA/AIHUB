import 'package:flutter/material.dart';

class CryptoLogoAvatar extends StatelessWidget {
  final String symbol;
  final double size;

  const CryptoLogoAvatar({
    super.key,
    required this.symbol,
    this.size = 40.0,
  });

  @override
  Widget build(BuildContext context) {
    final cleanSym = symbol.replaceAll("/", "").replaceAll("USDT", "").toUpperCase();
    final brand = _getBrandConfig(cleanSym);

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          colors: brand.gradientColors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: [
          BoxShadow(
            color: brand.gradientColors.first.withOpacity(0.4),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Center(
        child: Text(
          brand.glyph,
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
            fontSize: size * 0.45,
          ),
        ),
      ),
    );
  }

  _BrandConfig _getBrandConfig(String sym) {
    switch (sym) {
      case 'BTC':
        return _BrandConfig([const Color(0xFFF7931A), const Color(0xFFFFB049)], 'B');
      case 'ETH':
        return _BrandConfig([const Color(0xFF627EEA), const Color(0xFF8C9EFF)], 'E');
      case 'SOL':
        return _BrandConfig([const Color(0xFF14F195), const Color(0xFF9945FF)], 'S');
      case 'AVAX':
        return _BrandConfig([const Color(0xFFE84142), const Color(0xFFFF6B6C)], 'A');
      case 'LINK':
        return _BrandConfig([const Color(0xFF375BD2), const Color(0xFF5A82FF)], 'L');
      case 'NEAR':
        return _BrandConfig([const Color(0xFF00C08B), const Color(0xFF000000)], 'N');
      case 'DOT':
        return _BrandConfig([const Color(0xFFE6007A), const Color(0xFFFF409C)], 'D');
      case 'ADA':
        return _BrandConfig([const Color(0xFF0033AD), const Color(0xFF2C6DFF)], 'A');
      case 'XRP':
        return _BrandConfig([const Color(0xFF23292F), const Color(0xFF00A4E4)], 'X');
      default:
        return _BrandConfig([const Color(0xFF3B82F6), const Color(0xFF2563EB)], sym.isNotEmpty ? sym[0] : 'C');
    }
  }
}

class _BrandConfig {
  final List<Color> gradientColors;
  final String glyph;

  _BrandConfig(this.gradientColors, this.glyph);
}
