// Orquestra a busca de anexos REAIS do sistema de origem (SoftExpert) para
// um chamado — distinto dos uploads feitos pelo próprio analista no chat
// (esses já existem via armazenamento-anexos.js/anexo-repository.js).
//
// routes -> este service -> adapter (listarAnexosDoChamado) -> Agente Local.
// Cada arquivo passa pelo Agente Local uma vez: a cópia fica nos anexos do
// atendimento (mesma pasta dos uploads do chat) e serve a tela e a IA.

const chamadoRepo = require('../repositories/chamado-repository');
const agenteRepo = require('../repositories/agente-local-repository');
const anexoRepo = require('../repositories/anexo-repository');
const atendimentoRepo = require('../repositories/atendimento-repository');
const armazenamento = require('./armazenamento-anexos');
const extracaoConteudo = require('./extracao-conteudo');
const agenteLocalService = require('./agente-local-service');
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
async function _buscarAnexosBrutos(empresaId, chamadoId, { comConteudo = true, oid = null } = {}) {
  const chamado = chamadoRepo.getChamado(empresaId, chamadoId);
  if (!chamado) throw new Error('Chamado não encontrado.');

  const fonte = agenteRepo.getFonte(empresaId, chamado.fonteId);
  if (!fonte) throw new Error('Fonte histórica do chamado não encontrada.');

  const adapter = resolverAdapter(fonte.adapter);
  if (typeof adapter.listarAnexosDoChamado !== 'function') {
    return { chamado, anexosBrutos: [] }; // adapter não suporta anexos — lista vazia, não é erro
  }

  const brutos = await adapter.listarAnexosDoChamado(empresaId, fonte, chamado.numero, { comConteudo, oid });
  // A origem "workflow" não informa a extensão em coluna: vem do nome do arquivo.
  const anexosBrutos = brutos.map(a => (a.IDEXTENSION ? a : { ...a, IDEXTENSION: (String(a.NMNAME || '').match(/\.([a-z0-9]{1,8})$/i) || [])[1] || null }));
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
  if (!anexo?.caminhoRelativo || anexo.arquivoRemovidoEm) return false;
  try {
    const caminho = path.join(armazenamento.ANEXOS_DIR, anexo.caminhoRelativo);
    const stat = fs.statSync(caminho);
    return !!stat.size && (!anexo.tamanho || Math.abs(stat.size - anexo.tamanho) <= Math.max(16, anexo.tamanho * 0.02));
  } catch (_) {
    return false;
  }
}

function listarAnexosLocaisIndisponiveis(empresaId, atendimentoId) {
  return anexoRepo.listarAnexos(empresaId, atendimentoId)
    .filter(a => !_arquivoLocalIntegro(a))
    .map(a => ({
      id: a.id,
      nome: a.nomeOriginal,
      mimeType: a.mimeType,
      tamanho: a.tamanho,
      origemSistema: a.origemSistema,
      origemOid: a.origemOid,
    }));
}

// Anexo do workflow guardado no banco vem embrulhado num ZIP com um único arquivo
// (confirmado em produção, 2026-11-02: 40 de 40 começam com "PK", até .msg).
// Word/Excel/ZIP de verdade também são ZIP: só desembrulha quando há um único
// arquivo dentro e não é documento Office.
const EXTENSOES_QUE_SAO_ZIP = /\.(zip|docx|xlsx|pptx|odt|ods|odp|jar)$/i;

async function _desembrulharZipUnico(bruto) {
  if (bruto?.origem !== 'workflow' || !bruto.FLDATA || EXTENSOES_QUE_SAO_ZIP.test(bruto.NMNAME || '')) return bruto;
  const buffer = Buffer.from(bruto.FLDATA, 'base64');
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) return bruto;
  let zip;
  try {
    zip = await require('jszip').loadAsync(buffer);
  } catch (_) {
    return bruto;
  }
  const arquivos = Object.values(zip.files).filter(f => !f.dir);
  if (arquivos.length !== 1 || zip.file('[Content_Types].xml')) return bruto;
  // Antes de descompactar: o tamanho declarado não pode estourar o limite.
  if (Number(arquivos[0]._data?.uncompressedSize) > LIMITE_TAMANHO_BYTES) {
    throw new Error(`Anexo excede o limite de ${LIMITE_TAMANHO_BYTES / (1024 * 1024)}MB.`);
  }
  const interno = await arquivos[0].async('nodebuffer');
  if (interno.length > LIMITE_TAMANHO_BYTES) throw new Error(`Anexo excede o limite de ${LIMITE_TAMANHO_BYTES / (1024 * 1024)}MB.`);
  return { ...bruto, FLDATA: interno.toString('base64'), NRSIZE: interno.length };
}

