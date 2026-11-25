// Catálogo dos Parâmetros por Empresa (IAHub, módulo gestor de todas as
// aplicações — pedido do usuário, 2026-11-25). Cada parâmetro se explica na
// tela: o que faz, exemplos, opções possíveis e o que cada uma significa.
//
// Parâmetro novo entra AQUI (nunca no .env quando for por empresa). Campos:
//   chave        'grupo.secao.nome' (estável: é o que fica gravado)
//   grupo/secao  onde aparece na tela
//   titulo       nome curto
//   tipo         booleano | texto | numero | opcoes | segredo | emails
//   padrao       valor quando a empresa não informou
//   descricao    o que o parâmetro faz (frase completa)
//   exemplos     valores de exemplo (a tela deixa clicar para preencher)
//   opcoes       [{ valor, rotulo, significado }] (tipo opcoes; em numero, sugestões)
//   ajuda        passo a passo de "como obter" (lista de frases)
//   exigeQuando  chave booleana: só é obrigatório se ela estiver ligada
//   min/max      limites (numero) ou quantidade (emails)
//   validar      (valor) → mensagem de erro ou null
//   segredo      nunca volta para a tela; gravado cifrado

const GRUPOS = [
  {
    id: 'alertas',
    titulo: 'Alertas operacionais',
    icone: '🚨',
    descricao: 'Para onde vão os avisos de problema do IAHub (serviço de jobs parado, job falhando, WhatsApp desconectado) quando o WhatsApp não puder entregar. É o "plano B": se o próprio WhatsApp ou o site estiver fora, o aviso ainda chega.',
    secoes: [
      { id: 'reserva', titulo: 'Como a reserva funciona', descricao: 'Quando usar os canais de reserva e em que ordem.' },
      { id: 'email', titulo: 'E-mail', descricao: 'Envio por um servidor de e-mail (SMTP) da empresa. Recomendado como reserva principal: todo mundo lê e-mail.', teste: 'email' },
      { id: 'telegram', titulo: 'Telegram', descricao: 'Mensagem por um bot do Telegram. Opcional, para quem acompanha o Telegram.', teste: 'telegram' },
    ],
  },
];

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

