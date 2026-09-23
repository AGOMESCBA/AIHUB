import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:crypto_swing_app/src/core/theme.dart';
import 'package:crypto_swing_app/src/core/api_client.dart';
import 'package:crypto_swing_app/src/features/settings/settings_provider.dart';
import 'package:crypto_swing_app/src/ui/app_icons.dart';

class AnalystChatScreen extends ConsumerStatefulWidget {
  final Map<String, dynamic>? opportunityData;

  const AnalystChatScreen({Key? key, this.opportunityData}) : super(key: key);

  @override
  ConsumerState<AnalystChatScreen> createState() => _AnalystChatScreenState();
}

class _AnalystChatScreenState extends ConsumerState<AnalystChatScreen> {
  final TextEditingController _inputController = TextEditingController();
  final List<Map<String, String>> _messages = [];
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    final symbol = widget.opportunityData?["symbol"] ?? "SOL/USDT";
    final strategy = widget.opportunityData?["strategy"] ?? "PULLBACK";
    final score = widget.opportunityData?["score"] ?? 93;

    _messages.add({
      "sender": "bot",
      "text": "Olá! Sou seu Co-piloto Analista Inteligente.\n\n"
          "Estou acompanhando o Trade Plan de **$symbol** (Estratégia **$strategy**, Score **$score/100**).\n\n"
          "Pode me perguntar qualquer dúvida sobre o Stop Loss, alvos, risco ou momento do Bitcoin!"
    });
  }

  void _sendMessage(String text) async {
    if (text.trim().isEmpty) return;

    final currentIp = ref.read(serverIpProvider);
    ApiClient.setServerIp(currentIp);

    setState(() {
      _messages.add({"sender": "user", "text": text});
      _isLoading = true;
    });

    _inputController.clear();

    final result = await ApiClient.askAnalyst(
      question: text,
      opportunityContext: widget.opportunityData
    );

    if (!mounted) return;

    final replyText = result["reply"] as String? ?? 
        result["answer"] as String? ?? 
        "Entendido. Manter foco na estrutura de risco e metas parciais.";

    setState(() {
      _messages.add({"sender": "bot", "text": replyText});
      _isLoading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: _messages.length,
            itemBuilder: (context, index) {
              final msg = _messages[index];
              final isUser = msg["sender"] == "user";
              return Align(
                alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                child: Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(14),
                  constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.8),
                  decoration: BoxDecoration(
                    color: isUser ? AppTheme.accentBlue : AppTheme.darkCardSurface,
                    borderRadius: BorderRadius.only(
                      topLeft: const Radius.circular(14),
                      topRight: const Radius.circular(14),
                      bottomRight: isUser ? Radius.zero : const Radius.circular(14),
                      bottomLeft: !isUser ? Radius.zero : const Radius.circular(14),
                    ),
                    border: isUser ? null : Border.all(color: AppTheme.darkBorder),
                  ),
                  child: Text(
                    msg["text"]!,
                    style: TextStyle(
                      color: isUser ? Colors.white : AppTheme.textPrimary,
                      fontSize: 14,
                      height: 1.4,
                    ),
                  ),
                ),
              );
            },
          ),
        ),

        if (_isLoading)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.accentBlue),
            ),
          ),

        // Chips de Perguntas Rápidas
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          child: Row(
            children: [
              _quickChip("Por que entrar agora?"),
              _quickChip("Por que este Stop?"),
              _quickChip("Qual o Alvo T2?"),
              _quickChip("Situação do BTC?"),
            ],
          ),
        ),

        // Input Bar
        Container(
          padding: const EdgeInsets.all(12),
          decoration: const BoxDecoration(
            color: AppTheme.darkCardSurface,
            border: Border(top: BorderSide(color: AppTheme.darkBorder)),
          ),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _inputController,
                  style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
                  decoration: const InputDecoration(
                    hintText: "Pergunte ao Analista IA...",
                    hintStyle: TextStyle(color: AppTheme.textSecondary, fontSize: 14),
                    border: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    isDense: true,
                  ),
                  onSubmitted: _sendMessage,
                ),
              ),
              IconButton(
                icon: const AppIcon(AppIconType.send, color: AppTheme.accentBlue, size: 20),
                onPressed: () => _sendMessage(_inputController.text),
              ),
            ],
          ),
        )
      ],
    );
  }

  Widget _quickChip(String text) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ActionChip(
        backgroundColor: AppTheme.darkCardSurface,
        side: const BorderSide(color: AppTheme.darkBorder),
        label: Text(text, style: const TextStyle(fontSize: 12, color: AppTheme.accentBlue)),
        onPressed: () => _sendMessage(text),
      ),
    );
  }
}
