import 'package:flutter/material.dart';

class AppTheme {
  // Paleta Binance Clean Dark (Inspirada no App Oficial da Binance)
  static const Color darkBackground = Color(0xFF181A20); // Binance Primary Dark
  static const Color darkCardSurface = Color(0xFF1E2329); // Binance Surface Dark
  static const Color darkBorder = Color(0xFF2B313A); // Binance Subtle Border

  static const Color binanceYellow = Color(0xFFFCD535); // Binance Vivid Gold/Yellow
  static const Color accentBlue = Color(0xFF2B6ECB); // Electric Blue
  static const Color accentGreen = Color(0xFF0ECB81); // Binance Vivid Green (Up)
  static const Color accentGreenLight = Color(0xFF0ECB81); // Binance Vivid Green
  static const Color accentRed = Color(0xFFF6465D); // Binance Vivid Red (Down)
  static const Color accentPurple = Color(0xFF818CF8); // Modern Indigo
  static const Color accentGold = Color(0xFFFCD535); // Binance Gold

  static const Color textPrimary = Color(0xFFEAECEF); // Binance Text Primary
  static const Color textSecondary = Color(0xFF848E9C); // Binance Muted Secondary Text

  static LinearGradient primaryGradient = const LinearGradient(
    colors: [Color(0xFF1E2329), Color(0xFF181A20)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static LinearGradient accentGradient = const LinearGradient(
    colors: [Color(0xFF0ECB81), Color(0xFF059669)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static ThemeData get darkTheme {
    return ThemeData.dark().copyWith(
      scaffoldBackgroundColor: darkBackground,
      colorScheme: const ColorScheme.dark(
        primary: accentGreenLight,
        secondary: binanceYellow,
        surface: darkCardSurface,
        error: accentRed,
      ),
      cardTheme: const CardThemeData(
        color: darkCardSurface,
        elevation: 1,
        shadowColor: Color(0x33000000),
        shape: RoundedRectangleBorder(
          side: BorderSide(color: darkBorder, width: 1),
          borderRadius: BorderRadius.all(Radius.circular(12)),
        ),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: darkCardSurface,
        elevation: 0,
        centerTitle: false,
        iconTheme: IconThemeData(color: textPrimary),
        titleTextStyle: TextStyle(
          color: textPrimary,
          fontSize: 18,
          fontWeight: FontWeight.bold,
          letterSpacing: -0.5,
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: darkCardSurface,
        selectedItemColor: accentGreenLight,
        unselectedItemColor: textSecondary,
        type: BottomNavigationBarType.fixed,
        elevation: 8,
      ),
    );
  }
}

/// Utilitário Global para Formatação Limpa e Precisa de Preços de Criptoativos
String formatCryptoPrice(dynamic price) {
  if (price == null) return "0.00";
  num p;
  if (price is String) {
    p = num.tryParse(price.replaceAll('\$', '').replaceAll(' ', '').trim()) ?? 0.0;
  } else if (price is num) {
    p = price;
  } else {
    return price.toString();
  }

  final double val = p.toDouble();
  final double absVal = val.abs();

  if (absVal >= 1000) {
    final intPart = val.truncate();
    final decPart = ((absVal - absVal.truncate()) * 100).round().toString().padLeft(2, '0');
    final strInt = intPart.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (Match m) => '${m[1]}.');
    return "$strInt,$decPart";
  } else if (absVal >= 10) {
    return val.toStringAsFixed(2).replaceAll('.', ',');
  } else if (absVal >= 1) {
    return val.toStringAsFixed(4).replaceAll('.', ',');
  } else if (absVal >= 0.0001) {
    return val.toStringAsFixed(4).replaceAll('.', ',');
  } else {
    return val.toStringAsFixed(6).replaceAll('.', ',');
  }
}

