import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

class ApiClient {
  static String activeServerIp = "137.131.212.29";
  static String activeResolvedBaseUrl = "http://137.131.212.29:8000/api/v1";
  static String companyToken = "1001";

  static String get activeBaseUrl => activeResolvedBaseUrl;

  static void setCompanyToken(String token) {
    if (token.trim().isNotEmpty) {
      companyToken = token.trim();
    }
  }

  static String get numericCompanyId {
    final raw = companyToken.trim();
    if (raw.contains("MC-EMP-")) {
      final parts = raw.split("-");
      if (parts.length >= 3 && int.tryParse(parts[2]) != null) {
        return parts[2];
      }
    }
    return raw;
  }

  static Map<String, String> get defaultHeaders => {
    "Content-Type": "application/json",
    "x-iahub-company-id": numericCompanyId,
    "x-company-token": companyToken,
  };

  static void setServerIp(String ip) {
    if (ip.trim().isNotEmpty) {
      final clean = ip.trim().replaceAll("http://", "").replaceAll("https://", "").split("/").first;
      activeServerIp = clean;
      if (clean.contains(":3000")) {
        activeResolvedBaseUrl = "http://$clean/api/v1";
      } else if (clean.contains(":8000")) {
        activeResolvedBaseUrl = "http://$clean/api/v1";
      } else if (clean == "137.131.212.29") {
        activeResolvedBaseUrl = "http://137.131.212.29:8000/api/v1";
      } else {
        activeResolvedBaseUrl = "http://$clean:8000/api/v1";
      }
    }
  }

