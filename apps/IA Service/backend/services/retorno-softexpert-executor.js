const crypto = require('crypto');
const repository = require('../repositories/retorno-softexpert-repository');
const soapClient = require('./softexpert-soap-client');
const { mapearCampos } = require('./retorno-softexpert-config');

function criarExecutor({ repo = repository, soap = soapClient, resolverOid, sincronizar }) {
  async function executar({ tentativaId, config, chamado, consultor, campos, arquivos, validarAutorizacao = () => {} }) {
    const manifesto = arquivos.map((f) => ({ hash: crypto.createHash('sha256').update(f.buffer).digest('hex'), nome: f.originalname, tamanho: f.size }));
    // Serializa por tentativa no banco, inclusive entre processos. Um envio interrompido nunca é retomado cegamente.
    let state = repo.adquirir(tentativaId, config.contratoHash, manifesto);
    const snapshot = () => resultado({ ...repo.obter(tentativaId), em_processamento: 0 });
    try {
      repo.atualizar(tentativaId, { fonte_id: chamado.fonteId, numero_chamado: chamado.numero });
      const contrato = config.contrato;
      if (contrato.historico?.modo === 'comentario_validado' && state.status_historico === 'desabilitado') repo.atualizar(tentativaId, { status_historico: 'pendente' });
      const xmlGrid = soap.montarInclusaoGrid({ workflowId: chamado.numero, mainEntityId: contrato.mainEntityId, childRelationshipId: contrato.childRelationshipId, campos: mapearCampos(campos, contrato, { chamado, consultor, instante: state.criado_em }) });
      if (['enviando', 'indeterminado'].includes(state.status_posicionamento)) return snapshot();
      if (state.status_posicionamento !== 'registrado') {
        validarAutorizacao();
        repo.atualizar(tentativaId, { status_posicionamento: 'enviando' });
        repo.evento(tentativaId, 'posicionamento', 'enviando');
        let resposta;
        try { resposta = await soap.enviarOperacao({ ...config.transporte, xml: xmlGrid, operacao: 'newChildEntityRecord' }); }
        catch (_) {
          repo.atualizar(tentativaId, { status_posicionamento: 'indeterminado' });
          repo.evento(tentativaId, 'posicionamento', 'indeterminado');
          return snapshot();
        }
        if (resposta.Status !== 'SUCCESS' || resposta.Code !== '1') {
          repo.atualizar(tentativaId, { status_posicionamento: 'falhou' });
          repo.evento(tentativaId, 'posicionamento', 'falhou');
          return snapshot();
        }
        repo.atualizar(tentativaId, { status_posicionamento: 'registrado', posicionamento_chave: resposta.RecordKey || null });
        repo.evento(tentativaId, 'posicionamento', 'registrado');
      }
      state = repo.obter(tentativaId);
      if (arquivos.length && !state.posicionamento_oid) {
        try {
          const oid = await resolverOid({ chamado, recordKey: state.posicionamento_chave });
          if (oid) repo.atualizar(tentativaId, { posicionamento_oid: oid });
        } catch (_) { /* Inclusão já confirmada: falha de leitura não autoriza recriar o posicionamento. */ }
      }
      state = repo.obter(tentativaId);
      for (const anexo of state.anexos) {
        if (anexo.status === 'registrado' || ['enviando', 'indeterminado'].includes(anexo.status)) continue;
        if (!state.posicionamento_oid) break;
        const file = arquivos[anexo.indice];
        const contentId = contrato.anexos.transporte === 'cid_multipart' ? `arquivo-${anexo.id}@iahub` : undefined;
        const xml = soap.montarInclusaoAnexo({ ...contrato.anexos, posicionamentoOid: state.posicionamento_oid, nome: file.originalname, conteudo: file.buffer, userId: config.userId, contentId });
        validarAutorizacao();
        repo.atualizarAnexo(anexo.id, 'enviando');
        repo.evento(tentativaId, `anexo:${anexo.indice}`, 'enviando');
        try {
          const response = await soap.enviarOperacao({ ...config.transporte, xml, operacao: 'newTableRecord', anexosSoap: contentId ? [{ contentId, conteudo: file.buffer }] : [] });
          const ok = response.Status === 'SUCCESS' && response.Code === '1';
          const status = ok ? (response.RecordID ? 'registrado' : 'indeterminado') : 'falhou';
          repo.atualizarAnexo(anexo.id, status, ok ? response.RecordID || null : null);
          repo.evento(tentativaId, `anexo:${anexo.indice}`, status);
        } catch (_) {
          repo.atualizarAnexo(anexo.id, 'indeterminado');
          repo.evento(tentativaId, `anexo:${anexo.indice}`, 'indeterminado');
        }
      }
      state = repo.obter(tentativaId);
      repo.atualizar(tentativaId, { status_anexos: !state.anexos.length ? 'sem_anexos' : state.anexos.every((a) => a.status === 'registrado') ? 'registrados' : 'parcial' });
      const historico = contrato.historico || { modo: 'desabilitado' };
      if (historico.modo === 'automatico_validado') {
        repo.atualizar(tentativaId, { status_historico: 'automatico_previsto' });
      } else if (historico.modo === 'comentario_validado' && !['registrado', 'enviando', 'indeterminado'].includes(state.status_historico)) {
        const xml = soap.montarComentario({ workflowId: chamado.numero, texto: campos.DESCRICAO, activityId: historico.activityId, privado: historico.privado });
        validarAutorizacao();
        repo.atualizar(tentativaId, { status_historico: 'enviando' });
        repo.evento(tentativaId, 'historico', 'enviando');
        try {
          const response = await soap.enviarOperacao({ ...config.transporte, xml, operacao: 'newComment' });
          const status = response.Status === 'SUCCESS' && response.Code === '1' ? 'registrado' : 'falhou';
          repo.atualizar(tentativaId, { status_historico: status });
          repo.evento(tentativaId, 'historico', status);
        } catch (_) {
          repo.atualizar(tentativaId, { status_historico: 'indeterminado' });
          repo.evento(tentativaId, 'historico', 'indeterminado');
        }
      }
      try {
        await sincronizar(chamado);
        repo.atualizar(tentativaId, { sincronizacao_status: 'atualizado' });
      } catch (_) {
        repo.atualizar(tentativaId, { sincronizacao_status: 'pendente' });
      }
      return snapshot();
    } finally { repo.liberar(tentativaId); }
  }
  return { executar };
}

