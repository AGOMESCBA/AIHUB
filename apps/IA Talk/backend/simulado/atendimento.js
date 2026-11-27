'use strict';

// C8 — Atendimento (Fase 2) no servidor simulado: setores, conversas, contatos,
// respostas rápidas e o socket da Central. Contrato: docs/contratos.md §8.
// Dados inventados e determinísticos; só a J2A (emp_j2a) tem atendimento.
//
// Cenário extra: ?simular=atendente (ou X-Talk-Simular: atendente) responde como
// Carla Souza, atendente do Suporte — para a tela ver o que um atendente vê.
// Rota só do simulado: POST /simulado/receber { contato_id?, texto? } simula uma
// mensagem chegando do WhatsApp (o servidor real faz isso na C9).

const config = require('../config');
const { erro } = require('../erros');
const { EVENTOS_SOCKET, USOS_CANAL, VISOES_CONVERSA } = require('../contratos');
const { ROTINAS } = require('../acesso/papeis');
const { mascararTelefone, BASE_SIMULADA } = require('./dados');

const MIN = 60 * 1000;
const DIA = 24 * 60 * MIN;
const em = (msAtras) => new Date(BASE_SIMULADA - msAtras).toISOString();
const S = EVENTOS_SOCKET.servidor;
const C = EVENTOS_SOCKET.cliente;

