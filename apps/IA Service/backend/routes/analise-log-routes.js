'use strict';

const fs = require('node:fs/promises');
const multer = require('multer');
const analise = require('../services/analise-log-service');
const chamadoRepo = require('../repositories/chamado-repository');
const atendimentoRepo = require('../repositories/atendimento-repository');
const anexoRepo = require('../repositories/anexo-repository');
const armazenamento = require('../services/armazenamento-anexos');
const softExpert = require('../services/anexos-softexpert-service');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: analise.MAX_BYTES, files: 1, fields: 0 } });
const ativos = new Set();

function contexto(empresaId, chamadoId) {
  const chamado = chamadoRepo.getChamado(empresaId, chamadoId);
  if (!chamado) throw Object.assign(new Error('Chamado não encontrado.'), { status: 404 });
  const atendimento = atendimentoRepo.getAtendimentoPorReferencia(empresaId, {
    origem: chamado.sistemaOrigem || 'softexpert', referenciaExterna: chamado.numero,
  });
  return { chamado, atendimento };
}

function falha(res, err) {
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Não foi possível processar o log. Tente novamente.' });
}

module.exports = function registrar(app, prefixo) {
  // Ambos os namespaces já aplicam suas guardas de sessão e empresa. O
  // prefixo /radar também recebe a rotina svc-radar no acesso interno.
  const base = `${prefixo}/radar/logs`;
  app.use(base, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
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
    const chave = String(req.svcEmpresaId);
    if (ativos.has(chave)) return res.status(429).json({ error: 'Há outra análise de log em andamento nesta empresa. Aguarde a conclusão.' });
    ativos.add(chave);
    try {
      const arquivo = await carregar();
      const grupoId = req.query.grupoId || null;
      if (grupoId && (typeof grupoId !== 'string' || !/^erro-(?:[1-9]\d?|100)$/.test(grupoId))) throw Object.assign(new Error('Grupo de erro inválido.'), { status: 400 });
      const resultado = await analise.analisarBuffer(req.svcEmpresaId, arquivo.buffer, arquivo.nome, {}, grupoId);
      res.json({ ...resultado, origem: arquivo.origem });
    } catch (err) { falha(res, err); }
    finally { ativos.delete(chave); }
  }

  app.post(`${base}/avulso`, (req, res) => {
    upload.single('arquivo')(req, res, err => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'O arquivo excede o limite de 20 MB.' : 'Envie apenas um arquivo .log ou .log.txt, de até 20 MB.' });
      if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo .log ou .log.txt.' });
      return executar(req, res, async () => ({ buffer: req.file.buffer, nome: req.file.originalname, origem: { tipo: 'avulso' } }));
    });
  });

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
