// IA Talk · Etapa A0 — Dados fictícios da Central de Atendimento (Fase 2).
// Protótipo puramente visual/interativo. Nenhum dado real de cliente;
// todos os telefones são fictícios e sempre mascarados (+55 65 9••••-0000).
(function () {
  const SETORES = [
    { id: 'suporte', nome: 'Suporte', icone: '🛠️' },
    { id: 'financeiro', nome: 'Financeiro', icone: '💳' },
    { id: 'comercial', nome: 'Comercial', icone: '🤝' },
  ];

  const VISOES = [
    { id: 'minhas', nome: 'Minhas conversas' },
    { id: 'sem_dono', nome: 'Sem dono' },
    { id: 'todas', nome: 'Todas abertas' },
    { id: 'encerradas', nome: 'Encerradas' },
  ];

  const ATENDENTES = [
    { id: 'usr_carla', nome: 'Carla Souza (você)', setor: 'suporte' },
    { id: 'usr_bruno', nome: 'Bruno Lima', setor: 'suporte' },
    { id: 'usr_ana', nome: 'Ana Ribeiro', setor: 'financeiro' },
    { id: 'usr_rafael', nome: 'Rafael Mendes', setor: 'comercial' },
  ];

  const CANAIS = {
    cn_suporte: { id: 'cn_suporte', nome: 'Suporte J2A', numero_mascarado: '+55 65 9••••-0001', estado: 'conectado' },
    cn_financeiro: { id: 'cn_financeiro', nome: 'Financeiro', numero_mascarado: '+55 65 9••••-0002', estado: 'desconectado' },
  };

  const RESPOSTAS_RAPIDAS = [
    {
      atalho: '/saudacao',
      titulo: 'Saudação inicial',
      texto: 'Olá! Aqui é a Carla da equipe J2A. Já estou verificando o seu chamado e retorno em instantes.',
    },
    {
      atalho: '/boleto',
      titulo: 'Segunda via de boleto',
      texto: 'Segue a orientação para a 2ª via: já solicitei a emissão atualizada ao financeiro e envio o PDF por aqui em até 10 minutos.',
    },
    {
      atalho: '/prazo',
      titulo: 'Prazo de atendimento',
      texto: 'Registrei sua solicitação com prioridade. Nosso prazo de retorno técnico é de até 2 horas úteis.',
    },
    {
      atalho: '/acesso',
      titulo: 'Acesso ao portal',
      texto: 'Para entrar no portal, acesse o link da empresa, informe seu celular com DDD e digite o código de 6 dígitos enviado pelo WhatsApp.',
    },
    {
      atalho: '/encerrar',
      titulo: 'Encerramento cordial',
      texto: 'Fico à disposição se precisar de mais alguma ajuda! Vou encerrar este atendimento agora. Tenha um ótimo dia.',
    },
  ];

  function criarConversasIniciais() {
    return [
      {
        id: 'conv_01',
        cliente: 'Mariana Oliveira',
        empresa_cliente: 'Alvorada Sementes (exemplo)',
        telefone_mascarado: '+55 65 9••••-1042',
        email: 'mariana@alvorada.exemplo.com.br',
        setor_id: 'suporte',
        canal_id: 'cn_suporte',
        atendente_id: 'usr_carla',
        situacao: 'aberta',
        nao_lidas: 2,
        atualizada_em: '09:48',
        etiquetas: ['ERP Protheus', 'Prioridade'],
        historico_anterior: [
          { protocolo: '#36841', data: '19/11/2026', assunto: 'Ajuste de permissão de relatório' },
          { protocolo: '#36702', data: '04/11/2026', assunto: 'Dúvida sobre emissão de NF-e' },
        ],
        resumo_ia: 'Cliente relata demora na geração do relatório de faturamento mensal desde hoje cedo. Equipe já checou a fila do ERP e aguarda confirmação do período selecionado para validar o índice.',
        sugestao_ia: 'Olá, Mariana! Conferimos o relatório aqui e identificamos uma lentidão pontual no filtro de 90 dias. Pode confirmar se o período selecionado foi novembro/2026 para aplicarmos o ajuste agora?',
        mensagens: [
          { id: 'm1', autor: 'cliente', nome: 'Mariana Oliveira', hora: '09:32', texto: 'Bom dia! O relatório de faturamento mensal está demorando muito para abrir hoje.' },
          { id: 'm2', autor: 'atendente', nome: 'Carla Souza', hora: '09:35', status: 'lida', texto: 'Bom dia, Mariana! Vou verificar agora mesmo o processamento aqui no servidor.' },
          { id: 'm3', autor: 'nota', nome: 'Bruno Lima', hora: '09:41', texto: 'Olhei o monitor de jobs: houve pico de consulta às 09:20, mas já normalizou. Vale confirmar qual período ela filtrou.' },
          { id: 'm4', autor: 'cliente', nome: 'Mariana Oliveira', hora: '09:46', texto: 'Tentei de novo agora e ainda ficou carregando uns 2 minutos.' },
          { id: 'm5', autor: 'cliente', nome: 'Mariana Oliveira', hora: '09:48', texto: 'Vocês conseguem priorizar? Preciso fechar a diretoria antes das 11h.' },
        ],
      },
      {
        id: 'conv_02',
        cliente: 'Lucas Ferreira',
        empresa_cliente: 'Construtora Horizonte (exemplo)',
        telefone_mascarado: '+55 65 9••••-2088',
        email: 'financeiro@horizonte.exemplo.com.br',
        setor_id: 'financeiro',
        canal_id: 'cn_financeiro',
        atendente_id: 'usr_ana',
        situacao: 'aberta',
        nao_lidas: 1,
        atualizada_em: '09:21',
        etiquetas: ['Boleto', 'Recorrente'],
        historico_anterior: [
          { protocolo: '#36610', data: '25/10/2026', assunto: 'Atualização de e-mail para cobrança' },
        ],
        resumo_ia: 'Cliente solicitou a segunda via do boleto referente à mensalidade de novembro com vencimento dia 30/11. Canal Financeiro está desconectado no momento.',
        sugestao_ia: 'Olá, Lucas! Já localizei a parcela de novembro (vencimento 30/11). Assim que o canal reconectar, envio o PDF do boleto atualizado por aqui.',
        mensagens: [
          { id: 'm21', autor: 'cliente', nome: 'Lucas Ferreira', hora: '09:18', texto: 'Oi, preciso da segunda via do boleto de novembro com vencimento dia 30.' },
          { id: 'm22', autor: 'nota', nome: 'Ana Ribeiro', hora: '09:20', texto: 'Boleto emitido no ERP (nosso número finalizado em 8841). Aguardando canal Financeiro reconectar para enviar o PDF.' },
          { id: 'm23', autor: 'cliente', nome: 'Lucas Ferreira', hora: '09:21', texto: 'Conseguem mandar em PDF por aqui mesmo?' },
        ],
      },
      {
        id: 'conv_03',
        cliente: 'Patrícia Nogueira',
        empresa_cliente: 'Distribuidora Cerrado (exemplo)',
        telefone_mascarado: '+55 65 9••••-3195',
        email: 'patricia@cerrado.exemplo.com.br',
        setor_id: 'suporte',
        canal_id: 'cn_suporte',
        atendente_id: null,
        situacao: 'aberta',
        nao_lidas: 1,
        atualizada_em: '09:05',
        etiquetas: ['Novo acesso', 'Sem dono'],
        historico_anterior: [],
        resumo_ia: 'Solicitação de liberação de acesso ao IA Talk para novo supervisor da filial de Rondonópolis. Conversa ainda sem atendente atribuído.',
        sugestao_ia: 'Olá, Patrícia! Podemos cadastrar o novo supervisor agora mesmo. Por favor, informe o nome completo, e-mail e celular com DDD para enviarmos o acesso.',
        mensagens: [
          { id: 'm31', autor: 'cliente', nome: 'Patrícia Nogueira', hora: '09:05', texto: 'Olá! Precisamos liberar o acesso de um novo supervisor da filial para acompanhar os avisos.' },
        ],
      },
      {
        id: 'conv_04',
        cliente: 'Eduardo Campos',
        empresa_cliente: 'Agro Norte Sul (exemplo)',
        telefone_mascarado: '+55 65 9••••-4410',
        email: 'eduardo@agronortesul.exemplo.com.br',
        setor_id: 'comercial',
        canal_id: 'cn_suporte',
        atendente_id: 'usr_rafael',
        situacao: 'aberta',
        nao_lidas: 0,
        atualizada_em: 'Ontem',
        etiquetas: ['Proposta', 'WhatsApp Oficial'],
        historico_anterior: [
          { protocolo: '#36550', data: '12/11/2026', assunto: 'Apresentação IA Talk + IA Command' },
        ],
        resumo_ia: 'Cliente avalia proposta de ativação do IA Talk para 3 filiais e perguntou se poderá usar número oficial da Meta depois.',
        sugestao_ia: 'Olá, Eduardo! Sim, a arquitetura já nasce preparada para conviver com WhatsApp Web e API oficial da Meta no mesmo painel, sem trocar a integração.',
        mensagens: [
          { id: 'm41', autor: 'cliente', nome: 'Eduardo Campos', hora: 'Ontem, 16:12', texto: 'Se começarmos agora no WhatsApp Web, depois dá para migrar um número para a API oficial da Meta?' },
          { id: 'm42', autor: 'atendente', nome: 'Rafael Mendes', hora: 'Ontem, 16:19', status: 'entregue', texto: 'Sim, Eduardo! Os canais funcionam sob o mesmo contrato e vocês podem ativar a Meta quando quiserem.' },
        ],
      },
      {
        id: 'conv_05',
        cliente: 'Fernanda Costa',
        empresa_cliente: 'Transportadora Vale (exemplo)',
        telefone_mascarado: '+55 65 9••••-5529',
        email: 'fernanda@vale.exemplo.com.br',
        setor_id: 'suporte',
        canal_id: 'cn_suporte',
        atendente_id: 'usr_carla',
        situacao: 'encerrada',
        nao_lidas: 0,
        atualizada_em: 'Ontem',
        etiquetas: ['Resolvido'],
        historico_anterior: [
          { protocolo: '#36412', data: '01/11/2026', assunto: 'Configuração de e-mail reserva' },
        ],
        resumo_ia: 'Dúvida sobre recebimento do código de 6 dígitos por e-mail reserva solucionada com sucesso; atendimento encerrado.',
        sugestao_ia: 'Olá, Fernanda! Caso precise reabrir este assunto ou testar novamente o e-mail reserva, é só responder por aqui.',
        mensagens: [
          { id: 'm51', autor: 'cliente', nome: 'Fernanda Costa', hora: 'Ontem, 11:02', texto: 'Testamos o e-mail reserva e chegou certinho em menos de 10 segundos.' },
          { id: 'm52', autor: 'atendente', nome: 'Carla Souza', hora: 'Ontem, 11:04', status: 'lida', texto: 'Excelente, Fernanda! Qualquer dúvida estamos à disposição.' },
        ],
      },
    ];
  }

  function melhorarTextoSimulado(rascunho) {
    const limpo = String(rascunho || '').trim();
    if (!limpo) {
      return 'Olá! Agradecemos o seu contato. Já estamos analisando a sua solicitação com prioridade e retornaremos em breve com a confirmação.';
    }
    const base = limpo.replace(/\s+/g, ' ').replace(/^[a-zà-ú]/, (c) => c.toUpperCase());
    const comPonto = /[.!?]$/.test(base) ? base : `${base}.`;
    return `Olá! ${comPonto} Permanecemos à disposição caso precise de qualquer informação adicional.`;
  }

  window.CentralDados = {
    SETORES,
    VISOES,
    ATENDENTES,
    CANAIS,
    RESPOSTAS_RAPIDAS,
    criarConversasIniciais,
    melhorarTextoSimulado,
  };
})();