const LIMITE_TEXTO = 4096;
// Aplicação do sistema de origem no simulado (qualquer token tk_teste_ fala por ela na API v1).
const APLICACAO_ORIGEM = Object.freeze({ id: 'app_origem', nome: 'SoftExpert (simulado)' });
const LIMITE_NOTA = 2000;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const ATALHO = /^\/[a-z0-9-]{2,30}$/;
const CODIGO_SETOR = /^[a-z0-9-]{2,30}$/;
const SISTEMA_ORIGEM = /^[a-z0-9-]{2,30}$/;
const codigoDoNome = (nome) => String(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

// Mensagens do contato depois da última resposta (as que ainda esperam alguém).
function entradasSemResposta(itens) {
  const lista = [];
  for (let k = itens.length - 1; k >= 0; k--) {
    const it = itens[k];
    if (it.categoria !== 'mensagem') continue;
    if (it.direcao === 'saida') break;
    lista.unshift(it);
  }
  return lista;
}

function criarDadosAtendimento(usuarios) {
  const u = (id) => { const x = usuarios.find(y => y.id === id); return { id: x.id, nome: x.nome }; };
  const comercial = { ligado: true, fuso: 'America/Cuiaba', dias: [1, 2, 3, 4, 5].map(dia => ({ dia, inicio: '08:00', fim: '18:00' })) };
  const setores = [
    { id: 'set_suporte', empresa_id: 'emp_j2a', codigo: 'suporte', nome: 'Suporte', descricao: 'Dúvidas e problemas no ERP e nos sistemas.', situacao: 'ativo',
      membros: [u('usr_carla'), u('usr_bruno')], horario: comercial,
      fora_horario: { ligado: false, texto: 'Recebemos sua mensagem. Atendemos de segunda a sexta, das 8h às 18h, e respondemos assim que abrirmos.' },
      versao: 2, criado_em: em(20 * DIA), atualizado_em: em(2 * DIA) },
    { id: 'set_financeiro', empresa_id: 'emp_j2a', codigo: 'financeiro', nome: 'Financeiro', descricao: 'Boletos, notas e pagamentos.', situacao: 'ativo',
      membros: [u('usr_ana')], horario: comercial,
      fora_horario: { ligado: true, texto: 'O Financeiro atende de segunda a sexta, das 8h às 18h. Sua mensagem ficou registrada.' },
      versao: 1, criado_em: em(20 * DIA), atualizado_em: em(20 * DIA) },
    { id: 'set_comercial', empresa_id: 'emp_j2a', codigo: 'comercial', nome: 'Comercial', descricao: 'Orçamentos e novos módulos.', situacao: 'ativo',
      membros: [u('usr_bruno')], horario: { ligado: false, fuso: 'America/Cuiaba', dias: [] }, fora_horario: { ligado: false, texto: '' },
      versao: 1, criado_em: em(15 * DIA), atualizado_em: em(15 * DIA) },
  ];

  // Mariana e João usam os números de teste do canal cn_suporte: só para eles a resposta sai.
  const PESSOAS = [
    ['Mariana Oliveira', '5565999990010'], ['João Pereira', '5565999990011'], ['Fernanda Costa', '5565999981001'],
    ['Ricardo Alves', '5565999981002'], ['Patrícia Gomes', '5565999981003'], ['Lucas Fernandes', '5565999981004'],
    ['Juliana Rocha', '5565999981005'], ['Marcos Teixeira', '5565999981006'],
  ];
  const contatos = PESSOAS.map(([nome, telefone], i) => ({
    id: `ct_ex${i + 1}`, empresa_id: 'emp_j2a', nome, nome_whatsapp: nome.split(' ')[0], telefone, criado_em: em((30 - i) * DIA),
  }));

  const canal = { id: 'cn_suporte', nome: 'Suporte J2A' };
  const setor = (id) => { const s = setores.find(x => x.id === id); return { id: s.id, nome: s.nome }; };
  // [contato, setor, responsável, situação, etiquetas, falas, motivo]. Fala: [quem, texto, minutos atrás, estado?]
  //   quem: c = contato, a = responsável, n = nota, e = evento do sistema.
  const ROTEIRO = [
    [0, 'set_suporte', 'usr_carla', 'aberta', ['ERP Protheus', 'Prioridade'], [
      ['e', 'Conversa aberta no setor Suporte.', 47], ['c', 'Bom dia! O relatório de faturamento mensal está demorando muito para abrir hoje.', 46],
      ['e', 'Carla Souza assumiu a conversa.', 44], ['a', 'Bom dia, Mariana! Vou verificar agora. Qual período você selecionou?', 43, 'lida'],
      ['c', 'Novembro inteiro.', 12], ['c', 'Continua travando.', 8]]],
    [1, 'set_suporte', null, 'aberta', [], [
      ['e', 'Conversa aberta no setor Suporte.', 6], ['c', 'Olá, não consigo entrar no portal, o código não chega.', 6]]],
    [2, 'set_financeiro', null, 'aberta', ['Boleto'], [
      ['e', 'Conversa aberta no setor Suporte.', 26], ['c', 'Boa tarde, preciso da segunda via do boleto de novembro.', 25],
      ['e', 'Bruno Lima transferiu para o setor Financeiro.', 23], ['c', 'É urgente, vence hoje.', 21]]],
    [3, 'set_suporte', 'usr_bruno', 'aberta', ['NF-e'], [
      ['e', 'Conversa aberta no setor Suporte.', 91], ['c', 'A nota fiscal 1234 foi rejeitada pela Sefaz.', 90],
      ['e', 'Bruno Lima assumiu a conversa.', 88], ['a', 'Ricardo, qual a mensagem de rejeição?', 85, 'lida'],
      ['c', 'Rejeição 539: duplicidade de NF-e.', 80], ['n', 'Verificar com o fiscal se houve reenvio no dia 24.', 78],
      ['a', 'Encontramos o motivo: a nota foi transmitida duas vezes. Já cancelamos a duplicada.', 30, 'entregue']]],
    [4, 'set_comercial', null, 'aberta', [], [
      ['e', 'Conversa aberta no setor Suporte.', 141], ['c', 'Gostaria de um orçamento para o módulo de RH.', 140],
      ['e', 'Carla Souza transferiu para o setor Comercial.', 138]]],
    [5, 'set_financeiro', 'usr_ana', 'aberta', [], [
      ['e', 'Conversa aberta no setor Financeiro.', 201], ['c', 'Meu pagamento de ontem já foi baixado?', 200],
      ['e', 'Ana Ribeiro assumiu a conversa.', 195], ['a', 'Já foi sim, Lucas. A baixa entrou hoje às 9h.', 190, 'lida']]],
    [6, 'set_suporte', 'usr_carla', 'encerrada', [], [
      ['e', 'Conversa aberta no setor Suporte.', 2 * 24 * 60 + 30], ['c', 'Como emito o relatório de comissões?', 2 * 24 * 60 + 30],
      ['e', 'Carla Souza assumiu a conversa.', 2 * 24 * 60 + 25], ['a', 'Pelo menu Relatórios › Comissões. Escolha o período e clique em Gerar.', 2 * 24 * 60 + 20, 'lida'],
      ['c', 'Deu certo, obrigada!', 2 * 24 * 60 + 10], ['e', 'Carla Souza encerrou a conversa: Dúvida resolvida.', 2 * 24 * 60 + 5]], 'Dúvida resolvida'],
    [7, 'set_suporte', 'usr_carla', 'encerrada', [], [
      ['e', 'Conversa aberta no setor Suporte.', 5 * 24 * 60], ['c', 'O sistema está fora do ar?', 5 * 24 * 60],
      ['e', 'Carla Souza assumiu a conversa.', 5 * 24 * 60 - 3], ['a', 'Já voltou, Marcos. Foi uma queda de energia no servidor.', 5 * 24 * 60 - 20, 'lida'],
      ['e', 'Carla Souza encerrou a conversa: Instabilidade resolvida.', 5 * 24 * 60 - 25]], 'Instabilidade resolvida'],
    [0, 'set_suporte', 'usr_carla', 'encerrada', [], [
      ['e', 'Conversa aberta no setor Suporte.', 10 * 24 * 60], ['c', 'Bom dia, como troco a senha do portal?', 10 * 24 * 60],
      ['e', 'Carla Souza assumiu a conversa.', 10 * 24 * 60 - 2], ['a', 'Bom dia! Na tela de entrada, clique em "Esqueci a senha".', 10 * 24 * 60 - 5, 'lida'],
      ['e', 'Carla Souza encerrou a conversa: Dúvida resolvida.', 10 * 24 * 60 - 30]], 'Dúvida resolvida'],
  ];

  const conversas = ROTEIRO.map(([ic, setorId, respId, situacao, etiquetas, falas, motivo], n) => {
    const contato = contatos[ic];
    const id = `cv_ex${String(n + 1).padStart(2, '0')}`;
    const itens = falas.map(([quem, texto, minAtras, estado], k) => {
      const base = { id: `itm_ex${n + 1}_${k + 1}`, texto, em: em(minAtras * MIN), mensagem_id: null };
      if (quem === 'c') return { ...base, categoria: 'mensagem', direcao: 'entrada', autor: { tipo: 'contato', id: contato.id, nome: contato.nome }, tipo: 'texto', estado: 'recebida' };
      if (quem === 'a') return { ...base, categoria: 'mensagem', direcao: 'saida', autor: { tipo: 'atendente', ...u(respId) }, tipo: 'texto', estado };
      if (quem === 'n') return { ...base, categoria: 'nota', direcao: null, autor: { tipo: 'atendente', ...u(respId) }, tipo: null, estado: null };
      return { ...base, categoria: 'evento', direcao: null, autor: { tipo: 'sistema', id: null, nome: 'IA Talk' }, tipo: null, estado: null };
    });
    const ultimo = itens[itens.length - 1];
    const naoLidas = situacao === 'aberta' ? entradasSemResposta(itens).length : 0;
    return {
      id, empresa_id: 'emp_j2a', protocolo: `2026-${String(101 + n).padStart(6, '0')}`, canal, contato_id: contato.id, setor: setor(setorId),
      responsavel: respId ? u(respId) : null, situacao, nao_lidas: naoLidas, etiquetas, itens, prioridade: 'normal', referencias: [],
      aberta_em: itens[0].em, atualizada_em: ultimo.em, encerrada_em: situacao === 'encerrada' ? ultimo.em : null,
      motivo_encerramento: situacao === 'encerrada' ? motivo : null,
    };
  });

  // Duas conversas vieram de chamados do sistema de origem (API v1, §8.9); a do João é prioridade alta.
  const referencia = (id, titulo) => ({ sistema: 'softexpert', id, titulo, link: `https://softexpert.exemplo.com.br/chamado/${id}`, aplicacao: APLICACAO_ORIGEM });
  conversas[0].referencias = [referencia('036988', 'Relatório de faturamento lento')];
  conversas[1].referencias = [referencia('036990', 'Código de acesso não chega')];
  conversas[1].prioridade = 'alta';
  const foto = (cv, situacao = 'aberta') => ({ id: cv.id, protocolo: cv.protocolo, situacao });
  const retornos = [
    { id: 'rt_ex1', aplicacao_id: APLICACAO_ORIGEM.id, tipo: 'conversa.criada', em: em(47 * MIN), conversa: foto(conversas[0]),
      dados: { setor: { codigo: 'suporte', nome: 'Suporte' }, na_fila: true }, confirmado_em: em(46 * MIN) },
    { id: 'rt_ex2', aplicacao_id: APLICACAO_ORIGEM.id, tipo: 'conversa.assumida', em: em(44 * MIN), conversa: foto(conversas[0]),
      dados: { responsavel: u('usr_carla') }, confirmado_em: null },
    { id: 'rt_ex3', aplicacao_id: APLICACAO_ORIGEM.id, tipo: 'conversa.criada', em: em(6 * MIN), conversa: foto(conversas[1]),
      dados: { setor: { codigo: 'suporte', nome: 'Suporte' }, na_fila: true }, confirmado_em: null },
  ];

  const respostasRapidas = [
    ['/saudacao', 'Saudação inicial', 'Olá, {nome_contato}! Aqui é {nome_atendente}, da J2A. Já estou vendo a sua mensagem.', null],
    ['/prazo', 'Prazo de retorno', 'Registrei a sua solicitação. Nosso prazo de retorno é de até 2 horas úteis.', null],
    ['/boleto', 'Segunda via de boleto', 'Já pedi a segunda via ao Financeiro e envio por aqui em até 10 minutos.', 'set_financeiro'],
    ['/acesso', 'Acesso ao portal', 'Para entrar, abra o link da empresa, informe o celular com DDD e digite o código que chega pelo WhatsApp.', 'set_suporte'],
    ['/encerrar', 'Encerramento', 'Fico à disposição se precisar de mais alguma coisa. Vou encerrar este atendimento. Tenha um ótimo dia!', null],
  ].map(([atalho, titulo, texto, setorId], i) => ({
    id: `rr_ex${i + 1}`, empresa_id: 'emp_j2a', atalho, titulo, texto, setor: setorId ? setor(setorId) : null, situacao: 'ativa', atualizado_em: em((10 - i) * DIA),
  }));

  return { setores, contatos, conversas, respostasRapidas, retornos };
}

// Conversa que chega sozinha de tempos em tempos (simula o WhatsApp), em rodízio.
const CHEGADAS = [[1, 'Alguém pode me ajudar com o código de acesso?'], [2, 'Conseguiram ver o boleto?'], [4, 'Ainda aguardo o orçamento.'], [0, 'Agora abriu, obrigada!']];

function criarAtendimentoSimulado({ dados, sessao, novo, agora, auditar, listar, exigirCampos, emitir, intervaloConversaMs = 25000 }) {
  const at = criarDadosAtendimento(dados.usuarios);
  dados.atendimento = at;

  // Uso dos números: o Suporte J2A está compartilhado com o IA Command (opção B), os demais só integração.
  for (const c of dados.canais) {
    if (c.id === 'cn_suporte') {
      c.uso = 'compartilhado';
      c.atendimento = { empresa: { id: 'emp_j2a', nome: 'J2A Consultoria' }, setor_padrao: { id: 'set_suporte', nome: 'Suporte' } };
    } else {
      c.uso = 'integracao';
      c.atendimento = null;
    }
  }

  // ── Quem está pedindo e o que pode ver ──────────────────────────────────────
  const usuarioId = (req) => (req?.cenarios?.has('atendente') ? 'usr_carla' : sessao.usuarioId);
  const plataforma = (req) => sessao.plataforma && !req?.cenarios?.has('atendente');
  const usuario = (uid) => dados.usuarios.find(x => x.id === uid);
  const ref = (uid) => { const x = usuario(uid); return { id: x.id, nome: x.nome }; };
  const rotinas = (req) => {
    const papel = dados.papeis.find(p => p.codigo === usuario(usuarioId(req)).papel);
    return plataforma(req) ? Object.values(ROTINAS) : [...(papel?.rotinas || [])];
  };
  const exigirRotina = (req, ...lista) => {
    if (!lista.some(r => rotinas(req).includes(r))) throw erro('sem_permissao', 'Você não tem permissão para esta rotina. Fale com o administrador da empresa.');
  };
  const veTudo = (req) => plataforma(req) || ['admin_empresa', 'supervisor'].includes(usuario(usuarioId(req)).papel);
  const setoresDoUsuario = (uid) => at.setores.filter(s => s.membros.some(m => m.id === uid)).map(s => s.id);
  const podeVer = (req, cv) => cv.empresa_id === sessao.empresaId
    && (veTudo(req) || cv.responsavel?.id === usuarioId(req) || setoresDoUsuario(usuarioId(req)).includes(cv.setor.id));

  const daEmpresa = (lista) => lista.filter(x => x.empresa_id === sessao.empresaId);
  const acharDaEmpresa = (lista, id, nome) => {
    const x = lista.find(i => i.id === id && i.empresa_id === sessao.empresaId);
    if (!x) throw erro('nao_encontrado', `${nome} não encontrado(a).`);
    return x;
  };
  // Conversa de outra empresa ou fora dos setores do atendente = 404 (nunca revela que existe).
  const acharConversa = (req) => {
    const cv = at.conversas.find(x => x.id === req.params.id);
    if (!cv || !podeVer(req, cv)) throw erro('nao_encontrado', 'Conversa não encontrada.');
    return cv;
  };

  // ── Formas de resposta ──────────────────────────────────────────────────────
  const contatoPublico = (ct) => {
    const dele = at.conversas.filter(c => c.contato_id === ct.id).sort((a, b) => (a.aberta_em < b.aberta_em ? -1 : 1));
    return { id: ct.id, nome: ct.nome, nome_whatsapp: ct.nome_whatsapp, telefone_mascarado: mascararTelefone(ct.telefone), conversas_total: dele.length,
      primeira_conversa_em: dele[0]?.aberta_em || null, ultima_conversa_em: dele[dele.length - 1]?.aberta_em || null };
  };
  const contatoCurto = (ct) => ({ id: ct.id, nome: ct.nome, telefone_mascarado: mascararTelefone(ct.telefone) });
  const contatoDe = (cv) => at.contatos.find(c => c.id === cv.contato_id);
  const previa = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  // Desde quando a conversa espera alguém: 1ª mensagem do contato sem resposta; numa conversa
  // aberta pelo sistema de origem que ninguém respondeu ainda, a hora em que ela foi aberta.
  function aguardandoDesde(cv) {
    if (cv.situacao !== 'aberta') return null;
    const primeira = entradasSemResposta(cv.itens)[0];
    if (primeira) return primeira.em;
    return cv.itens.some(i => i.categoria === 'mensagem' && i.direcao === 'saida' && i.autor.tipo === 'atendente') ? null : cv.aberta_em;
  }
  function conversaResumo(cv) {
    const ultima = [...cv.itens].reverse().find(i => i.categoria === 'mensagem');
    return {
      id: cv.id, protocolo: cv.protocolo, canal: cv.canal, contato: contatoCurto(contatoDe(cv)), setor: cv.setor, responsavel: cv.responsavel,
      situacao: cv.situacao, na_fila: cv.situacao === 'aberta' && !cv.responsavel, nao_lidas: cv.nao_lidas,
      ultima_mensagem: ultima ? { previa: previa(ultima.texto), direcao: ultima.direcao, autor_tipo: ultima.autor.tipo, em: ultima.em } : null,
      aguardando_desde: aguardandoDesde(cv), etiquetas: cv.etiquetas, prioridade: cv.prioridade, referencias: cv.referencias,
      aberta_em: cv.aberta_em, atualizada_em: cv.atualizada_em, encerrada_em: cv.encerrada_em,
    };
  }
  // Regras do canal para mandar algo ao contato (mesmas do servidor real, C3): { codigo, motivo } ou null.
  function bloqueioDoCanal(cv) {
    const canal = dados.canais.find(c => c.id === cv.canal.id);
    if (canal.envio_modo === 'desligado') return { codigo: 'envio_desligado', motivo: 'O envio está desligado neste canal.' };
    if (canal.estado !== 'conectado') return { codigo: 'canal_desconectado', motivo: 'O canal está desconectado. A resposta sai quando ele voltar.' };
    if (canal.envio_modo === 'teste' && !(canal.numeros_teste || []).includes(contatoDe(cv).telefone)) {
      return { codigo: 'sem_permissao', motivo: 'Este canal ainda envia só para os números de teste.' };
    }
    return null;
  }
  // Por que a resposta não sai (a tela mostra o motivo e desabilita o campo).
  function envioDaConversa(req, cv) {
    const motivo = cv.situacao === 'encerrada' ? 'Conversa encerrada. Reabra para responder.'
      : cv.responsavel && cv.responsavel.id !== usuarioId(req) ? `Esta conversa está com ${cv.responsavel.nome}. Peça a transferência para responder.`
        : bloqueioDoCanal(cv)?.motivo || null;
    return { pode_responder: !motivo, motivo, limite_caracteres: LIMITE_TEXTO };
  }
  const conversaDetalhe = (req, cv) => ({ ...conversaResumo(cv), contato: contatoPublico(contatoDe(cv)), motivo_encerramento: cv.motivo_encerramento, envio: envioDaConversa(req, cv) });
  function setorPublico(s) {
    const abertas = at.conversas.filter(c => c.setor.id === s.id && c.situacao === 'aberta');
    const { empresa_id, ...resto } = s; // eslint-disable-line no-unused-vars
    return { ...resto, conversas_abertas: abertas.length, na_fila: abertas.filter(c => !c.responsavel).length };
  }
  const respostaPublica = ({ empresa_id, ...resto }) => resto; // eslint-disable-line no-unused-vars

  // ── Retornos para o sistema de origem (§8.9): ficam até ele confirmar ───────
  const setorComCodigo = (cv) => { const s = at.setores.find(x => x.id === cv.setor.id); return { codigo: s.codigo, nome: s.nome }; };
  // Um retorno por aplicação que tem chamado ligado à conversa (cada sistema só vê os seus).
  function registrarRetorno(cv, tipo, extras = {}) {
    for (const aplicacaoId of new Set(cv.referencias.map(r => r.aplicacao.id))) {
      at.retornos.push({ id: novo('rt'), aplicacao_id: aplicacaoId, tipo, em: agora(),
        conversa: { id: cv.id, protocolo: cv.protocolo, situacao: cv.situacao }, dados: extras, confirmado_em: null });
    }
  }

  function contadores(req) {
    const uid = usuarioId(req);
    const visiveis = at.conversas.filter(c => c.situacao === 'aberta' && podeVer(req, c));
    const setores = daEmpresa(at.setores).filter(s => s.situacao === 'ativo' && (veTudo(req) || s.membros.some(m => m.id === uid)));
    return {
      minhas: visiveis.filter(c => c.responsavel?.id === uid).length,
      fila: visiveis.filter(c => !c.responsavel).length,
      abertas: visiveis.length,
      por_setor: setores.map(s => {
        const doSetor = visiveis.filter(c => c.setor.id === s.id);
        return { id: s.id, nome: s.nome, abertas: doSetor.length, na_fila: doSetor.filter(c => !c.responsavel).length };
      }),
      atualizado_em: agora(),
    };
  }

  // ── Mudanças: um ponto só para registrar e avisar ───────────────────────────
  // O simulado tem uma sessão só; o servidor real manda cada aviso só a quem pode ver (§8).
  const salaConversa = (id) => `conversa:${id}`;
  function avisar(cv) {
    emitir(S.conversaAtualizada, conversaResumo(cv), 'atendimento');
    emitir(S.contadoresAtendimento, contadores(), 'atendimento');
  }
  function adicionarItem(cv, item) {
    const it = { id: novo('itm'), mensagem_id: null, tipo: null, estado: null, direcao: null, em: agora(), ...item };
    cv.itens.push(it);
    cv.atualizada_em = it.em;
    emitir(S.itemConversa, { conversa_id: cv.id, item: it }, salaConversa(cv.id));
    return it;
  }
  const evento = (cv, texto) => adicionarItem(cv, { categoria: 'evento', autor: { tipo: 'sistema', id: null, nome: 'IA Talk' }, texto });

  // Chegada de mensagem do contato (regras de entrada da C9, §8.6).
  function receber(contato, texto) {
    const canal = dados.canais.find(c => c.id === 'cn_suporte');
    let cv = at.conversas.find(c => c.contato_id === contato.id && c.canal.id === canal.id && c.situacao === 'aberta');
    if (!cv) {
      const setor = canal.atendimento.setor_padrao;
      const n = at.conversas.length;
      cv = { id: novo('cv'), empresa_id: contato.empresa_id, protocolo: `2026-${String(101 + n).padStart(6, '0')}`, canal: { id: canal.id, nome: canal.nome },
        contato_id: contato.id, setor: { ...setor }, responsavel: null, situacao: 'aberta', nao_lidas: 0, etiquetas: [], itens: [],
        prioridade: 'normal', referencias: [], aberta_em: agora(), atualizada_em: agora(), encerrada_em: null, motivo_encerramento: null };
      at.conversas.unshift(cv);
      evento(cv, `Conversa aberta no setor ${setor.nome}.`);
    }
    adicionarItem(cv, { categoria: 'mensagem', direcao: 'entrada', autor: { tipo: 'contato', id: contato.id, nome: contato.nome }, tipo: 'texto', texto, estado: 'recebida' });
    cv.nao_lidas += 1;
    avisar(cv);
    return cv;
  }

  // Saída para o contato pela fila da C3 (estados comprovados, ritmo do canal). Quem chama já
  // conferiu as regras do canal. Texto com a palavra "falha" termina em `falhou` (teste da tela de erro).
  function enviarNaConversa(cv, texto, autor) {
    const t0 = agora();
    const m = { id: novo('msg'), direcao: 'saida', canal: { ...cv.canal }, aplicacao: null, origem: 'atendimento', contato_mascarado: mascararTelefone(contatoDe(cv).telefone),
      tipo: 'texto', previa: previa(texto), texto, estado: 'aceita', correlacao_id: cv.protocolo, criada_em: t0, atualizada_em: t0,
      historico_estados: [{ estado: 'aceita', em: t0, detalhe: `Mensagem da conversa ${cv.protocolo}.` }], metadados: { conversa_id: cv.id }, anexos: [] };
    dados.mensagens.unshift(m);
    const it = adicionarItem(cv, { categoria: 'mensagem', direcao: 'saida', autor, tipo: 'texto', texto, estado: 'aceita', mensagem_id: m.id });
    const passos = /falha/i.test(texto) ? ['aguardando', 'encaminhada', 'falhou'] : ['aguardando', 'encaminhada', 'enviada', 'entregue', 'lida'];
    passos.forEach((estado, i) => setTimeout(() => {
      it.estado = m.estado = estado;
      m.atualizada_em = agora();
      m.historico_estados.push({ estado, em: m.atualizada_em, detalhe: estado === 'falhou' ? 'Número não encontrado no WhatsApp.' : null });
      emitir(S.estadoItemConversa, { conversa_id: cv.id, item_id: it.id, estado, em: m.atualizada_em }, salaConversa(cv.id));
      emitir(S.estadoMensagem, { id: m.id, estado, em: m.atualizada_em }, 'painel');
    }, (i + 1) * 1200).unref?.());
    return it;
  }

  // ── Validações ──────────────────────────────────────────────────────────────
  const textoEntre = (rotulo, max) => (v) => {
    const t = String(v ?? '').trim();
    return !t ? `Escreva ${rotulo}.` : t.length > max ? `Use no máximo ${max} caracteres.` : null;
  };
  function validarHorario(h) {
    if (h === undefined) return null;
    if (!h || typeof h !== 'object' || typeof h.ligado !== 'boolean' || !String(h.fuso || '').trim() || !Array.isArray(h.dias)) return 'Informe ligado, fuso e dias.';
    for (const d of h.dias) {
      if (!Number.isInteger(d?.dia) || d.dia < 0 || d.dia > 6) return 'Dia da semana de 0 (domingo) a 6 (sábado).';
      if (!HORA.test(d.inicio || '') || !HORA.test(d.fim || '') || d.inicio >= d.fim) return 'Use HH:MM, com início antes do fim.';
    }
    if (h.ligado && !h.dias.length) return 'Marque ao menos um dia ou desligue o horário.';
    return null;
  }
  function validarForaHorario(f) {
    if (f === undefined) return null;
    if (!f || typeof f !== 'object' || typeof f.ligado !== 'boolean') return 'Informe ligado e texto.';
    const t = String(f.texto || '').trim();
    if (f.ligado && !t) return 'Escreva a mensagem de fora do horário.';
    return t.length > 1000 ? 'Use no máximo 1000 caracteres.' : null;
  }
  function membrosDe(lista) {
    if (lista === undefined) return undefined;
    const ids = Array.isArray(lista) ? [...new Set(lista)] : null;
    const validos = ids && ids.every(id => usuario(id)?.situacao === 'ativo');
    if (!validos) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { membros: 'Escolha usuários ativos da empresa.' } });
    return ids.map(ref);
  }
  function nomeSetorUnico(nome, idAtual = null) {
    const n = String(nome).trim().toLowerCase();
    if (daEmpresa(at.setores).some(s => s.id !== idAtual && s.nome.toLowerCase() === n)) throw erro('conflito', 'Já existe um setor com este nome.');
  }

  // ── Rotas ───────────────────────────────────────────────────────────────────
  function rotas(admin) {
    const R = ROTINAS;
    const leitura = (req) => exigirRotina(req, R.atendimento, R.setores);

    // Setores
    admin.get('/setores', (req, res) => {
      leitura(req);
      res.json(listar(req, daEmpresa(at.setores), {
        busca: [i => i.nome, i => i.descricao], filtros: { situacao: (i, v) => i.situacao === v }, ordenarPadrao: 'nome', mapa: setorPublico,
      }));
    });
    admin.get('/setores/:id', (req, res) => { leitura(req); res.json(setorPublico(acharDaEmpresa(at.setores, req.params.id, 'Setor'))); });
    admin.post('/setores', (req, res) => {
      exigirRotina(req, R.setores);
      const b = req.body || {};
      exigirCampos(b, {
        nome: textoEntre('o nome', 60), horario: validarHorario, fora_horario: validarForaHorario,
        codigo: (v) => (v === undefined || CODIGO_SETOR.test(String(v)) ? null : 'Use de 2 a 30 letras minúsculas, números e hífen (ex.: suporte).'),
      });
      nomeSetorUnico(b.nome);
      // O código é o que o sistema de origem usa na API v1: nasce do nome (ou vem no pedido) e não muda mais.
      const codigo = b.codigo ?? codigoDoNome(b.nome);
      if (!CODIGO_SETOR.test(codigo)) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { codigo: 'Informe um código de 2 a 30 letras minúsculas, números e hífen.' } });
      if (daEmpresa(at.setores).some(x => x.codigo === codigo)) throw erro('conflito', `Já existe um setor com o código ${codigo}.`);
      const s = { id: novo('set'), empresa_id: sessao.empresaId, codigo, nome: b.nome.trim(), descricao: String(b.descricao || '').trim().slice(0, 200), situacao: 'ativo',
        membros: membrosDe(b.membros) || [], horario: b.horario || { ligado: false, fuso: 'America/Cuiaba', dias: [] },
        fora_horario: b.fora_horario || { ligado: false, texto: '' }, versao: 1, criado_em: agora(), atualizado_em: agora() };
      at.setores.push(s);
      auditar('setor.criado', `Criou o setor ${s.nome}`);
      res.status(201).json(setorPublico(s));
    });
    admin.put('/setores/:id', (req, res) => {
      exigirRotina(req, R.setores);
      const s = acharDaEmpresa(at.setores, req.params.id, 'Setor');
      const b = req.body || {};
      if (b.versao !== s.versao) throw erro('conflito', 'Este setor foi alterado em outra sessão. Recarregue antes de salvar.');
      if (b.codigo !== undefined && b.codigo !== s.codigo) {
        throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { codigo: 'O código não muda depois de criado: os sistemas de origem usam ele.' } });
      }
      exigirCampos(b, {
        nome: (v) => (v === undefined ? null : textoEntre('o nome', 60)(v)), horario: validarHorario, fora_horario: validarForaHorario,
        situacao: (v) => (v === undefined || ['ativo', 'inativo'].includes(v) ? null : 'Use ativo ou inativo.'),
      });
      if (b.nome !== undefined) nomeSetorUnico(b.nome, s.id);
      if (b.situacao === 'inativo' && s.situacao === 'ativo') {
        if (at.conversas.some(c => c.setor.id === s.id && c.situacao === 'aberta')) throw erro('conflito', 'Este setor tem conversas abertas. Transfira-as antes de inativar.');
        if (dados.canais.some(c => c.atendimento?.setor_padrao?.id === s.id)) throw erro('conflito', 'Este setor recebe as conversas novas de um canal. Troque o setor padrão do canal antes de inativar.');
      }
      const membros = membrosDe(b.membros);
      Object.assign(s, {
        ...(b.nome !== undefined ? { nome: b.nome.trim() } : {}), ...(b.descricao !== undefined ? { descricao: String(b.descricao).trim().slice(0, 200) } : {}),
        ...(membros ? { membros } : {}), ...(b.horario ? { horario: b.horario } : {}), ...(b.fora_horario ? { fora_horario: b.fora_horario } : {}),
        ...(b.situacao ? { situacao: b.situacao } : {}), versao: s.versao + 1, atualizado_em: agora(),
      });
      for (const c of at.conversas) if (c.setor.id === s.id) c.setor.nome = s.nome;
      auditar('setor.alterado', `Alterou o setor ${s.nome}`);
      res.json(setorPublico(s));
    });

    // Respostas rápidas
    admin.get('/respostas-rapidas', (req, res) => {
      leitura(req);
      res.json(listar(req, daEmpresa(at.respostasRapidas), {
        busca: [i => i.atalho, i => i.titulo, i => i.texto],
        // setor_id: as gerais (sem setor) + as daquele setor — é o que a Central mostra ao digitar "/".
        filtros: { situacao: (i, v) => i.situacao === v, setor_id: (i, v) => !i.setor || i.setor.id === v },
        ordenarPadrao: 'atalho', mapa: respostaPublica,
      }));
    });
    const validarResposta = (b, parcial) => exigirCampos(b, {
      atalho: (v) => (parcial && v === undefined ? null : ATALHO.test(String(v || '')) ? null : 'Comece com / e use letras minúsculas, números e hífen (ex.: /boleto).'),
      titulo: (v) => (parcial && v === undefined ? null : textoEntre('o título', 60)(v)),
      texto: (v) => (parcial && v === undefined ? null : textoEntre('o texto', 1000)(v)),
      situacao: (v) => (v === undefined || ['ativa', 'inativa'].includes(v) ? null : 'Use ativa ou inativa.'),
    });
    const setorDaResposta = (setorId) => {
      if (setorId === undefined) return undefined;
      if (setorId === null) return null;
      const s = acharDaEmpresa(at.setores, setorId, 'Setor');
      return { id: s.id, nome: s.nome };
    };
    const atalhoUnico = (atalho, idAtual = null) => {
      if (daEmpresa(at.respostasRapidas).some(r => r.id !== idAtual && r.atalho === atalho)) throw erro('conflito', 'Já existe uma resposta rápida com este atalho.');
    };
    admin.post('/respostas-rapidas', (req, res) => {
      exigirRotina(req, R.setores);
      const b = req.body || {};
      validarResposta(b, false);
      atalhoUnico(b.atalho);
      const r = { id: novo('rr'), empresa_id: sessao.empresaId, atalho: b.atalho, titulo: b.titulo.trim(), texto: b.texto.trim(),
        setor: setorDaResposta(b.setor_id ?? null), situacao: 'ativa', atualizado_em: agora() };
      at.respostasRapidas.push(r);
      res.status(201).json(respostaPublica(r));
    });
    admin.put('/respostas-rapidas/:id', (req, res) => {
      exigirRotina(req, R.setores);
      const r = acharDaEmpresa(at.respostasRapidas, req.params.id, 'Resposta rápida');
      const b = req.body || {};
      validarResposta(b, true);
      if (b.atalho !== undefined) atalhoUnico(b.atalho, r.id);
      const setor = setorDaResposta(b.setor_id);
      Object.assign(r, {
        ...(b.atalho !== undefined ? { atalho: b.atalho } : {}), ...(b.titulo !== undefined ? { titulo: b.titulo.trim() } : {}),
        ...(b.texto !== undefined ? { texto: b.texto.trim() } : {}), ...(setor !== undefined ? { setor } : {}),
        ...(b.situacao ? { situacao: b.situacao } : {}), atualizado_em: agora(),
      });
      res.json(respostaPublica(r));
    });

    // Conversas
    const visoes = {
      minhas: (req, c) => c.situacao === 'aberta' && c.responsavel?.id === usuarioId(req),
      fila: (_req, c) => c.situacao === 'aberta' && !c.responsavel,
      abertas: (_req, c) => c.situacao === 'aberta',
      encerradas: (_req, c) => c.situacao === 'encerrada',
      todas: () => true,
    };
    admin.get('/conversas/contadores', (req, res) => { exigirRotina(req, R.atendimento); res.json(contadores(req)); });
    admin.get('/conversas', (req, res) => {
      exigirRotina(req, R.atendimento);
      const visao = req.query.visao || 'abertas';
      if (!VISOES_CONVERSA.includes(visao)) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { visao: `Use ${VISOES_CONVERSA.join(', ')}.` } });
      const lista = at.conversas.filter(c => podeVer(req, c) && visoes[visao](req, c)).map(conversaResumo);
      // Fila: prioridade alta primeiro e, dentro dela, quem espera há mais tempo. Demais: atividade mais recente primeiro.
      if (visao === 'fila' && !req.query.ordenar) {
        lista.sort((a, b) => (a.prioridade === b.prioridade ? String(a.aguardando_desde).localeCompare(String(b.aguardando_desde)) : a.prioridade === 'alta' ? -1 : 1));
      }
      const digitos = String(req.query.busca || '').replace(/\D/g, '');
      res.json(listar({ ...req, query: { ...req.query, busca: undefined } }, lista.filter(c => {
        const termo = String(req.query.busca || '').trim().toLowerCase();
        if (!termo) return true;
        const ct = at.contatos.find(x => x.id === c.contato.id);
        return c.contato.nome.toLowerCase().includes(termo) || c.protocolo.includes(termo) || (c.ultima_mensagem?.previa || '').toLowerCase().includes(termo)
          || (digitos.length >= 4 && ct.telefone.endsWith(digitos));
      }), {
        filtros: {
          setor_id: (i, v) => i.setor.id === v, canal_id: (i, v) => i.canal.id === v, contato_id: (i, v) => i.contato.id === v,
          responsavel_id: (i, v) => (v === 'nenhum' ? !i.responsavel : i.responsavel?.id === v), etiqueta: (i, v) => i.etiquetas.includes(v),
        },
        ordenarPadrao: visao === 'fila' ? null : 'atualizada_em',
      }));
    });
    admin.get('/conversas/:id', (req, res) => { exigirRotina(req, R.atendimento); res.json(conversaDetalhe(req, acharConversa(req))); });
    admin.get('/conversas/:id/itens', (req, res) => {
      exigirRotina(req, R.atendimento);
      const cv = acharConversa(req);
      res.json(listar(req, [...cv.itens].reverse(), { filtros: { categoria: (i, v) => v.split('|').includes(i.categoria) } }));
    });

    const exigirAberta = (cv) => { if (cv.situacao !== 'aberta') throw erro('conflito', 'Conversa encerrada. Reabra para continuar.'); };
    const exigirDonoOuSupervisao = (req, cv) => {
      if (cv.responsavel && cv.responsavel.id !== usuarioId(req) && !veTudo(req)) {
        throw erro('sem_permissao', `Esta conversa está com ${cv.responsavel.nome}. Só quem está com ela ou a supervisão pode fazer isso.`);
      }
    };
    const responder = (req, res, cv, status = 200) => { avisar(cv); res.status(status).json(conversaDetalhe(req, cv)); };

    admin.post('/conversas/:id/assumir', (req, res) => {
      exigirRotina(req, R.atendimento);
      const cv = acharConversa(req);
      exigirAberta(cv);
      const uid = usuarioId(req);
      if (cv.responsavel?.id === uid) return res.json(conversaDetalhe(req, cv)); // já é sua: repetir não muda nada
      if (cv.responsavel) throw erro('conflito', `${cv.responsavel.nome} já assumiu esta conversa.`);
      cv.responsavel = ref(uid);
      evento(cv, `${cv.responsavel.nome} assumiu a conversa.`);
      registrarRetorno(cv, 'conversa.assumida', { responsavel: cv.responsavel });
      responder(req, res, cv);
    });
    admin.post('/conversas/:id/devolver', (req, res) => {
      exigirRotina(req, R.atendimento);
      const cv = acharConversa(req);
      exigirAberta(cv);
      if (!cv.responsavel) throw erro('conflito', 'Esta conversa já está na fila.');
      exigirDonoOuSupervisao(req, cv);
      cv.responsavel = null;
      evento(cv, `${ref(usuarioId(req)).nome} devolveu a conversa para a fila do setor ${cv.setor.nome}.`);
      registrarRetorno(cv, 'conversa.devolvida', { setor: setorComCodigo(cv) });
      responder(req, res, cv);
    });
    admin.post('/conversas/:id/transferir', (req, res) => {
      exigirRotina(req, R.atendimento);
      const cv = acharConversa(req);
      exigirAberta(cv);
      exigirDonoOuSupervisao(req, cv);
      const b = req.body || {};
      if (!b.setor_id && !b.responsavel_id) {
        throw erro('requisicao_invalida', 'Escolha o setor ou a pessoa que vai receber a conversa.', { campos: { setor_id: 'Escolha o setor ou a pessoa.' } });
      }
      const destino = b.setor_id ? acharDaEmpresa(at.setores, b.setor_id, 'Setor') : at.setores.find(s => s.id === cv.setor.id);
      if (destino.situacao !== 'ativo') throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { setor_id: 'Este setor está inativo.' } });
      let pessoa = null;
      if (b.responsavel_id) {
        if (!destino.membros.some(m => m.id === b.responsavel_id) || usuario(b.responsavel_id)?.situacao !== 'ativo') {
          throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { responsavel_id: `Escolha alguém do setor ${destino.nome} ou troque o setor.` } });
        }
        pessoa = ref(b.responsavel_id);
      }
      if (b.nota !== undefined) exigirCampos(b, { nota: textoEntre('a nota', LIMITE_NOTA) });
      const quem = ref(usuarioId(req)).nome;
      cv.setor = { id: destino.id, nome: destino.nome };
      cv.responsavel = pessoa;
      evento(cv, pessoa ? `${quem} transferiu para ${pessoa.nome} (${destino.nome}).` : `${quem} transferiu para o setor ${destino.nome}.`);
      if (b.nota) adicionarItem(cv, { categoria: 'nota', autor: { tipo: 'atendente', ...ref(usuarioId(req)) }, texto: b.nota.trim() });
      registrarRetorno(cv, 'conversa.transferida', { setor: setorComCodigo(cv), responsavel: pessoa });
      auditar('conversa.transferida', `Transferiu a conversa ${cv.protocolo} para ${pessoa ? pessoa.nome : `o setor ${destino.nome}`}`);
      responder(req, res, cv);
    });
    admin.post('/conversas/:id/encerrar', (req, res) => {
      exigirRotina(req, R.atendimento);
      const cv = acharConversa(req);
      exigirAberta(cv);
      exigirDonoOuSupervisao(req, cv);
      const motivo = String(req.body?.motivo || '').trim();
      if (motivo.length > 200) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { motivo: 'Use no máximo 200 caracteres.' } });
      const quem = ref(usuarioId(req));
      if (!cv.responsavel) cv.responsavel = quem;
      cv.situacao = 'encerrada';
      cv.motivo_encerramento = motivo || null;
      cv.nao_lidas = 0;
      evento(cv, `${quem.nome} encerrou a conversa${motivo ? `: ${motivo}` : ''}.`);
      cv.encerrada_em = cv.atualizada_em;
      registrarRetorno(cv, 'conversa.encerrada', { motivo: cv.motivo_encerramento, responsavel: cv.responsavel, encerrada_em: cv.encerrada_em });
      responder(req, res, cv);
    });
    admin.post('/conversas/:id/reabrir', (req, res) => {
      exigirRotina(req, R.atendimento);
      const cv = acharConversa(req);
      if (cv.situacao !== 'encerrada') throw erro('conflito', 'Esta conversa já está aberta.');
      const outra = at.conversas.find(c => c.id !== cv.id && c.contato_id === cv.contato_id && c.canal.id === cv.canal.id && c.situacao === 'aberta');
      if (outra) throw erro('conflito', `Já existe uma conversa aberta com este contato (protocolo ${outra.protocolo}).`, { detalhe: { conversa_id: outra.id } });
      cv.situacao = 'aberta';
      cv.responsavel = ref(usuarioId(req));
      cv.encerrada_em = null;
      cv.motivo_encerramento = null;
      evento(cv, `${cv.responsavel.nome} reabriu a conversa.`);
      registrarRetorno(cv, 'conversa.reaberta', { responsavel: cv.responsavel });
      responder(req, res, cv);
    });
    admin.post('/conversas/:id/marcar-lida', (req, res) => {
      exigirRotina(req, R.atendimento);
      const cv = acharConversa(req);
      cv.nao_lidas = 0;
      responder(req, res, cv);
    });
    admin.put('/conversas/:id/etiquetas', (req, res) => {
      exigirRotina(req, R.atendimento);
      const cv = acharConversa(req);
      const lista = req.body?.etiquetas;
      const limpas = Array.isArray(lista) ? [...new Set(lista.map(e => String(e).trim()).filter(Boolean))] : null;
      if (!limpas || limpas.length > 10 || limpas.some(e => e.length > 30)) {
        throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { etiquetas: 'Até 10 etiquetas, cada uma com até 30 caracteres.' } });
      }
      cv.etiquetas = limpas;
      responder(req, res, cv);
    });
    admin.post('/conversas/:id/notas', (req, res) => {
      exigirRotina(req, R.atendimento);
      const cv = acharConversa(req);
      exigirCampos(req.body, { texto: textoEntre('a nota', LIMITE_NOTA) });
      const it = adicionarItem(cv, { categoria: 'nota', autor: { tipo: 'atendente', ...ref(usuarioId(req)) }, texto: req.body.texto.trim() });
      avisar(cv);
      res.status(201).json(it);
    });

    // Responder: passa pela fila de saída da C3 (enviarNaConversa).
    admin.post('/conversas/:id/responder', (req, res) => {
      exigirRotina(req, R.atendimento);
      const cv = acharConversa(req);
      exigirCampos(req.body, { texto: textoEntre('a resposta', LIMITE_TEXTO) });
      if (cv.situacao === 'encerrada' || (cv.responsavel && cv.responsavel.id !== usuarioId(req))) throw erro('conflito', envioDaConversa(req, cv).motivo);
      const bloqueio = bloqueioDoCanal(cv);
      if (bloqueio) throw erro(bloqueio.codigo, bloqueio.motivo);
      const quem = ref(usuarioId(req));
      if (!cv.responsavel) {
        // Responder uma conversa da fila já a assume (ninguém responde "sem dono").
        cv.responsavel = quem;
        evento(cv, `${quem.nome} assumiu a conversa.`);
        registrarRetorno(cv, 'conversa.assumida', { responsavel: quem });
      }
      const it = enviarNaConversa(cv, req.body.texto.trim(), { tipo: 'atendente', ...quem });
      cv.nao_lidas = 0;
      avisar(cv);
      res.status(202).json(it);
    });

    // Contatos
    const acharContato = (req) => {
      const ct = acharDaEmpresa(at.contatos, req.params.id, 'Contato');
      // Atendente só vê contato de conversa que ele pode ver.
      if (!veTudo(req) && !at.conversas.some(c => c.contato_id === ct.id && podeVer(req, c))) throw erro('nao_encontrado', 'Contato não encontrado.');
      return ct;
    };
    admin.get('/contatos/:id', (req, res) => { exigirRotina(req, R.atendimento); res.json(contatoPublico(acharContato(req))); });
    admin.put('/contatos/:id', (req, res) => {
      exigirRotina(req, R.atendimento);
      const ct = acharContato(req);
      exigirCampos(req.body, { nome: textoEntre('o nome', 80) });
      ct.nome = req.body.nome.trim();
      for (const cv of at.conversas.filter(c => c.contato_id === ct.id)) avisar(cv);
      res.json(contatoPublico(ct));
    });

    // Só do simulado: uma mensagem chegando do WhatsApp.
    admin.post('/simulado/receber', (req, res) => {
      const ct = req.body?.contato_id ? acharDaEmpresa(at.contatos, req.body.contato_id, 'Contato') : at.contatos[1];
      const cv = receber(ct, String(req.body?.texto || 'Olá, ainda estou aguardando.').slice(0, LIMITE_TEXTO));
      res.status(201).json(conversaResumo(cv));
    });
  }

  // ── API v1 do sistema de origem (§8.9) ─────────────────────────────────────
  // O sistema de origem (ex.: SoftExpert) abre conversa a partir de um chamado e busca
  // os retornos (assumida, encerrada…) até confirmar cada um. Cada sistema só vê os seus.
  const refV1 = ({ aplicacao, ...r }) => r; // eslint-disable-line no-unused-vars
  const refsDaAplicacao = (cv, appId) => cv.referencias.filter(r => r.aplicacao.id === appId).map(refV1);
  function conversaV1(cv, appId) {
    return {
      id: cv.id, protocolo: cv.protocolo, situacao: cv.situacao, na_fila: cv.situacao === 'aberta' && !cv.responsavel, canal: cv.canal.id,
      setor: setorComCodigo(cv), responsavel: cv.responsavel, prioridade: cv.prioridade, referencias: refsDaAplicacao(cv, appId),
      aberta_em: cv.aberta_em, atualizada_em: cv.atualizada_em, encerrada_em: cv.encerrada_em, motivo_encerramento: cv.motivo_encerramento,
      link: `${config.BASE_PATH}/atendimento.html?conversa=${cv.id}`,
    };
  }
  function retornoV1(rt) {
    const cv = at.conversas.find(c => c.id === rt.conversa.id);
    return { id: rt.id, tipo: rt.tipo, em: rt.em, conversa: rt.conversa, referencias: cv ? refsDaAplicacao(cv, rt.aplicacao_id) : [], dados: rt.dados };
  }
  const validarReferencia = (v) => (!v || typeof v !== 'object' || !SISTEMA_ORIGEM.test(String(v.sistema || '')) ? 'Informe referencia.sistema (ex.: softexpert).'
    : !String(v.id ?? '').trim() || String(v.id).length > 64 ? 'Informe referencia.id (até 64 caracteres).'
      : String(v.titulo || '').length > 200 ? 'Use no máximo 200 caracteres em referencia.titulo.'
        : v.link !== undefined && v.link !== null && !/^https:\/\/\S{1,490}$/.test(String(v.link)) ? 'O link precisa começar com https://.' : null);
  const validarContato = (v) => (!/^\d{12,13}$/.test(String(v?.telefone || '').replace(/\D/g, '')) ? 'Informe contato.telefone com DDI e DDD (ex.: 5565999990000).'
    : String(v.nome || '').trim().length > 80 ? 'Use no máximo 80 caracteres em contato.nome.' : null);

  function rotasV1(v1) {
    const app = APLICACAO_ORIGEM;
    const daAplicacao = (cv) => cv.referencias.some(r => r.aplicacao.id === app.id);

    v1.post('/conversas', (req, res) => {
      const b = req.body || {};
      const canal = dados.canais.find(c => c.id === b.canal);
      exigirCampos(b, {
        canal: () => (canal ? null : 'Canal inexistente ou não autorizado.'), contato: validarContato, referencia: validarReferencia,
        contexto: (v) => (v === undefined || String(v).length <= 4000 ? null : 'Use no máximo 4000 caracteres.'),
        prioridade: (v) => (v === undefined || ['normal', 'alta'].includes(v) ? null : 'Use normal ou alta.'),
        setor: (v) => (v === undefined || CODIGO_SETOR.test(String(v)) ? null : 'Use o código do setor (ex.: suporte).'),
        mensagem_inicial: (v) => (v === undefined ? null : textoEntre('a mensagem inicial', LIMITE_TEXTO)(v)),
      });
      if (!canal.atendimento || canal.uso === 'integracao') {
        throw erro('recurso_nao_suportado', 'Este número não está em atendimento. Peça à administração do IA Talk para ligar o atendimento no canal.');
      }
      const empresaId = canal.atendimento.empresa.id;
      const setor = b.setor === undefined ? at.setores.find(x => x.id === canal.atendimento.setor_padrao.id)
        : at.setores.find(x => x.empresa_id === empresaId && x.codigo === b.setor && x.situacao === 'ativo');
      if (!setor) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { setor: 'Setor inexistente ou inativo neste atendimento.' } });
      const sistema = b.referencia.sistema;
      const refId = String(b.referencia.id).trim();

      // 1) O mesmo chamado já tem conversa aberta: devolve a mesma (reenviar é seguro).
      const mesma = at.conversas.find(c => c.situacao === 'aberta' && c.referencias.some(r => r.aplicacao.id === app.id && r.sistema === sistema && r.id === refId));
      if (mesma) return res.status(200).set('Idempotent-Replayed', 'true').json({ ...conversaV1(mesma, app.id), resultado: 'existente', mensagem_inicial: null });

      const telefone = String(b.contato.telefone).replace(/\D/g, '');
      let ct = at.contatos.find(c => c.empresa_id === empresaId && c.telefone === telefone);
      if (!ct) {
        ct = { id: novo('ct'), empresa_id: empresaId, nome: String(b.contato.nome || '').trim() || 'Contato sem nome', nome_whatsapp: null, telefone, criado_em: agora() };
        at.contatos.push(ct);
      }
      const novaRef = { sistema, id: refId, titulo: String(b.referencia.titulo || '').trim() || null, link: b.referencia.link || null, aplicacao: { ...app } };
      // 2) O contato já está em conversa aberta neste número: o chamado entra nela (não abre outra).
      let cv = at.conversas.find(c => c.contato_id === ct.id && c.canal.id === canal.id && c.situacao === 'aberta');
      const resultado = cv ? 'vinculada' : 'criada';
      if (cv) {
        cv.referencias.push(novaRef);
        evento(cv, `Chamado ${sistema} #${refId} vinculado pelo ${app.nome}.`);
      } else {
        // 3) Conversa nova na fila do setor (chamado reenviado depois de encerrado também cai aqui).
        cv = { id: novo('cv'), empresa_id: empresaId, protocolo: `2026-${String(101 + at.conversas.length).padStart(6, '0')}`, canal: { id: canal.id, nome: canal.nome },
          contato_id: ct.id, setor: { id: setor.id, nome: setor.nome }, responsavel: null, situacao: 'aberta', nao_lidas: 0, etiquetas: [], itens: [],
          prioridade: 'normal', referencias: [novaRef], aberta_em: agora(), atualizada_em: agora(), encerrada_em: null, motivo_encerramento: null };
        at.conversas.unshift(cv);
        evento(cv, `Conversa aberta pelo ${app.nome} (chamado ${sistema} #${refId}) no setor ${setor.nome}.`);
      }
      if (b.prioridade === 'alta') cv.prioridade = 'alta';
      if (String(b.contexto || '').trim()) adicionarItem(cv, { categoria: 'nota', autor: { tipo: 'sistema', id: null, nome: app.nome }, texto: String(b.contexto).trim() });
      registrarRetorno(cv, `conversa.${resultado}`, { setor: setorComCodigo(cv), na_fila: !cv.responsavel, referencia: { sistema, id: refId } });

      // Mensagem inicial: opcional e só em conversa nova; respeita as regras do canal.
      // Se não puder sair, a conversa fica na fila do mesmo jeito e a resposta diz por quê.
      let inicial = null;
      if (b.mensagem_inicial !== undefined) {
        const bloqueio = resultado === 'criada' ? bloqueioDoCanal(cv) : { motivo: 'O contato já estava em atendimento; a mensagem inicial não foi enviada.' };
        if (bloqueio) inicial = { estado: 'nao_enviada', motivo: bloqueio.motivo, item_id: null };
        else {
          const it = enviarNaConversa(cv, String(b.mensagem_inicial).trim(), { tipo: 'sistema', id: null, nome: app.nome });
          inicial = { estado: it.estado, motivo: null, item_id: it.id };
        }
      }
      avisar(cv);
      res.status(resultado === 'criada' ? 201 : 200).json({ ...conversaV1(cv, app.id), resultado, mensagem_inicial: inicial });
    });

    v1.get('/conversas', (req, res) => {
      const [sistema, ...resto] = String(req.query.referencia || '').split(':');
      const refId = resto.join(':');
      const lista = at.conversas.filter(c => daAplicacao(c)
        && (!req.query.referencia || c.referencias.some(r => r.aplicacao.id === app.id && r.sistema === sistema && r.id === refId)));
      res.json(listar(req, lista.map(c => conversaV1(c, app.id)), { filtros: { situacao: (i, v) => i.situacao === v }, ordenarPadrao: 'aberta_em' }));
    });
    v1.get('/conversas/:id', (req, res) => {
      const cv = at.conversas.find(c => c.id === req.params.id);
      if (!cv || !daAplicacao(cv)) throw erro('nao_encontrado', 'Conversa não encontrada.');
      res.json(conversaV1(cv, app.id));
    });

    // Retornos: do mais antigo para o mais novo; o mesmo retorno volta até ser confirmado.
    v1.get('/retornos', (req, res) => {
      const limite = Math.min(Math.max(Number(req.query.limite) || 50, 1), 200);
      const pendentes = at.retornos.filter(r => r.aplicacao_id === app.id && !r.confirmado_em && (!req.query.tipo || r.tipo === req.query.tipo))
        .sort((a, b) => (a.em < b.em ? -1 : a.em > b.em ? 1 : 0));
      res.json({ itens: pendentes.slice(0, limite).map(retornoV1), tem_mais: pendentes.length > limite });
    });
    v1.post('/retornos/confirmar', (req, res) => {
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(i => typeof i !== 'string')) {
        throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { ids: 'Envie de 1 a 200 ids de retorno.' } });
      }
      const confirmados = [];
      const desconhecidos = [];
      for (const id of new Set(ids)) {
        const rt = at.retornos.find(r => r.id === id && r.aplicacao_id === app.id);
        if (!rt) { desconhecidos.push(id); continue; }
        rt.confirmado_em ||= agora(); // confirmar de novo não muda nada
        confirmados.push(id);
      }
      res.json({ confirmados, desconhecidos });
    });
  }

  // Uso do número no PUT /canais/:id (§8.1). Chamado pelo simulado antes de responder.
  function aplicarNoCanal(req, c) {
    const b = req.body || {};
    if (b.uso === undefined && b.atendimento_empresa_id === undefined && b.setor_padrao_id === undefined) return;
    if ((b.uso !== undefined || b.atendimento_empresa_id !== undefined) && !plataforma(req)) {
      throw erro('sem_permissao', 'Só a administração da plataforma muda o uso do número e a empresa que atende.');
    }
    const uso = b.uso ?? c.uso;
    if (!USOS_CANAL.includes(uso)) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { uso: `Use ${USOS_CANAL.join(', ')}.` } });
    if (uso === 'integracao') { Object.assign(c, { uso, atendimento: null }); return; }
    const empresaId = b.atendimento_empresa_id ?? c.atendimento?.empresa?.id ?? c.empresa_dona.id;
    const vinculada = c.empresas_vinculadas.find(v => v.id === empresaId);
    if (!vinculada) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { atendimento_empresa_id: 'Escolha uma empresa vinculada a este canal.' } });
    if (!plataforma(req) && !(empresaId === sessao.empresaId && rotinas(req).includes(ROTINAS.setores))) {
      throw erro('sem_permissao', 'Só quem cadastra os setores da empresa que atende escolhe o setor padrão.');
    }
    const setorId = b.setor_padrao_id ?? (c.atendimento?.empresa?.id === empresaId ? c.atendimento?.setor_padrao?.id : undefined);
    const setor = at.setores.find(s => s.id === setorId && s.empresa_id === empresaId && s.situacao === 'ativo');
    if (!setor) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { setor_padrao_id: 'Escolha o setor ativo que recebe as conversas novas.' } });
    Object.assign(c, { uso, atendimento: { empresa: { id: vinculada.id, nome: vinculada.nome }, setor_padrao: { id: setor.id, nome: setor.nome } } });
    auditar('canal.uso', `Canal ${c.nome}: uso ${uso}, conversas novas no setor ${setor.nome}`);
  }

  function socket(sock) {
    sock.on(C.assinarAtendimento, () => {
      sock.join('atendimento');
      sock.emit(S.contadoresAtendimento, contadores());
    });
    sock.on(C.assinarConversa, ({ conversa_id } = {}) => {
      const cv = at.conversas.find(x => x.id === conversa_id);
      if (!cv || !podeVer(null, cv)) return sock.emit(S.erro, { codigo: 'nao_encontrado', mensagem: 'Conversa não encontrada.' });
      sock.join(salaConversa(cv.id));
    });
    sock.on(C.sairConversa, ({ conversa_id } = {}) => sock.leave(salaConversa(conversa_id)));
  }

  // A Central "viva": de tempos em tempos um contato escreve (0 = desligado).
  const timers = [];
  if (intervaloConversaMs > 0) {
    let vez = 0;
    timers.push(setInterval(() => {
      const [ic, texto] = CHEGADAS[vez++ % CHEGADAS.length];
      receber(at.contatos[ic], texto);
    }, intervaloConversaMs));
    timers.forEach(t => t.unref());
  }

  return { rotas, rotasV1, aplicarNoCanal, socket, receber, parar: () => timers.forEach(clearInterval) };
}

module.exports = { criarAtendimentoSimulado };
