// Orquestra a busca de anexos REAIS do sistema de origem (SoftExpert) para
// um chamado — distinto dos uploads feitos pelo próprio analista no chat
// (esses já existem via armazenamento-anexos.js/anexo-repository.js).
//
// routes -> este service -> adapter (listarAnexosDoChamado) -> Agente Local.
// Nunca grava nada no SQLite: busca ao vivo a cada chamada (o binário não
// é cacheado localmente — evita duplicar armazenamento de arquivo grande
// que já existe na origem).

const chamadoRepo = require('../repositories/chamado-repository');
const agenteRepo = require('../repositories/agente-local-repository');
const anexoRepo = require('../repositories/anexo-repository');
const armazenamento = require('./armazenamento-anexos');
const extracaoConteudo = require('./extracao-conteudo');
const { resolverAdapter } = require('./import/adapters');
const fs = require('fs');
const path = require('path');

const LIMITE_TAMANHO_BYTES = 25 * 1024 * 1024; // 25MB — mesmo teto de anexo já usado em armazenamento-anexos.js
const SISTEMA_ORIGEM = 'softexpert';

function _mimeTypePorExtensao(extensao) {
  const ext = String(extensao || '').toLowerCase().replace(/^\./, '');
  const MAPA = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf', txt: 'text/plain', log: 'text/plain', csv: 'text/csv',
    xml: 'application/xml', json: 'application/json',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    zip: 'application/zip',
  };
  return MAPA[ext] || 'application/octet-stream';
}

/**
 * Resolve chamado -> fonte -> adapter e busca os anexos BRUTOS (com FLDATA
 * em base64) na origem. Ponto único de acesso ao adapter — listarAnexosDoChamado,
 * baixarAnexo e sincronizarAnexosParaAtendimento reaproveitam esta função em
 * vez de duplicar a resolução de fonte/adapter cada uma.
 */
async function _buscarAnexosBrutos(empresaId, chamadoId) {
  const chamado = chamadoRepo.getChamado(empresaId, chamadoId);
  if (!chamado) throw new Error('Chamado não encontrado.');

  const fonte = agenteRepo.getFonte(empresaId, chamado.fonteId);
  if (!fonte) throw new Error('Fonte histórica do chamado não encontrada.');

  const adapter = resolverAdapter(fonte.adapter);
  if (typeof adapter.listarAnexosDoChamado !== 'function') {
    return { chamado, anexosBrutos: [] }; // adapter não suporta anexos — lista vazia, não é erro
  }

  const anexosBrutos = await adapter.listarAnexosDoChamado(empresaId, fonte, chamado.numero);
  return { chamado, anexosBrutos };
}

/**
 * Decodifica e valida um anexo bruto (mesmo guard de integridade usado em
 * baixarAnexo) — extraído para reuso em sincronizarAnexosParaAtendimento.
 * Lança se o conteúdo vier corrompido/incompleto (Agente Local desatualizado).
 */
function _decodificarEValidar(bruto) {
  if (!bruto.FLDATA) throw new Error('Anexo sem conteúdo binário retornado pelo Agente Local.');

  const buffer = Buffer.from(bruto.FLDATA, 'base64');
  if (buffer.length > LIMITE_TAMANHO_BYTES) {
    throw new Error(`Anexo excede o limite de ${LIMITE_TAMANHO_BYTES / (1024 * 1024)}MB.`);
  }
  // Guard confiável contra Agente Local desatualizado: SEBLOB.NRSIZE já traz
  // o tamanho real do binário original — se o Buffer decodificado não bate
  // (nem aproximadamente) com isso, o FLDATA não veio em base64 de verdade
  // (sintoma confirmado em 2026-09: agente antigo devolve a representação
  // textual Python de bytes, ex. "b'\xff\xd8...'", que ainda decodifica como
  // base64 SINTATICAMENTE válido mas produz um buffer minúsculo e sem
  // sentido — daí não dar para confiar só em "buffer não vazio"). Tolerância
  // de 10% para a própria natureza do base64 (overhead ~33%) e possíveis
  // diferenças de metadado vs. conteúdo real.
  const tamanhoEsperado = Number(bruto.NRSIZE) || null;
  if (tamanhoEsperado && Math.abs(buffer.length - tamanhoEsperado) > tamanhoEsperado * 0.1) {
    throw new Error(`Conteúdo do anexo veio incompleto ou corrompido (esperado ~${tamanhoEsperado} bytes, recebido ${buffer.length}) — verifique se o Agente Local está atualizado (conversão de campo binário para base64).`);
  }
  if (buffer.length < 16) {
    throw new Error('Conteúdo do anexo veio vazio ou corrompido — verifique se o Agente Local está atualizado (conversão de campo binário para base64).');
  }

  return buffer;
}

function _arquivoLocalIntegro(anexo) {
  if (!anexo?.caminhoRelativo) return false;
  try {
    const caminho = path.join(armazenamento.ANEXOS_DIR, anexo.caminhoRelativo);
    const stat = fs.statSync(caminho);
    return !!stat.size && (!anexo.tamanho || Math.abs(stat.size - anexo.tamanho) <= Math.max(16, anexo.tamanho * 0.02));
  } catch (_) {
    return false;
  }
}

