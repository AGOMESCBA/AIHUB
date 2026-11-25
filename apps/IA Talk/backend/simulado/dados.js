'use strict';

// Dados de exemplo do servidor simulado. Tudo inventado: empresas fictícias,
// números falsos (sempre mascarados), nenhum dado real de cliente.
// Determinístico (sem Math.random) para as capturas de tela saírem iguais.

const DIA = 24 * 60 * 60 * 1000;
const BASE = Date.parse('2026-11-25T14:00:00.000Z');
const em = (msAtras) => new Date(BASE - msAtras).toISOString();

function mascararTelefone(digitos) {
  const d = String(digitos).replace(/\D/g, '');
  if (d.length < 12) return '••••';
  return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 5)}••••-${d.slice(-4)}`;
}

// Papéis e rotinas: catálogo único do servidor real (backend/acesso/papeis.js).
const { ROTINAS, PAPEIS } = require('../acesso/papeis');

const LOGO_J2A = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#4f46e5"/><text x="20" y="26" font-family="Segoe UI,sans-serif" font-size="15" font-weight="700" fill="#fff" text-anchor="middle">J2A</text></svg>');

function criarDados() {
  const empresas = [
    { id: 'emp_j2a', nome: 'J2A Consultoria', documento: '00.000.000/0001-00', apelido: 'j2a', logo_url: LOGO_J2A, situacao: 'ativa',
      vinculo_hub: { empresa_hub_id: 1, nome: 'J2A Consultoria' }, criado_em: em(90 * DIA), atualizado_em: em(3 * DIA) },
    { id: 'emp_plantivo', nome: 'Plantivo Agro (exemplo)', documento: '11.111.111/0001-11', apelido: 'plantivo', logo_url: null, situacao: 'ativa',
      vinculo_hub: { empresa_hub_id: 7, nome: 'Plantivo' }, criado_em: em(60 * DIA), atualizado_em: em(10 * DIA) },
    { id: 'emp_horizonte', nome: 'Construtora Horizonte (exemplo)', documento: '22.222.222/0001-22', apelido: 'horizonte', logo_url: null, situacao: 'ativa',
      vinculo_hub: null, criado_em: em(20 * DIA), atualizado_em: em(20 * DIA) },
    { id: 'emp_antiga', nome: 'Distribuidora Sol (exemplo)', documento: null, apelido: 'sol', logo_url: null, situacao: 'inativa',
      vinculo_hub: null, criado_em: em(200 * DIA), atualizado_em: em(45 * DIA) },
  ];

  const usuarios = [
    { id: 'usr_ana', nome: 'Ana Ribeiro', telefone: '5565999990001', email: 'ana@exemplo.com.br', papel: 'admin_empresa', situacao: 'ativo', ultimo_acesso_em: em(2 * 60 * 60 * 1000), criado_em: em(80 * DIA) },
    { id: 'usr_bruno', nome: 'Bruno Lima', telefone: '5565999990002', email: 'bruno@exemplo.com.br', papel: 'supervisor', situacao: 'ativo', ultimo_acesso_em: em(DIA), criado_em: em(50 * DIA) },
    { id: 'usr_carla', nome: 'Carla Souza', telefone: '5565999990003', email: null, papel: 'atendente', situacao: 'ativo', ultimo_acesso_em: null, criado_em: em(5 * DIA) },
    { id: 'usr_davi', nome: 'Davi Martins', telefone: '5565999990004', email: 'davi@exemplo.com.br', papel: 'auditor', situacao: 'inativo', ultimo_acesso_em: em(40 * DIA), criado_em: em(70 * DIA) },
  ];

  const sitesAutorizados = { origens: ['https://softexpert.exemplo.com.br'], versao: 3, atualizado_em: em(7 * DIA) };

  const emailEnvio = {
    tipo: 'smtp', email: 'nao-responda@exemplo.com.br', senha_configurada: true, smtp_host: 'smtp.exemplo.com.br', smtp_porta: 465,
    smtp_seguro: true, remetente_nome: 'J2A Consultoria', situacao: 'testado', atualizado_em: em(12 * DIA),
  };

  const tokens = (app, n) => Array.from({ length: n }, (_, i) => ({
    id: `tok_${app}_${i + 1}`, prefixo: `tk_${app.slice(0, 4)}${i + 1}`, criado_em: em((30 - i * 10) * DIA),
    ultimo_uso_em: i === 0 ? em(10 * 60 * 1000) : null, revogado_em: i === 1 ? em(15 * DIA) : null,
  }));

  const aplicacoes = [
    { id: 'app_iacommand', nome: 'IA Command', descricao: 'Respostas e relatórios do assistente do ERP.', situacao: 'ativa',
      escopos: ['mensagens:enviar', 'mensagens:ler', 'eventos:ler'], canais_autorizados: ['cn_suporte'],
      webhook: { url: 'http://127.0.0.1:3000/api/ia-command/talk/eventos', ativo: true, segredo_configurado: true }, tokens: tokens('iacommand', 2), criado_em: em(30 * DIA) },
    { id: 'app_iaservice', nome: 'IA Service', descricao: 'Código de login do J2iA e avisos da Jaade.', situacao: 'ativa',
      escopos: ['mensagens:enviar'], canais_autorizados: ['cn_suporte'], webhook: { url: null, ativo: false, segredo_configurado: false }, tokens: tokens('iaservice', 1), criado_em: em(25 * DIA) },
    { id: 'app_jobs', nome: 'IAHub-Jobs', descricao: 'Alertas operacionais dos jobs.', situacao: 'inativa',
      escopos: ['mensagens:enviar'], canais_autorizados: [], webhook: { url: null, ativo: false, segredo_configurado: false }, tokens: [], criado_em: em(8 * DIA) },
  ];

  const capacidadesWweb = {
    texto: true, formatacao: 'whatsapp', imagem: true, documento: true, audio: true, video: false, grupos: true,
    modelos: false, janela_24h: false, recibos: { enviada: true, entregue: true, lida: true }, qr: true,
    max_midia_bytes: 16 * 1024 * 1024, mimes_aceitos: ['image/png', 'image/jpeg', 'application/pdf'],
  };

  const vinculo = (id, nome, padrao) => ({ id, nome, padrao });
  const canais = [
    { id: 'cn_suporte', nome: 'Suporte J2A', numero: '5565999900001', provedor: 'wweb', estado: 'conectado', estado_desde: em(3 * DIA),
      empresa_dona: { id: 'emp_j2a', nome: 'J2A Consultoria' },
      empresas_vinculadas: [vinculo('emp_j2a', 'J2A Consultoria', true), vinculo('emp_plantivo', 'Plantivo Agro (exemplo)', true), vinculo('emp_horizonte', 'Construtora Horizonte (exemplo)', true)],
      capacidades: capacidadesWweb, fila_pendente: 0, ultima_mensagem_em: em(4 * 60 * 1000) },
    { id: 'cn_financeiro', nome: 'Financeiro', numero: '5565999900002', provedor: 'wweb', estado: 'reconectando', estado_desde: em(6 * 60 * 1000),
      empresa_dona: { id: 'emp_j2a', nome: 'J2A Consultoria' }, empresas_vinculadas: [vinculo('emp_j2a', 'J2A Consultoria', false)],
      capacidades: capacidadesWweb, fila_pendente: 12, ultima_mensagem_em: em(40 * 60 * 1000) },
    { id: 'cn_teste', nome: 'Teste homologação', numero: '5565999900003', provedor: 'wweb', estado: 'qr_pendente', estado_desde: em(90 * 1000),
      empresa_dona: { id: 'emp_j2a', nome: 'J2A Consultoria' }, empresas_vinculadas: [vinculo('emp_j2a', 'J2A Consultoria', false)],
      capacidades: capacidadesWweb, fila_pendente: 0, ultima_mensagem_em: null },
  ];

  const ESTADOS_ROTACAO = ['lida', 'entregue', 'lida', 'enviada', 'lida', 'aguardando', 'lida', 'falhou', 'lida', 'desconhecida', 'entregue', 'lida'];
  const PREVIAS = ['Seu código de acesso ao J2iA é ••••••', '📎 vendas-novembro.pdf', 'Faturamento do dia: R$ ••••', 'Alerta: job "Sincronizar SX3" falhou 3 vezes',
    'Bom dia! Segue o relatório solicitado.', '🖼 grafico-contas-a-pagar.png', 'PA Respondido: 4 chamados', 'Pedido de compra aprovado.'];
  const appsRot = [aplicacoes[0], aplicacoes[1], aplicacoes[0], null];
  const mensagens = Array.from({ length: 64 }, (_, i) => {
    const entrada = i % 5 === 3;
    const app = entrada ? null : appsRot[i % appsRot.length];
    const canal = i % 7 === 6 ? canais[1] : canais[0];
    const estado = entrada ? 'recebida' : ESTADOS_ROTACAO[i % ESTADOS_ROTACAO.length];
    const tipo = PREVIAS[i % PREVIAS.length].startsWith('📎') ? 'documento' : PREVIAS[i % PREVIAS.length].startsWith('🖼') ? 'imagem' : 'texto';
    const criada = em(i * 23 * 60 * 1000 + 60 * 1000);
    const historico = entrada ? [{ estado: 'recebida', em: criada, detalhe: null }]
      : ['aceita', 'encaminhada', ...(estado === 'aguardando' ? ['aguardando'] : estado === 'falhou' ? ['falhou'] : estado === 'desconhecida' ? ['desconhecida']
        : ['enviada', ...(['entregue', 'lida'].includes(estado) ? ['entregue'] : []), ...(estado === 'lida' ? ['lida'] : [])])]
        .map((e, k) => ({ estado: e, em: new Date(Date.parse(criada) + k * 900).toISOString(),
          detalhe: e === 'falhou' ? 'Número não encontrado no WhatsApp.' : e === 'desconhecida' ? 'O canal caiu antes de confirmar o envio.' : null }));
    return {
      id: `msg_ex${String(i + 1).padStart(3, '0')}`,
      direcao: entrada ? 'entrada' : 'saida',
      canal: { id: canal.id, nome: canal.nome },
      aplicacao: app ? { id: app.id, nome: app.nome } : null,
      contato_mascarado: mascararTelefone(`55659999${String(1000 + (i % 9)).padStart(4, '0')}${i % 10}`),
      tipo,
      previa: entrada ? 'Oi, preciso da segunda via do boleto' : PREVIAS[i % PREVIAS.length],
      estado,
      correlacao_id: app ? `chamado-${36900 + i}` : null,
      criada_em: criada,
      atualizada_em: historico[historico.length - 1].em,
      historico_estados: historico,
      metadados: app ? { origem: app.nome.toLowerCase().replace(/\s+/g, '-') } : {},
      anexos: tipo === 'texto' ? [] : [{ id: `anx_ex${i}`, nome: tipo === 'documento' ? 'vendas-novembro.pdf' : 'grafico.png', mime: tipo === 'documento' ? 'application/pdf' : 'image/png', tamanho: 184_320 }],
    };
  });

  const SIT_ENTREGA = ['entregue', 'entregue', 'pendente', 'falhando', 'entregue', 'esgotado'];
  const TIPOS_EVT = ['mensagem.recebida', 'mensagem.estado_alterado', 'mensagem.estado_alterado', 'canal.estado_alterado'];
  const eventos = Array.from({ length: 24 }, (_, i) => {
    const situacao = SIT_ENTREGA[i % SIT_ENTREGA.length];
    return {
      id: `evt_ex${String(i + 1).padStart(3, '0')}`,
      tipo: TIPOS_EVT[i % TIPOS_EVT.length],
      em: em(i * 41 * 60 * 1000),
      aplicacao: { id: 'app_iacommand', nome: 'IA Command' },
      entrega: {
        situacao,
        tentativas: situacao === 'entregue' ? 1 : situacao === 'esgotado' ? 9 : 3,
        proxima_tentativa_em: ['pendente', 'falhando'].includes(situacao) ? new Date(BASE + 10 * 60 * 1000).toISOString() : null,
        ultimo_status_http: situacao === 'entregue' ? 200 : situacao === 'pendente' ? null : 503,
      },
    };
  });

  const ACOES = [['login', 'Entrou pelo link j2a'], ['canal.reconectar', 'Pediu reconexão do canal Financeiro'], ['aplicacao.token_gerado', 'Gerou token tk_iaco1 para IA Command'],
    ['usuario.criado', 'Cadastrou Carla Souza como atendente'], ['sites_autorizados.alterado', 'Alterou a lista de sites autorizados'], ['email_envio.testado', 'Testou o e-mail de envio']];
  const auditoria = Array.from({ length: 18 }, (_, i) => {
    const [acao, resumo] = ACOES[i % ACOES.length];
    const u = usuarios[i % 2];
    return { id: `aud_ex${String(i + 1).padStart(3, '0')}`, em: em(i * 3 * 60 * 60 * 1000), usuario: { id: u.id, nome: u.nome }, aplicacao: null,
      acao, alvo_tipo: acao.split('.')[0], alvo_id: null, resumo, ip_mascarado: '189.40.•••.•••' };
  });

  const logCanal = {
    cn_suporte: [
      { em: em(10 * 60 * 1000), tipo: 'system', mensagem: 'Canal conectado.' },
      { em: em(4 * 60 * 1000), tipo: 'received', mensagem: 'Mensagem recebida de +55 65 9••••-0003' },
      { em: em(3 * 60 * 1000), tipo: 'sent', mensagem: 'Mensagem msg_ex001 enviada (IA Service).' },
    ],
    cn_financeiro: [
      { em: em(7 * 60 * 1000), tipo: 'warning', mensagem: 'Conexão perdida com o WhatsApp.' },
      { em: em(6 * 60 * 1000), tipo: 'info', mensagem: 'Tentando reconectar (1/5)...' },
    ],
    cn_teste: [{ em: em(90 * 1000), tipo: 'info', mensagem: 'Aguardando leitura do QR Code.' }],
  };

  return { empresas, usuarios, papeis: PAPEIS, sitesAutorizados, emailEnvio, aplicacoes, canais, mensagens, eventos, auditoria, logCanal };
}

module.exports = { criarDados, mascararTelefone, ROTINAS, PAPEIS, BASE_SIMULADA: BASE };
