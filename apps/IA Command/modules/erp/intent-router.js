const DatasetEngine = require('./dataset-query-engine');
const crud          = require('../database/crud');

async function rotear(intent, empresaId) {
  if (intent.intencao === 'desconhecido') {
    return { tipo: 'desconhecido', mensagem: intent._erro || 'Nao entendi sua pergunta. Pode reformular?' };
  }

  if (intent.precisa_confirmacao || intent._baixaConfianca) {
    return {
      tipo: 'desconhecido',
      subtipo: 'confirmacao_necessaria',
      mensagem: intent._erro || 'Entendi parcialmente sua pergunta, mas preciso que voce confirme o indicador, periodo ou filtro antes de consultar o ERP.',
    };
  }

  // Localiza a intencao cadastrada para esta empresa com o nome retornado pela IA.
  const registros = crud.listar('intentions', { empresa_id: empresaId, nome: intent.intencao });
  const registro  = registros.find(r => r.ativo !== 0);

  if (!registro) {
    return {
      tipo: 'erro',
      subtipo: 'sem_intencao',
      mensagem: `Intencao "${intent.intencao}" nao esta cadastrada para esta empresa. Configure-a no painel de Intencoes.`,
    };
  }

  if (!registro.dataset_id) {
    return {
      tipo: 'erro',
      mensagem: `A intencao "${intent.intencao}" nao tem um dataset vinculado. Vincule um dataset no painel de Intencoes.`,
    };
  }

  const dataset = crud.buscarPorId('datasets', registro.dataset_id);
  if (!dataset || dataset.empresa_id !== empresaId) {
    return { tipo: 'erro', mensagem: 'Dataset vinculado nao encontrado.' };
  }

  const resultado = await DatasetEngine.executar(intent, dataset, empresaId);
  return { tipo: 'sucesso', dataset_id: dataset.id, dataset_nome: dataset.nome, ...resultado };
}

module.exports = { rotear };