/**
 * Lista metadados dos anexos do chamado (sem o binário — leve, para exibir
 * chips/lista no chat). `origem` distingue de qual das três fontes do
 * SoftExpert veio (ver softexpert-sqlserver-adapter.js:listarAnexosDoChamado)
 * — informativo, não muda o comportamento de download.
 */
async function listarAnexosDoChamado(empresaId, chamadoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!chamadoId) throw new Error('chamadoId é obrigatório.');

  const { anexosBrutos } = await _buscarAnexosBrutos(empresaId, chamadoId);

  return anexosBrutos.map(a => ({
    oid: a.OID,
    nome: a.NMNAME || `anexo.${a.IDEXTENSION || 'bin'}`,
    extensao: a.IDEXTENSION || null,
    tamanho: Number(a.NRSIZE) || null,
    origem: a.origem,
    referenciaOid: a.OID_REFERENCIA || null,
    referenciaData: a.DATA_REFERENCIA || null,
    referenciaAutor: a.AUTOR_REFERENCIA || null,
    mimeType: _mimeTypePorExtensao(a.IDEXTENSION),
  }));
}

/**
 * Busca UM anexo específico (por OID do SEBLOB) já decodificado para
 * Buffer, pronto para servir via HTTP. Reexecuta a mesma query de listagem
 * (não há cache) e filtra pelo OID pedido — simples e correto para o volume
 * baixo de anexos por chamado confirmado nos dados reais (1-3 por chamado).
 */
async function baixarAnexo(empresaId, chamadoId, anexoOid) {
  if (!anexoOid) throw new Error('anexoOid é obrigatório.');

  const { anexosBrutos } = await _buscarAnexosBrutos(empresaId, chamadoId);
  const encontrado = anexosBrutos.find(a => a.OID === anexoOid);
  if (!encontrado) throw new Error('Anexo não encontrado neste chamado.');

  const buffer = _decodificarEValidar(encontrado);

  return {
    nome: encontrado.NMNAME || `anexo.${encontrado.IDEXTENSION || 'bin'}`,
    mimeType: _mimeTypePorExtensao(encontrado.IDEXTENSION),
    buffer,
  };
}

/**
 * Sincroniza os anexos do chamado no SoftExpert para o armazenamento local
 * de anexos do atendimento (mesma tabela/pasta em disco que já é usada pelos
 * uploads manuais do consultor) — para que a IA possa recebê-los na análise,
 * exatamente como já recebe qualquer anexo enviado pelo composer (imagem via
 * visão multimodal, texto/PDF/CSV via extração de conteúdo).
 *
 * Idempotente por natureza: usa anexoRepo.listarAnexos para não duplicar um
 * anexo já sincronizado (identificado pelo nome original, único o bastante
 * dentro de um mesmo atendimento — o OID do SEBLOB não é persistido junto,
 * então essa é a chave prática disponível).
 *
 * Só sincroniza tipos que o pipeline de extração/visão já sabe processar
 * (imagem, PDF, texto/CSV/JSON/XML) — Excel/Word/ZIP continuam disponíveis
 * só como download via chip no cabeçalho (armazenamento.MIME_PERMITIDOS não
 * cobre esses tipos hoje; ver anexos-softexpert-service.js linha de mapa de
 * mimeType). Best-effort: falha em UM anexo não impede os outros nem trava
 * a investigação — best-effort documentado, sempre logado.
 */
async function sincronizarAnexosParaAtendimento(empresaId, chamadoId, atendimentoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!chamadoId) throw new Error('chamadoId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');

  const { anexosBrutos } = await _buscarAnexosBrutos(empresaId, chamadoId);
  if (!anexosBrutos.length) return [];

  const anexosLocais = anexoRepo.listarAnexos(empresaId, atendimentoId);
  const porNomeLegado = new Map(anexosLocais.map(a => [a.nomeOriginal, a]));

  const sincronizados = [];
  for (const bruto of anexosBrutos) {
    const nome = bruto.NMNAME || `anexo.${bruto.IDEXTENSION || 'bin'}`;
    const origem = {
      origemSistema: SISTEMA_ORIGEM,
      origemOid: bruto.OID,
      origemTipo: bruto.origem,
      origemReferenciaOid: bruto.OID_REFERENCIA ?? null,
    };
    if (anexoRepo.getAnexoPorOrigem(empresaId, atendimentoId, origem)) continue; // já sincronizado antes — não duplica por OID real

    const legadoMesmoNome = porNomeLegado.get(nome);
    if (legadoMesmoNome && !legadoMesmoNome.origemOid) {
      const vinculado = anexoRepo.vincularOrigem(empresaId, legadoMesmoNome.id, origem);
      if (vinculado) sincronizados.push(vinculado);
      continue;
    }

    const mimeType = _mimeTypePorExtensao(bruto.IDEXTENSION);
    if (!armazenamento.MIME_PERMITIDOS.has(mimeType)) continue; // tipo não suportado pelo pipeline (Excel/Word/ZIP) — fica só como download

    try {
      const buffer = _decodificarEValidar(bruto);
      const extraido = await extracaoConteudo.extrairConteudo({ buffer, nomeOriginal: nome, mimeDeclarado: mimeType });

      const anexo = armazenamento.salvarAnexo(empresaId, atendimentoId, {
        nomeOriginal: nome,
        mimeType: extraido.mimeReal,
        tamanho: buffer.length,
        conteudo: buffer,
        usuarioId: null,
        ...origem,
      });

      const anexoAtualizado = anexoRepo.atualizarExtracao(empresaId, anexo.id, {
        conteudoExtraido: extraido.conteudoExtraido,
        linguagemDetectada: extraido.linguagemDetectada,
        encodingDetectado: extraido.encodingDetectado,
        eCodigo: extraido.eCodigo,
      });

      sincronizados.push(anexoAtualizado);
    } catch (err) {
      console.error(`[IA Service] Falha ao sincronizar anexo "${nome}" do SoftExpert (chamado ${chamadoId}):`, err.message);
    }
  }

  return sincronizados;
}

