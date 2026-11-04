'use strict';

const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const multer = require('multer');
const analise = require('../services/analise-log-service');
const chamadoRepo = require('../repositories/chamado-repository');
const atendimentoRepo = require('../repositories/atendimento-repository');
const anexoRepo = require('../repositories/anexo-repository');
const armazenamento = require('../services/armazenamento-anexos');
const softExpert = require('../services/anexos-softexpert-service');
const historicoRepo = require('../repositories/analise-log-repository');
const pdfService = require('../services/analise-log-pdf-service');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: analise.MAX_BYTES, files: 1, fields: 0 } });
const ativos = new Set();
const MAX_POR_EMPRESA = 2;
const MAX_GLOBAL = 4;

function identidade(req) {
  if (req.svcConsultorExterno != null) return { tipo: 'consultor_externo', id: String(req.svcConsultorExterno) };
  if (req.session?.user_id != null) return { tipo: 'usuario_iahub', id: String(req.session.user_id) };
  throw Object.assign(new Error('Usuário não identificado.'), { status: 401 });
}

function contexto(empresaId, chamadoId) {
  const chamado = chamadoRepo.getChamado(empresaId, chamadoId);
  if (!chamado) throw Object.assign(new Error('Chamado não encontrado.'), { status: 404 });
  const atendimento = atendimentoRepo.getAtendimentoPorReferencia(empresaId, {
    origem: chamado.sistemaOrigem || 'softexpert', referenciaExterna: chamado.numero,
  });
  return { chamado, atendimento };
}

function falha(res, err) {
  if (res.headersSent) {
    if (!res.destroyed && !res.writableEnded) res.end(JSON.stringify({ tipo: 'erro', error: err.status ? err.message : 'Não foi possível processar o log. Tente novamente.' }) + '\n');
    return;
  }
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Não foi possível processar o log. Tente novamente.' });
}