const PARAMETROS = [
  // ── Reserva ────────────────────────────────────────────────────────────
  {
    chave: 'alertas.reserva.quando', grupo: 'alertas', secao: 'reserva', titulo: 'Quando usar a reserva', tipo: 'opcoes', padrao: 'falha_whatsapp',
    descricao: 'Define se o e-mail/Telegram entram só como plano B ou também junto com o WhatsApp.',
    opcoes: [
      { valor: 'falha_whatsapp', rotulo: 'Só quando o WhatsApp falhar', significado: 'O normal. O aviso vai pelo WhatsApp; e-mail/Telegram só são usados se o WhatsApp não entregar (canal desconectado, site fora do ar, grupo sem número). Evita mensagem repetida.' },
      { valor: 'sempre', rotulo: 'Sempre, junto com o WhatsApp', significado: 'Todo alerta vai também por e-mail/Telegram, mesmo com o WhatsApp funcionando. Útil para quem quer histórico dos alertas na caixa de e-mail.' },
      { valor: 'nunca', rotulo: 'Nunca', significado: 'Desliga a reserva desta empresa. Se o WhatsApp falhar, o alerta fica só na tela Jobs e no log do servidor.' },
    ],
  },
  {
    chave: 'alertas.reserva.ordem', grupo: 'alertas', secao: 'reserva', titulo: 'Ordem dos canais de reserva', tipo: 'opcoes', padrao: 'email_telegram',
    descricao: 'Em que ordem tentar os canais de reserva ligados abaixo.',
    opcoes: [
      { valor: 'email_telegram', rotulo: 'E-mail, depois Telegram', significado: 'Tenta o e-mail; só manda pelo Telegram se o e-mail falhar.' },
      { valor: 'telegram_email', rotulo: 'Telegram, depois e-mail', significado: 'Tenta o Telegram; só manda e-mail se o Telegram falhar.' },
      { valor: 'todos', rotulo: 'Os dois sempre', significado: 'Manda pelos dois canais ligados ao mesmo tempo (maior chance de alguém ver, com aviso duplicado).' },
    ],
  },

  // ── E-mail ─────────────────────────────────────────────────────────────
  {
    chave: 'alertas.email.ativo', grupo: 'alertas', secao: 'email', titulo: 'Usar e-mail', tipo: 'booleano', padrao: false,
    descricao: 'Liga o envio de alertas por e-mail para esta empresa. Desligado, os campos abaixo ficam guardados, mas não são usados.',
  },
  {
    chave: 'alertas.email.smtp_host', grupo: 'alertas', secao: 'email', titulo: 'Servidor SMTP', tipo: 'texto', padrao: '', exigeQuando: 'alertas.email.ativo',
    descricao: 'Endereço do servidor que envia os e-mails da empresa (o mesmo que um programa de e-mail usaria para enviar).',
    exemplos: ['smtp.gmail.com', 'smtp.office365.com', 'smtp.hostinger.com', 'mail.suaempresa.com.br'],
    ajuda: [
      'Gmail / Google Workspace: smtp.gmail.com.',
      'Microsoft 365 / Outlook: smtp.office365.com.',
      'Hospedagem própria: veja no painel da hospedagem (costuma ser mail.seudominio ou smtp.seudominio).',
    ],
    validar: (v) => (HOST_RE.test(v) ? null : 'Informe só o endereço do servidor, sem "http://" e sem porta (ex.: smtp.gmail.com).'),
  },
  {
    chave: 'alertas.email.smtp_porta', grupo: 'alertas', secao: 'email', titulo: 'Porta', tipo: 'numero', padrao: 587, min: 1, max: 65535, exigeQuando: 'alertas.email.ativo',
    descricao: 'Porta do servidor SMTP. Tem que combinar com a "Segurança da conexão" logo abaixo.',
    opcoes: [
      { valor: 587, rotulo: '587', significado: 'Padrão atual (STARTTLS). Use com Segurança = STARTTLS. Gmail e Microsoft 365 aceitam.' },
      { valor: 465, rotulo: '465', significado: 'SSL/TLS direto. Use com Segurança = SSL/TLS. Comum em hospedagens.' },
      { valor: 25, rotulo: '25', significado: 'Sem criptografia, normalmente só dentro da rede da empresa. Muitos provedores bloqueiam.' },
    ],
  },
  {
    chave: 'alertas.email.seguranca', grupo: 'alertas', secao: 'email', titulo: 'Segurança da conexão', tipo: 'opcoes', padrao: 'starttls', exigeQuando: 'alertas.email.ativo',
    descricao: 'Como a conexão com o servidor de e-mail é protegida.',
    opcoes: [
      { valor: 'starttls', rotulo: 'STARTTLS', significado: 'Conecta e depois liga a criptografia (porta 587). O mais comum hoje.' },
      { valor: 'ssl', rotulo: 'SSL/TLS', significado: 'Já conecta criptografado (porta 465).' },
      { valor: 'nenhuma', rotulo: 'Nenhuma', significado: 'Sem criptografia (porta 25). Só use em servidor interno da empresa: a senha trafega aberta.' },
    ],
  },
  {
    chave: 'alertas.email.usuario', grupo: 'alertas', secao: 'email', titulo: 'Usuário', tipo: 'texto', padrao: '', exigeQuando: 'alertas.email.ativo',
    descricao: 'Conta que faz login no servidor de e-mail para enviar. Normalmente é o próprio endereço de e-mail.',
    exemplos: ['alertas@suaempresa.com.br'],
  },
  {
    chave: 'alertas.email.senha', grupo: 'alertas', secao: 'email', titulo: 'Senha', tipo: 'segredo', padrao: '', exigeQuando: 'alertas.email.ativo',
    descricao: 'Senha da conta acima. Fica gravada cifrada e nunca volta para a tela — para trocar, digite a nova; em branco mantém a atual.',
    ajuda: [
      'Gmail / Google Workspace: use uma "senha de app" (a senha normal não funciona). Conta Google › Segurança › Verificação em duas etapas (ligada) › Senhas de app › gere uma para "E-mail" e cole aqui (16 letras, sem espaços).',
      'Microsoft 365: a conta precisa ter "SMTP autenticado" liberado pelo administrador do 365 (Centro de administração › Usuários › a conta › E-mail › Gerenciar aplicativos de e-mail › SMTP autenticado).',
      'Prefira uma conta só para alertas, não a de uma pessoa.',
    ],
  },
  {
    chave: 'alertas.email.remetente', grupo: 'alertas', secao: 'email', titulo: 'Remetente (De)', tipo: 'texto', padrao: '',
    descricao: 'Nome e endereço que aparecem como quem enviou. Em branco, usa o Usuário. Gmail e Microsoft 365 só aceitam o próprio endereço da conta (ou um alias dela).',
    exemplos: ['IAHub Alertas <alertas@suaempresa.com.br>', 'alertas@suaempresa.com.br'],
    validar: (v) => {
      const end = (String(v).match(/<([^>]+)>/) || [null, String(v)])[1].trim();
      return EMAIL_RE.test(end) ? null : 'Use "Nome <email@dominio>" ou só o e-mail.';
    },
  },
  {
    chave: 'alertas.email.destinatarios', grupo: 'alertas', secao: 'email', titulo: 'Destinatários', tipo: 'emails', padrao: [], max: 20, exigeQuando: 'alertas.email.ativo',
    descricao: 'Quem recebe os alertas. Um ou mais e-mails separados por vírgula ou um por linha (até 20). Dica: uma lista de distribuição (ex.: ti@) evita trocar aqui quando a equipe muda.',
    exemplos: ['ti@suaempresa.com.br', 'ti@suaempresa.com.br, plantao@suaempresa.com.br'],
  },

  // ── Telegram ───────────────────────────────────────────────────────────
  {
    chave: 'alertas.telegram.ativo', grupo: 'alertas', secao: 'telegram', titulo: 'Usar Telegram', tipo: 'booleano', padrao: false,
    descricao: 'Liga o envio de alertas por Telegram para esta empresa.',
  },
  {
    chave: 'alertas.telegram.token', grupo: 'alertas', secao: 'telegram', titulo: 'Token do bot', tipo: 'segredo', padrao: '', exigeQuando: 'alertas.telegram.ativo',
    descricao: 'Chave do bot que envia as mensagens. Fica gravada cifrada; em branco mantém a atual.',
    exemplos: ['123456789:AAHk-exemploDoTokenDoBot_1234567890'],
    ajuda: [
      'No Telegram, abra uma conversa com @BotFather.',
      'Envie /newbot, escolha um nome (ex.: "IAHub Alertas Empresa X") e um usuário terminado em "bot".',
      'O BotFather responde com o token (números, dois-pontos e letras). Copie e cole aqui.',
    ],
    validar: (v) => (/^\d{5,}:[\w-]{30,}$/.test(v) ? null : 'Token no formato números:letras (ex.: 123456789:AAH...).'),
  },
  {
    chave: 'alertas.telegram.chat_id', grupo: 'alertas', secao: 'telegram', titulo: 'Chat que recebe', tipo: 'texto', padrao: '', exigeQuando: 'alertas.telegram.ativo',
    descricao: 'Pessoa ou grupo do Telegram que recebe os alertas, pelo número do chat.',
    exemplos: ['123456789', '-1001234567890'],
    opcoes: [
      { valor: '123456789', rotulo: 'Número positivo', significado: 'Uma pessoa. Ela precisa ter mandado ao menos uma mensagem para o bot antes.' },
      { valor: '-1001234567890', rotulo: 'Número negativo', significado: 'Um grupo ou canal. Adicione o bot ao grupo antes (em canal, como administrador).' },
    ],
    ajuda: [
      'Mande qualquer mensagem para o bot (ou adicione o bot ao grupo e escreva algo no grupo).',
      'Abra no navegador: https://api.telegram.org/bot<TOKEN>/getUpdates (troque <TOKEN> pelo token do bot).',
      'Procure "chat":{"id": ... } — esse número (com o sinal de menos, se tiver) é o chat.',
    ],
    validar: (v) => (/^-?\d{3,20}$/.test(v) ? null : 'Só números (com "-" na frente para grupos).'),
  },
];

const _porChave = new Map(PARAMETROS.map(p => [p.chave, p]));

function definicao(chave) {
  return _porChave.get(chave) || null;
}

module.exports = { GRUPOS, PARAMETROS, definicao, EMAIL_RE };