// Vários analistas no mesmo chamado, a cópia antecipada e a pesquisa podem pedir o
// mesmo arquivo ao mesmo tempo: uma única leitura no agente atende todos.
const _leiturasEmAndamento = new Map();

function _lerConteudoUmaVez(empresaId, chamadoId, item) {
  const chave = `${empresaId}:${chamadoId}:${item.OID}`;
  if (!_leiturasEmAndamento.has(chave)) {
    const leitura = (async () => {
      let bruto;
      if (_lidoPelaPasta(empresaId, item)) {
        bruto = await _lerBrutoDaPasta(empresaId, item);
      } else {
        const { anexosBrutos } = await _buscarAnexosBrutos(empresaId, chamadoId, { oid: item.OID });
        bruto = anexosBrutos.find(a => a.OID === item.OID);
        if (!bruto) throw new Error('Anexo não encontrado neste chamado.');
        if (_lidoPelaPasta(empresaId, bruto)) bruto = await _lerBrutoDaPasta(empresaId, bruto);
      }
      if (!bruto?.FLDATA) throw new Error('Anexo sem conteúdo retornado pelo Agente Local.');
      return _desembrulharZipUnico(bruto);
    })();
    _leiturasEmAndamento.set(chave, leitura);
    leitura.finally(() => _leiturasEmAndamento.delete(chave)).catch(() => {});
  }
  return _leiturasEmAndamento.get(chave);
}

function _cdfileDoOid(oid) {
  return (String(oid || '').match(/^wf-(\d+)$/) || [])[1] || null;
}

// Anexo do workflow gravado fora do banco: vem da pasta configurada no Agente Local.
function _lidoPelaPasta(empresaId, bruto) {
  return Number(bruto.CONTEUDO_ACESSIVEL) === 0 && !!_cdfileDoOid(bruto.OID) && !!agenteLocalService.getPastaArquivos(empresaId);
}

async function _lerBrutoDaPasta(empresaId, bruto) {
  const arquivo = await agenteLocalService.lerArquivoDaPasta(empresaId, { cdfile: _cdfileDoOid(bruto.OID), extensao: bruto.IDEXTENSION });
  const extensaoGravada = bruto.IDEXTENSION || (String(arquivo.nomeGravado || '').match(/\.([a-z0-9]{1,8})(\.gz)?$/i) || [])[1] || null;
  const nome = bruto.NMNAME && !bruto.IDEXTENSION && extensaoGravada ? `${bruto.NMNAME}.${extensaoGravada.toLowerCase()}` : bruto.NMNAME;
  // O tamanho vem do conteúdo lido: o gzip já conferiu a integridade no agente.
  return { ...bruto, NMNAME: nome, IDEXTENSION: extensaoGravada, FLDATA: arquivo.conteudoBase64, NRSIZE: arquivo.tamanho, CONTEUDO_ACESSIVEL: 1 };
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

  const { chamado, anexosBrutos } = await _buscarAnexosBrutos(empresaId, chamadoId, { comConteudo: false });
  _adiantarCopias(empresaId, chamado, anexosBrutos);

  return anexosBrutos.map(a => ({
    oid: a.OID,
    nome: a.NMNAME || `anexo.${a.IDEXTENSION || 'bin'}`,
    extensao: a.IDEXTENSION || null,
    tamanho: Number(a.NRSIZE) || null,
    origem: a.origem,
    conteudoAcessivel: Number(a.CONTEUDO_ACESSIVEL) !== 0 || _lidoPelaPasta(empresaId, a),
    referenciaOid: a.OID_REFERENCIA || null,
    referenciaData: a.DATA_REFERENCIA || null,
    referenciaAutor: a.AUTOR_REFERENCIA || null,
    mimeType: _mimeTypePorExtensao(a.IDEXTENSION),
  }));
}

/**
 * Busca UM anexo específico (por OID do SEBLOB) já decodificado para
 * Buffer, pronto para servir via HTTP. Pede à origem só o OID solicitado, dentro
 * do chamado; o find abaixo garante o resultado também em adapter que ignore o
 * filtro.
 */