async function sincronizarAnexosParaAtendimentoComReparo(empresaId, chamadoId, atendimentoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!chamadoId) throw new Error('chamadoId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');

  const { anexosBrutos } = await _buscarAnexosBrutos(empresaId, chamadoId);
  if (!anexosBrutos.length) return [];

  const anexosLocais = anexoRepo.listarAnexos(empresaId, atendimentoId);
  const porNomeLegado = new Map(anexosLocais.map(a => [a.nomeOriginal, a]));

  const sincronizados = [];
  for (const bruto of anexosBrutos) {
    const nome = bruto.NMNAME || `anexo.${bruto.IDEXTENSION || 'bin'}`;
    const origem = {
      origemSistema: SISTEMA_ORIGEM,
      origemOid: bruto.OID,
      origemTipo: bruto.origem,
      origemReferenciaOid: bruto.OID_REFERENCIA ?? null,
    };

    const existentePorOrigem = anexoRepo.getAnexoPorOrigem(empresaId, atendimentoId, origem);
    if (existentePorOrigem && _arquivoLocalIntegro(existentePorOrigem)) continue;

    const legadoMesmoNome = porNomeLegado.get(nome);
    if (!existentePorOrigem && legadoMesmoNome && !legadoMesmoNome.origemOid && _arquivoLocalIntegro(legadoMesmoNome)) {
      const vinculado = anexoRepo.vincularOrigem(empresaId, legadoMesmoNome.id, origem);
      if (vinculado) sincronizados.push(vinculado);
      continue;
    }

    const mimeType = _mimeTypePorExtensao(bruto.IDEXTENSION);
    if (!armazenamento.MIME_PERMITIDOS.has(mimeType)) continue;

    try {
      const buffer = _decodificarEValidar(bruto);
      const extraido = await extracaoConteudo.extrairConteudo({ buffer, nomeOriginal: nome, mimeDeclarado: mimeType });

      if (existentePorOrigem || (legadoMesmoNome && !legadoMesmoNome.origemOid)) {
        const alvo = existentePorOrigem || anexoRepo.vincularOrigem(empresaId, legadoMesmoNome.id, origem);
        const atualizado = armazenamento.substituirArquivoAnexo(empresaId, atendimentoId, alvo, {
          nomeOriginal: nome,
          mimeType: extraido.mimeReal,
          tamanho: buffer.length,
          conteudo: buffer,
          conteudoExtraido: extraido.conteudoExtraido,
          linguagemDetectada: extraido.linguagemDetectada,
          encodingDetectado: extraido.encodingDetectado,
          eCodigo: extraido.eCodigo,
        });
        if (atualizado) sincronizados.push(atualizado);
        continue;
      }

      const anexo = armazenamento.salvarAnexo(empresaId, atendimentoId, {
        nomeOriginal: nome,
        mimeType: extraido.mimeReal,
        tamanho: buffer.length,
        conteudo: buffer,
        usuarioId: null,
        ...origem,
      });

      const anexoAtualizado = anexoRepo.atualizarExtracao(empresaId, anexo.id, {
        conteudoExtraido: extraido.conteudoExtraido,
        linguagemDetectada: extraido.linguagemDetectada,
        encodingDetectado: extraido.encodingDetectado,
        eCodigo: extraido.eCodigo,
      });

      sincronizados.push(anexoAtualizado);
    } catch (err) {
      console.error(`[IA Service] Falha ao sincronizar anexo "${nome}" do SoftExpert (chamado ${chamadoId}):`, err.message);
    }
  }

  return sincronizados;
}

module.exports = {
  listarAnexosDoChamado,
  baixarAnexo,
  sincronizarAnexosParaAtendimento: sincronizarAnexosParaAtendimentoComReparo,
};