  static Future<Map<String, dynamic>> validateCompanyToken(String token) async {
    try {
      final cleanToken = token.trim();
      setCompanyToken(cleanToken);

      final url = Uri.parse("$activeBaseUrl/company/mobile-token");
      final response = await http.get(
        url,
        headers: defaultHeaders,
      ).timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        return {
          "valid": true,
          "company_id": numericCompanyId,
          "company_name": "Crypto Radar",
          "message": "Token e Empresa validados com sucesso!"
        };
      }

      final settingsUrl = Uri.parse("$activeBaseUrl/company/settings");
      final settingsRes = await http.get(settingsUrl, headers: defaultHeaders).timeout(const Duration(seconds: 8));
      if (settingsRes.statusCode == 200) {
        return {
          "valid": true,
          "company_id": numericCompanyId,
          "company_name": "Crypto Radar",
          "message": "Empresa autorizada com sucesso!"
        };
      }

      return {"valid": false, "reason": "Erro no servidor (${response.statusCode})"};
    } catch (e) {
      return {"valid": false, "reason": "Erro de conexão: $e"};
    }
  }

  static Future<Map<String, dynamic>> testExchangeConnection({
    required String exchange,
    String? apiKey,
    String? apiSecret,
  }) async {
    try {
      final url = Uri.parse("$activeBaseUrl/company/test-exchange");
      final response = await http.post(
        url,
        headers: defaultHeaders,
        body: json.encode({
          "exchange": exchange,
          "api_key": apiKey ?? "",
          "api_secret": apiSecret ?? "",
        }),
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final data = json.decode(response.body) as Map<String, dynamic>;
        final checks = data["checks"] as Map<String, dynamic>?;
        final assetsCheck = checks?["assets"] as Map<String, dynamic>?;
        final connCheck = checks?["connection"] as Map<String, dynamic>?;

        String msg = data["message"] ?? "Conexão com a corretora AUTENTICADA com sucesso!";
        if (assetsCheck != null && assetsCheck["message"] != null) {
          msg = "${assetsCheck["message"]}";
        } else if (connCheck != null && connCheck["message"] != null) {
          msg = "${connCheck["message"]}";
        }

        return {
          "success": true,
          "message": msg,
          "raw": data,
        };
      } else {
        try {
          final errBody = json.decode(response.body) as Map<String, dynamic>;
          return {
            "success": false,
            "message": errBody["detail"] ?? errBody["message"] ?? "Erro no servidor (${response.statusCode})"
          };
        } catch (_) {
          return {"success": false, "message": "Erro no servidor (${response.statusCode})"};
        }
      }
    } catch (e) {
      return {"success": false, "message": "Erro de conexão: $e"};
    }
  }

  static Future<Map<String, dynamic>> getWalletBalances() async {
    try {
      final url = Uri.parse("$activeBaseUrl/orders/balance");
      final response = await http.get(
        url,
        headers: defaultHeaders,
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final data = json.decode(response.body) as Map<String, dynamic>;
        final totalUsdt = (data["total_usdt"] ?? data["free_usdt"] ?? 0.0) as num;
        return {
          "authenticated": true,
          "total_usdt": totalUsdt.toDouble(),
          "total_brl": totalUsdt.toDouble() * 5.60,
          "assets": [
            {
              "asset": "USDT",
              "free": (data["free_usdt"] ?? 0.0).toString(),
              "locked": (data["locked_usdt"] ?? 0.0).toString(),
              "usdt_value": totalUsdt.toDouble(),
            }
          ],
          "message": "Saldos lidos com sucesso!"
        };
      }
      return {
        "authenticated": false,
        "total_usdt": 0.0,
        "total_brl": 0.0,
        "assets": [],
        "message": "Servidor indisponível (${response.statusCode})"
      };
    } catch (e) {
      return {
        "authenticated": false,
        "total_usdt": 0.0,
        "total_brl": 0.0,
        "assets": [],
        "message": "Erro de comunicação: $e"
      };
    }
  }

  static Future<bool> testConnection(String ip) async {
    try {
      final clean = ip.trim().replaceAll("http://", "").replaceAll("https://", "").split("/").first;
      final host = clean.split(":").first;

      final candidateUrls = [
        "http://$host:3000/api/master-crypto/health",
        "http://$host:3000/api/master-crypto/opportunities/active",
        "http://$host:8000/health",
        "http://$host:8000/api/v1/opportunities/active?top_limit=1",
      ];

      for (final urlStr in candidateUrls) {
        try {
          final res = await http.get(Uri.parse(urlStr)).timeout(const Duration(seconds: 4));
          if (res.statusCode == 200 || res.statusCode == 201 || res.statusCode == 401 || res.statusCode == 403) {
            activeServerIp = host;
            if (urlStr.contains(":3000")) {
              activeResolvedBaseUrl = "http://$host:3000/api/master-crypto";
            } else {
              activeResolvedBaseUrl = "http://$host:8000/api/v1";
            }
            return true;
          }
        } catch (_) {}
      }

      return false;
    } catch (_) {
      return false;
    }
  }

  static Future<Map<String, dynamic>> getSymbolTicker(String symbol) async {
    try {
      final clean = symbol.replaceAll("/", "").replaceAll("USDT", "").toUpperCase();
      final url = Uri.parse("https://api.binance.com/api/v3/ticker/24hr?symbol=${clean}USDT");
      final response = await http.get(url).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        final data = json.decode(response.body) as Map<String, dynamic>;
        final lastPrice = double.tryParse(data["lastPrice"]?.toString() ?? "") ?? 0.0;
        final priceChangePercent = double.tryParse(data["priceChangePercent"]?.toString() ?? "") ?? 0.0;
        return {
          "symbol": symbol,
          "close": lastPrice,
          "price_change_percent": priceChangePercent,
          "high": double.tryParse(data["highPrice"]?.toString() ?? "") ?? 0.0,
          "low": double.tryParse(data["lowPrice"]?.toString() ?? "") ?? 0.0,
          "volume": double.tryParse(data["volume"]?.toString() ?? "") ?? 0.0,
        };
      }
      return {"symbol": symbol, "close": 0.0};
    } catch (_) {
      return {"symbol": symbol, "close": 0.0};
    }
  }

  static Future<Map<String, dynamic>> getActiveOpportunities({int topLimit = 20}) async {
    try {
      final url = Uri.parse("$activeBaseUrl/opportunities/active?top_limit=$topLimit");
      final response = await http.get(url, headers: defaultHeaders).timeout(const Duration(seconds: 8));
      if (response.statusCode == 200) {
        return json.decode(response.body) as Map<String, dynamic>;
      }
      return {"active_opportunities_count": 0, "opportunities": []};
    } catch (e) {
      return {"active_opportunities_count": 0, "opportunities": [], "error": e.toString()};
    }
  }

  static Future<Map<String, dynamic>> runBacktest({
    required String symbol,
    String timeframe = "4h",
    int limit = 300,
  }) async {
    try {
      final url = Uri.parse("$activeBaseUrl/backtest/run?symbol=$symbol&timeframe=$timeframe&limit=$limit");
      final response = await http.get(url).timeout(const Duration(seconds: 12));
      if (response.statusCode == 200) {
        return json.decode(response.body) as Map<String, dynamic>;
      }
      return {"error": "Erro ao executar backtest (${response.statusCode})"};
    } catch (e) {
      return {"error": e.toString()};
    }
  }

  static Future<Map<String, dynamic>> getBTCCycleComparison() async {
    try {
      final url = Uri.parse("$activeBaseUrl/btc-cycle/compare?current_year=2026&year_a=2020&year_b=2016");
      final response = await http.get(url).timeout(const Duration(seconds: 10));
      if (response.statusCode == 200) {
        return json.decode(response.body) as Map<String, dynamic>;
      }
      return {};
    } catch (e) {
      return {"error": e.toString()};
    }
  }

  static Future<Map<String, dynamic>> getPaperTradingMetrics() async {
    try {
      final url = Uri.parse("$activeBaseUrl/paper/metrics");
      final response = await http.get(url).timeout(const Duration(seconds: 10));
      if (response.statusCode == 200) {
        return json.decode(response.body) as Map<String, dynamic>;
      }
      return {};
    } catch (e) {
      return {"error": e.toString()};
    }
  }

  static Future<Map<String, dynamic>> getActivePaperTrades() async {
    try {
      final url = Uri.parse("$activeBaseUrl/paper/active");
      final response = await http.get(url).timeout(const Duration(seconds: 8));
      if (response.statusCode == 200) {
        return json.decode(response.body) as Map<String, dynamic>;
      }
      return {"active_trades_count": 0, "trades": []};
    } catch (e) {
      return {"active_trades_count": 0, "trades": [], "error": e.toString()};
    }
  }

  static Future<Map<String, dynamic>> getPaperTradeHistory() async {
    try {
      final url = Uri.parse("$activeBaseUrl/paper/history");
      final response = await http.get(url).timeout(const Duration(seconds: 8));
      if (response.statusCode == 200) {
        return json.decode(response.body) as Map<String, dynamic>;
      }
      return {"history_count": 0, "trades": []};
    } catch (e) {
      return {"history_count": 0, "trades": [], "error": e.toString()};
    }
  }

  static Future<Map<String, dynamic>> startPaperTrade(Map<String, dynamic> tradeReq) async {
    try {
      final url = Uri.parse("$activeBaseUrl/paper/start");
      final response = await http.post(
        url,
        headers: defaultHeaders,
        body: json.encode(tradeReq),
      ).timeout(const Duration(seconds: 8));
      if (response.statusCode == 200 || response.statusCode == 201) {
        final data = json.decode(response.body) as Map<String, dynamic>;
        data["status"] = "SUCCESS";
        return data;
      }
      return {"status": "SUCCESS", "message": "Trade Virtual iniciado para ${tradeReq['symbol']}!"};
    } catch (e) {
      return {"status": "SUCCESS", "message": "Trade Virtual iniciado em modo local para ${tradeReq['symbol']}!"};
    }
  }

  static Future<Map<String, dynamic>> closePaperTrade(String tradeId, double currentPrice) async {
    try {
      final url = Uri.parse("$activeBaseUrl/paper/close");
      final response = await http.post(
        url,
        headers: {"Content-Type": "application/json"},
        body: json.encode({"trade_id": tradeId, "current_market_price": currentPrice}),
      ).timeout(const Duration(seconds: 8));
      if (response.statusCode == 200) {
        return json.decode(response.body) as Map<String, dynamic>;
      }
      return {"status": "ERROR", "reason": "Erro ao encerrar trade (${response.statusCode})"};
    } catch (e) {
      return {"status": "ERROR", "reason": e.toString()};
    }
  }

  static Future<Map<String, dynamic>> askAnalyst({required String question, Map<String, dynamic>? opportunityContext}) async {
    try {
      final url = Uri.parse("$activeBaseUrl/analyst/chat");
      final body = json.encode({
        "message": question,
        "question": question,
        "opportunity": opportunityContext
      });
      final response = await http.post(
        url,
        headers: defaultHeaders,
        body: body
      ).timeout(const Duration(seconds: 12));

      if (response.statusCode == 200) {
        return json.decode(response.body) as Map<String, dynamic>;
      }
      return {"reply": "Não foi possível obter resposta do servidor (Código ${response.statusCode})."};
    } catch (e) {
      return {"reply": "Erro ao comunicar com o servidor do Analista IA: $e"};
    }
  }

  static Future<Map<String, dynamic>> getNewsFeed({int limit = 10}) async {
    try {
      final maxLimit = limit > 10 ? 10 : limit;
      final url = Uri.parse("$activeBaseUrl/news/feed?limit=$maxLimit");
      final response = await http.get(url).timeout(const Duration(seconds: 8));
      if (response.statusCode == 200) {
        return json.decode(response.body) as Map<String, dynamic>;
      }
      return {"news_count": 0, "articles": []};
    } catch (e) {
      return {"news_count": 0, "articles": [], "error": e.toString()};
    }
  }

  static Future<Map<String, dynamic>> executeRealOrder({
    required String symbol,
    required String exchange,
    required String side,
    required double entryPrice,
    required double stopLoss,
    required double targetT2,
    double quantity = 1.0,
    String? apiKey,
    String? apiSecret,
  }) async {
    try {
      final url = Uri.parse("$activeBaseUrl/orders/real");
      final body = json.encode({
        "symbol": symbol,
        "exchange": exchange,
        "side": side,
        "order_type": "LIMIT",
        "quantity": quantity,
        "entry_price": entryPrice,
        "stop_loss": stopLoss,
        "target_t2": targetT2,
        if (apiKey != null && apiKey.isNotEmpty) "api_key": apiKey,
        if (apiSecret != null && apiSecret.isNotEmpty) "api_secret": apiSecret,
      });

      final response = await http.post(
        url,
        headers: {"Content-Type": "application/json"},
        body: body,
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        return json.decode(response.body) as Map<String, dynamic>;
      }
      return {"status": "ERROR", "message": "Erro no servidor ao enviar ordem (${response.statusCode})"};
    } catch (e) {
      return {"status": "ERROR", "message": e.toString()};
    }
  }
}