async function baixarAnexo(empresaId, chamadoId, anexoOid) {
  if (!anexoOid) throw new Error('anexoOid é obrigatório.');
  // O OID vem da URL e agora entra na consulta à origem: fora do formato, nem consulta.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(anexoOid))) throw new Error('Anexo não encontrado neste chamado.');

  // Já copiado: sai do servidor, sem consultar o SoftExpert.
  const chamado = chamadoRepo.getChamado(empresaId, chamadoId);
  const atendimento = chamado ? _atendimentoDoChamado(empresaId, chamado) : null;
  const copia = atendimento ? anexoRepo.getAnexoPorOrigem(empresaId, atendimento.id, { origemSistema: SISTEMA_ORIGEM, origemOid: anexoOid }) : null;
  if (copia && _arquivoLocalIntegro(copia)) {
    return {
      nome: copia.nomeOriginal,
      mimeType: copia.mimeType || _mimeTypePorExtensao((String(copia.nomeOriginal).match(/\.([a-z0-9]{1,8})$/i) || [])[1]),
      buffer: fs.readFileSync(path.join(armazenamento.ANEXOS_DIR, copia.caminhoRelativo)),
    };
  }

  const encontrado = await _lerConteudoUmaVez(empresaId, chamadoId, { OID: anexoOid });

  const buffer = _decodificarEValidar(encontrado);

  // Já buscado para abrir: guarda a cópia para a pesquisa da IA, sem atrasar a tela.
  // Chamado encerrado não tem nova pesquisa: só mostra (a limpeza LGPD apagaria a cópia).
  if (atendimento && chamado.statusEncerramento !== 'Encerrado') {
    _copiarBrutosParaAtendimento(empresaId, chamadoId, atendimento.id, [encontrado])
      .catch(err => console.error(`[IA Service] Falha ao guardar o anexo aberto "${encontrado.NMNAME}" (chamado ${chamadoId}):`, err.message));
  }

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
  return _copiarBrutosParaAtendimento(empresaId, chamadoId, atendimentoId, anexosBrutos);
}

// Uma cópia por vez em cada atendimento: Pesquisar, pré-análise e atualização
// podem disparar juntas, e sem isso o mesmo arquivo era gravado duas vezes.
const _filasDeCopia = new Map();

function _copiarBrutosParaAtendimento(empresaId, chamadoId, atendimentoId, anexosBrutos) {
  const chave = `${empresaId}:${atendimentoId}`;
  const anterior = _filasDeCopia.get(chave) || Promise.resolve();
  const atual = anterior.catch(() => {}).then(() => _copiarBrutosSemConcorrencia(empresaId, chamadoId, atendimentoId, anexosBrutos));
  const fim = atual.catch(() => {});
  _filasDeCopia.set(chave, fim);
  fim.then(() => { if (_filasDeCopia.get(chave) === fim) _filasDeCopia.delete(chave); });
  return atual;
}

function _atendimentoDoChamado(empresaId, chamado) {
  return atendimentoRepo.getAtendimentoPorReferencia(empresaId, {
    origem: chamado.sistemaOrigem || SISTEMA_ORIGEM,
    referenciaExterna: chamado.numero,
  });
}

// Ao abrir um chamado que já tem chat, os anexos que faltam começam a ser
// copiados em segundo plano: quando o analista pesquisar, já estão prontos.
// No máximo 2 chamados por vez no servidor, e cada chamado uma vez por vez.
const ADIANTAR_SIMULTANEOS = 2;
const _adiantando = new Set();

function _adiantarCopias(empresaId, chamado, lista) {
  try {
    if (!chamado || chamado.statusEncerramento === 'Encerrado' || !lista?.length || _adiantando.size >= ADIANTAR_SIMULTANEOS) return;
    const chave = `${empresaId}:${chamado.id}`;
    if (_adiantando.has(chave)) return;
    const atendimento = _atendimentoDoChamado(empresaId, chamado);
    if (!atendimento) return;
    _adiantando.add(chave);
    garantirAnexosParaIA(empresaId, chamado.id, atendimento.id, { listaPronta: lista })
      .catch(err => console.error(`[IA Service] Cópia antecipada de anexos falhou (chamado ${chamado.numero}):`, err.message))
      .finally(() => _adiantando.delete(chave));
  } catch (err) {
    console.error('[IA Service] Cópia antecipada de anexos não iniciada:', err.message);
  }
}