function resultado(state) {
  const posOk = state.status_posicionamento === 'registrado';
  const incerto = ['enviando', 'indeterminado'].includes(state.status_posicionamento) || state.anexos.some((a) => ['enviando', 'indeterminado'].includes(a.status)) || ['enviando', 'indeterminado'].includes(state.status_historico);
  const anexosOk = state.anexos.every((a) => a.status === 'registrado');
  const histOk = ['desabilitado', 'automatico_previsto', 'registrado'].includes(state.status_historico);
  const status = incerto ? 'indeterminado' : posOk && anexosOk && histOk ? 'registrado' : posOk ? 'parcial' : 'falhou';
  return {
    status, tentativaId: state.id, posicionamento: state.status_posicionamento,
    emProcessamento: !!state.em_processamento,
    anexos: state.status_anexos, historico: state.status_historico, sincronizacao: state.sincronizacao_status,
    arquivos: state.anexos.map((a) => ({ indice: a.indice, nome: a.nome, status: a.status })),
    podeRetomar: !incerto && !state.em_processamento && status !== 'registrado',
    mensagem: incerto ? 'O resultado de uma operação não foi confirmado. Não reenvie: consulte a tentativa e reconcilie o registro no SoftExpert.' : status === 'parcial' ? 'Posicionamento registrado. Há etapas pendentes; retome esta mesma tentativa, sem criar outro posicionamento.' : status === 'registrado' ? 'Posicionamento registrado. Confira os estados dos anexos e do histórico.' : 'O SoftExpert não confirmou a inclusão do posicionamento.',
  };
}

module.exports = { criarExecutor, resultado };