module.exports = function registrar(app, prefixo) {
  // Ambos os namespaces já aplicam suas guardas de sessão e empresa. O
  // prefixo /radar também recebe a rotina svc-radar no acesso interno.
  const base = `${prefixo}/radar/logs`;
  app.use(base, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.post(`${base}/relatorio.pdf`, async (req, res) => {
    try {
      identidade(req);
      const pdf = await pdfService.gerarPdf(req.body);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', 'attachment; filename="analise-log.pdf"');
      res.send(pdf);
    } catch (err) { falha(res, err); }
  });
  app.get(`${base}/historico`, (req, res) => {
    try {
      if (req.query.chamadoId) contexto(req.svcEmpresaId, req.query.chamadoId);
      res.json({ analises: historicoRepo.listar(req.svcEmpresaId, { chamadoId: req.query.chamadoId, avulsos: req.query.avulsos === '1' }) });
    } catch (err) { falha(res, err); }
  });
  app.get(`${base}/historico/:id`, (req, res) => {
    try {
      const entrada = historicoRepo.obter(req.svcEmpresaId, req.params.id);
      if (!entrada) return res.status(404).json({ error: 'Análise não encontrada nesta empresa.' });
      res.json({ ...entrada.resultado, historico: { id: entrada.id, salvo: true, criadoEm: entrada.criadoEm, atualizadoEm: entrada.atualizadoEm, bytesHistorico: entrada.bytesHistorico, autor: entrada.autor, atualizadoPor: entrada.atualizadoPor } });
    } catch (err) { falha(res, err); }
  });
  app.delete(`${base}/historico`, (req, res) => {
    try {
      identidade(req);
      res.json({ excluidas: historicoRepo.excluir(req.svcEmpresaId, req.body?.ids) });
    } catch (err) { falha(res, err); }
  });
  app.get(base, async (req, res) => {
    try {
      const { chamado, atendimento } = contexto(req.svcEmpresaId, req.query.chamadoId);
      const locais = atendimento ? anexoRepo.listarAnexos(req.svcEmpresaId, atendimento.id) : [];
      const arquivos = locais.filter(a => analise.ehNomeLog(a.nomeOriginal)).map(a => ({
        id: a.id, nome: a.nomeOriginal, origem: a.origemSistema === 'softexpert' ? 'Cópia do SoftExpert' : 'Chat IA Service',
        tipo: 'chat', data: a.criadoEm, tamanho: a.tamanho, disponivel: !a.arquivoRemovidoEm,
      }));
      const avisos = [];
      try {
        const remotos = await softExpert.listarAnexosDoChamado(req.svcEmpresaId, chamado.id);
        for (const a of remotos.filter(a => analise.ehNomeLog(a.nome))) arquivos.push({
          id: a.oid, nome: a.nome, origem: 'SoftExpert', tipo: 'softexpert', data: a.referenciaData,
          tamanho: a.tamanho, disponivel: a.conteudoAcessivel !== false,
        });
      } catch (_) { avisos.push('Não foi possível consultar os anexos do SoftExpert. A lista pode estar incompleta.'); }
      res.json({ chamadoId: chamado.id, numero: chamado.numero, arquivos, avisos });
    } catch (err) { falha(res, err); }
  });

  async function executar(req, res, carregar) {
    let autor;
    try { autor = identidade(req); } catch (err) { falha(res, err); return; }
    const empresa = `${req.svcEmpresaId}:`;
    const chave = `${empresa}${autor.tipo}:${autor.id}`;
    if (ativos.has(chave)) return res.status(429).json({ error: 'Você já tem uma operação de log em andamento nesta empresa. Aguarde a conclusão.' });
    if (ativos.size >= MAX_GLOBAL || [...ativos].filter(k => k.startsWith(empresa)).length >= MAX_POR_EMPRESA) {
      return res.status(429).json({ error: 'O limite de análises simultâneas foi atingido. Aguarde uma conclusão e tente novamente.' });
    }
    ativos.add(chave);
    try {
      const streaming = req.query.progresso === '1';
      const enviar = evento => {
        if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(evento) + '\n');
      };
      if (streaming) {
        res.set('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.set('X-Accel-Buffering', 'no');
        res.flushHeaders();
        enviar({ tipo: 'progresso', etapa: 'arquivo' });
      }
      const arquivo = await carregar();
      const historicoId = req.query.historicoId || null;
      const hashArquivo = crypto.createHash('sha256').update(arquivo.buffer).digest('hex');
      if (historicoId) {
        const anterior = historicoRepo.obter(req.svcEmpresaId, historicoId);
        if (!anterior) throw Object.assign(new Error('Análise não encontrada nesta empresa.'), { status: 404 });
        if (anterior.hashArquivo !== hashArquivo) throw Object.assign(new Error('Selecione o mesmo arquivo usado na análise salva.'), { status: 409 });
        const origemAnterior = anterior.resultado.origem;
        if (['tipo', 'chamadoId', 'arquivoId'].some(c => String(origemAnterior?.[c] || '') !== String(arquivo.origem?.[c] || ''))) throw Object.assign(new Error('A origem do arquivo difere da análise salva.'), { status: 409 });
      }
      if (req.query.busca != null) {
        const busca = analise.buscarNoLog(arquivo.buffer, arquivo.nome, req.query.busca);
        if (streaming) { enviar({ tipo: 'resultado', resultado: busca }); res.end(); }
        else res.json(busca);
        return;
      }
      const grupoId = req.query.grupoId || null;
      if (grupoId && (typeof grupoId !== 'string' || !/^erro-(?:[1-9]\d?|100)$/.test(grupoId))) throw Object.assign(new Error('Grupo de erro inválido.'), { status: 400 });
      const resultado = await analise.analisarBuffer(req.svcEmpresaId, arquivo.buffer, arquivo.nome,
        streaming ? { onProgress: (etapa, detalhes = {}) => enviar({ tipo: 'progresso', etapa, ...detalhes }) } : {}, grupoId);
      const relatorio = { ...resultado, origem: arquivo.origem };
      try {
        relatorio.historico = historicoRepo.salvar(req.svcEmpresaId, { resultado: relatorio, hashArquivo, historicoId, autor });
      } catch (_) {
        relatorio.historico = { salvo: false, ...(historicoId ? { id: historicoId } : {}) };
        relatorio.avisos.push('Não foi possível salvar o histórico. Baixe o relatório para preservar este resultado.');
      }
      if (streaming) {
        enviar({ tipo: 'resultado', resultado: relatorio });
        res.end();
      } else res.json(relatorio);
    } catch (err) { falha(res, err); }
    finally { ativos.delete(chave); }
  }

  app.post(`${base}/avulso`, (req, res) => executar(req, res, async () => {
    // Reserva a capacidade antes de receber o arquivo inteiro em memória.
    await new Promise((resolve, reject) => upload.single('arquivo')(req, res, err => {
      if (err) reject(Object.assign(new Error(err.code === 'LIMIT_FILE_SIZE' ? 'O arquivo excede o limite de 20 MB.' : 'Envie apenas um arquivo .log ou .log.txt, de até 20 MB.'), { status: 400 }));
      else resolve();
    }));
    if (!req.file) throw Object.assign(new Error('Selecione um arquivo .log ou .log.txt.'), { status: 400 });
    return { buffer: req.file.buffer, nome: req.file.originalname, origem: { tipo: 'avulso' } };
  }));

  app.post(`${base}/analisar`, (req, res) => executar(req, res, async () => {
    const { chamadoId, tipo, arquivoId } = req.body || {};
    const { chamado, atendimento } = contexto(req.svcEmpresaId, chamadoId);
    let arquivo;
    if (tipo === 'softexpert') {
      arquivo = await softExpert.baixarAnexo(req.svcEmpresaId, chamado.id, arquivoId);
    } else if (tipo === 'chat') {
      const anexo = anexoRepo.getAnexo(req.svcEmpresaId, arquivoId);
      if (!anexo || !atendimento || String(anexo.atendimentoId) !== String(atendimento.id)) {
        throw Object.assign(new Error('Anexo não encontrado neste chamado.'), { status: 404 });
      }
      if (!analise.ehNomeLog(anexo.nomeOriginal)) throw Object.assign(new Error('Selecione um arquivo .log ou .log.txt.'), { status: 400 });
      try {
        const caminho = armazenamento.resolverCaminhoSeguro(anexo.caminhoRelativo);
        const stat = await fs.stat(caminho);
        if (stat.size > analise.MAX_BYTES) throw Object.assign(new Error('O arquivo excede o limite de 20 MB.'), { status: 413 });
        arquivo = { nome: anexo.nomeOriginal, buffer: await fs.readFile(caminho) };
      } catch (err) {
        if (err.status) throw err;
        throw Object.assign(new Error('O arquivo original está indisponível. Selecione a origem SoftExpert ou envie o log avulso.'), { status: 404 });
      }
    } else throw Object.assign(new Error('Origem do arquivo inválida.'), { status: 400 });
    return { ...arquivo, origem: { tipo, chamadoId: chamado.id, numero: chamado.numero, arquivoId } };
  }));
};