async function _copiarBrutosSemConcorrencia(empresaId, chamadoId, atendimentoId, anexosBrutos) {
  const anexosLocais = anexoRepo.listarAnexos(empresaId, atendimentoId);
  const porNomeLegado = new Map(anexosLocais.map(a => [a.nomeOriginal, a]));

  const sincronizados = [];
  for (const original of anexosBrutos) {
    let bruto = original;
    try {
      bruto = await _desembrulharZipUnico(original);
    } catch (err) {
      console.error(`[IA Service] Falha ao abrir o anexo "${original.NMNAME}" do SoftExpert (chamado ${chamadoId}):`, err.message);
      continue;
    }
    const nome = bruto.NMNAME || `anexo.${bruto.IDEXTENSION || 'bin'}`;
    const origem = {
      origemSistema: SISTEMA_ORIGEM,
      origemOid: bruto.OID,
      origemTipo: bruto.origem,
      origemReferenciaOid: bruto.OID_REFERENCIA ?? null,
    };

    const existentePorOrigem = anexoRepo.getAnexoPorOrigem(empresaId, atendimentoId, origem);
    if (existentePorOrigem && _arquivoLocalIntegro(existentePorOrigem)) continue;
    // Arquivo guardado fora do banco: não há o que copiar (garantirAnexosParaIA avisa).
    if (Number(bruto.CONTEUDO_ACESSIVEL) === 0) continue;

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

const ERRO_SEM_NOVA_TENTATIVA = /não configurad|não encontrad|inativa|sem conteúdo|desatualizado|inacessivel|nao encontrado|invalido|excede/i;

async function _comTentativas(fn, tentativas, esperaMs) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tentativas || ERRO_SEM_NOVA_TENTATIVA.test(err.message)) throw err;
      await new Promise(resolve => setTimeout(resolve, esperaMs * i));
    }
  }
}

/**
 * Garante que a IA receba os anexos do chamado. Primeiro confere só a lista
 * (leve); arquivo com cópia íntegra no servidor não passa de novo pelo Agente
 * Local, e cada arquivo que falta é buscado sozinho, com novas tentativas.
 * Nunca lança: devolve o que faltou para a IA e o analista serem avisados.
 */
const COPIAS_SIMULTANEAS = 2;

async function garantirAnexosParaIA(empresaId, chamadoId, atendimentoId, { tentativas = 3, esperaMs = 800, listaPronta = null } = {}) {
  const resultado = { verificado: true, erro: null, total: 0, copiados: [], faltantes: [] };
  let lista = listaPronta;
  if (!lista) {
    try {
      ({ anexosBrutos: lista } = await _comTentativas(() => _buscarAnexosBrutos(empresaId, chamadoId, { comConteudo: false }), tentativas, esperaMs));
    } catch (err) {
      return { ...resultado, verificado: false, erro: err.message };
    }
  }
  resultado.total = lista.length;

  // Dois arquivos por vez (o agente também limita a 2 leituras de pasta); a
  // ordem dos avisos segue a ordem da lista.
  const porItem = lista.map(() => ({ copiados: [], faltantes: [] }));
  let proximo = 0;
  const trabalhar = async () => {
    while (proximo < lista.length) {
      const indice = proximo++;
      await _garantirItem(empresaId, chamadoId, atendimentoId, lista[indice], porItem[indice], { tentativas, esperaMs });
    }
  };
  await Promise.all(Array.from({ length: Math.min(COPIAS_SIMULTANEAS, lista.length) }, trabalhar));
  for (const parte of porItem) {
    resultado.copiados.push(...parte.copiados);
    resultado.faltantes.push(...parte.faltantes);
  }
  return resultado;
}

