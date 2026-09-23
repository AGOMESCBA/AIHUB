import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

enum WsStatus { disconnected, connecting, connected }

class WebSocketClient {
  static const String defaultWsUrl = "ws://10.0.2.2:8000/api/v1/ws/market";
  static const String fallbackWsUrl = "ws://127.0.0.1:8000/api/v1/ws/market";

  WebSocketChannel? _channel;
  final StreamController<Map<String, dynamic>> _messageController = StreamController<Map<String, dynamic>>.broadcast();
  WsStatus _status = WsStatus.disconnected;
  Timer? _pingTimer;

  WsStatus get status => _status;
  Stream<Map<String, dynamic>> get stream => _messageController.stream;

  Future<void> connect({String? customUrl}) async {
    if (_status == WsStatus.connected || _status == WsStatus.connecting) return;
    _status = WsStatus.connecting;

    final url = customUrl ?? defaultWsUrl;
    try {
      final uri = Uri.parse(url);
      _channel = WebSocketChannel.connect(uri);
      await _channel?.ready;
      _status = WsStatus.connected;
      debugPrint("WebSocket conectado com sucesso em: $url");

      _channel?.stream.listen(
        (data) {
          try {
            final decoded = json.decode(data.toString()) as Map<String, dynamic>;
            _messageController.add(decoded);
          } catch (e) {
            debugPrint("Erro ao decodificar WebSocket data: $e");
          }
        },
        onError: (error) {
          debugPrint("Erro na conexão WebSocket: $error");
          _handleDisconnect();
        },
        onDone: () {
          debugPrint("Conexão WebSocket finalizada.");
          _handleDisconnect();
        },
      );

      _startPingTimer();
    } catch (e) {
      debugPrint("Falha ao conectar WebSocket em $url: $e");
      if (url == defaultWsUrl) {
        // Tenta fallback para 127.0.0.1 se 10.0.2.2 falhar (ex: Web ou iOS simulator)
        _status = WsStatus.disconnected;
        await connect(customUrl: fallbackWsUrl);
      } else {
        _handleDisconnect();
      }
    }
  }

  void _startPingTimer() {
    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(const Duration(seconds: 25), (timer) {
      if (_status == WsStatus.connected) {
        _channel?.sink.add("ping");
      }
    });
  }

  void _handleDisconnect() {
    _status = WsStatus.disconnected;
    _pingTimer?.cancel();
    _channel?.sink.close();
  }

  void disconnect() {
    _handleDisconnect();
  }

  void dispose() {
    _handleDisconnect();
    _messageController.close();
  }
}

final globalWsClient = WebSocketClient();