async function _garantirItem(empresaId, chamadoId, atendimentoId, item, resultado, { tentativas, esperaMs }) {
  {
    const nome = item.NMNAME || `anexo.${item.IDEXTENSION || 'bin'}`;
    const copiaIntegra = () => {
      const copia = anexoRepo.getAnexoPorOrigem(empresaId, atendimentoId, { origemSistema: SISTEMA_ORIGEM, origemOid: item.OID });
      return copia && _arquivoLocalIntegro(copia) ? copia : null;
    };
    if (copiaIntegra()) return;
    const pelaPasta = _lidoPelaPasta(empresaId, item);
    if (Number(item.CONTEUDO_ACESSIVEL) === 0 && !pelaPasta) { resultado.faltantes.push({ nome, motivo: 'somente_softexpert' }); return; }
    if (!armazenamento.MIME_PERMITIDOS.has(_mimeTypePorExtensao(item.IDEXTENSION))) { resultado.faltantes.push({ nome, motivo: 'tipo_nao_lido' }); return; }
    try {
      const bruto = await _comTentativas(() => _lerConteudoUmaVez(empresaId, chamadoId, item), tentativas, esperaMs);
      const novos = await _copiarBrutosParaAtendimento(empresaId, chamadoId, atendimentoId, [bruto]);
      resultado.copiados.push(...novos);
      if (!copiaIntegra() && !novos.length) resultado.faltantes.push({ nome, motivo: 'falha_copia' });
    } catch (err) {
      console.error(`[IA Service] Anexo "${nome}" não chegou à IA (chamado ${chamadoId}):`, err.message);
      resultado.faltantes.push({ nome, motivo: MOTIVO_FALTANTE[err.codigo] ? err.codigo : 'falha_copia' });
    }
  }
}

const MOTIVO_FALTANTE = {
  somente_softexpert: 'guardado só no SoftExpert',
  tipo_nao_lido: 'tipo de arquivo que a IA não lê',
  falha_copia: 'falha ao obter o arquivo',
  agente_desatualizado: 'Agente Local precisa ser atualizado',
  pasta_inacessivel: 'o Agente Local não acessa a pasta configurada',
  arquivo_nao_encontrado: 'arquivo não encontrado na pasta configurada',
  arquivo_corrompido: 'arquivo corrompido na origem',
  arquivo_grande: 'arquivo acima do limite de 25 MB',
};

// Textos do que faltou: um para o analista ver na resposta, outro para a IA não
// deduzir o conteúdo de um arquivo que não recebeu.
function descreverGarantia(garantia) {
  if (!garantia) return { avisoAnalista: null, avisoIA: null };
  if (!garantia.verificado) {
    return {
      avisoAnalista: `Não foi possível verificar os anexos do SoftExpert nesta análise (${garantia.erro || 'Agente Local indisponível'}). A IA usou só os anexos já copiados.`,
      avisoIA: 'ANEXOS NÃO VERIFICADOS: não foi possível consultar os anexos do chamado nesta análise; pode haver arquivos que você não recebeu. Não afirme que o chamado não tem anexos.',
    };
  }
  if (!garantia.faltantes.length) return { avisoAnalista: null, avisoIA: null };
  const lista = garantia.faltantes.map(f => `${f.nome} (${MOTIVO_FALTANTE[f.motivo] || f.motivo})`).join('; ');
  const quantidade = garantia.faltantes.length === 1 ? '1 anexo' : `${garantia.faltantes.length} anexos`;
  return {
    avisoAnalista: `A IA analisou sem ${quantidade}: ${lista}.`,
    avisoIA: `ANEXOS NÃO LIDOS NESTA ANÁLISE: o chamado tem estes arquivos, mas o conteúdo deles não foi disponibilizado: ${garantia.faltantes.map(f => f.nome).join('; ')}. Não deduza o que eles mostram; se forem necessários, diga ao analista qual arquivo consultar.`,
  };
}

async function sincronizarEValidarAnexosParaAtendimento(empresaId, chamadoId, atendimentoId) {
  const garantia = await garantirAnexosParaIA(empresaId, chamadoId, atendimentoId);
  const indisponiveis = listarAnexosLocaisIndisponiveis(empresaId, atendimentoId);
  return { sincronizados: garantia.copiados, indisponiveis, verificado: garantia.verificado, erro: garantia.erro, faltantes: garantia.faltantes };
}

module.exports = {
  listarAnexosDoChamado,
  baixarAnexo,
  sincronizarAnexosParaAtendimento: sincronizarAnexosParaAtendimentoComReparo,
  sincronizarEValidarAnexosParaAtendimento,
  garantirAnexosParaIA,
  descreverGarantia,
  listarAnexosLocaisIndisponiveis,
  arquivoLocalIntegro: _arquivoLocalIntegro,
};
