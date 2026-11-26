'use strict';

// Aceitar uma mensagem para envio (C3): as mesmas regras para a API v1 e para o
// envio de teste da tela. Só grava na fila; quem envia é o despachante.

const { erro } = require('../erros');
const telefone = require('../seguranca/telefone');
const repo = require('./repositorio');
const regras = require('../canais/regras');

const TEXTO_MAXIMO = 4096;
const CORRELACAO_MAXIMA = 128;
const METADADOS_MAXIMO_BYTES = 4096;

function aceitarEnvio(db, { empresaId, canalId, para, tipo = 'texto', texto, origem, aplicacaoId = null, usuarioId = null,
  correlacaoId = null, metadados = {}, exigirConectado = false }) {
  const canal = db.prepare('SELECT * FROM canais WHERE id = ?').get(String(canalId || ''));
  if (!canal) throw erro('nao_encontrado', 'Canal não encontrado.');
  const usaCanal = canal.empresa_dona_id === empresaId
    || db.prepare('SELECT 1 FROM canal_empresas WHERE canal_id = ? AND empresa_id = ?').get(canal.id, empresaId);
  if (!usaCanal) throw erro('canal_nao_autorizado', 'Sua empresa não usa este canal.');

  if (tipo !== 'texto') {
    throw erro('recurso_nao_suportado', 'Por enquanto o IA Talk envia só texto. Imagem, documento e áudio chegam na próxima etapa.');
  }
  const campos = {};
  const corpo = String(texto ?? '').trim();
  if (!corpo) campos.texto = 'Escreva a mensagem.';
  else if (corpo.length > TEXTO_MAXIMO) campos.texto = `Use no máximo ${TEXTO_MAXIMO} caracteres.`;
  if (!telefone.valido(para)) campos.para = 'Informe o número com DDI e DDD (ex.: +5565999990000).';
  if (correlacaoId !== null && String(correlacaoId).length > CORRELACAO_MAXIMA) campos.correlacao_id = `Use no máximo ${CORRELACAO_MAXIMA} caracteres.`;
  if (metadados !== null && (typeof metadados !== 'object' || Array.isArray(metadados))) campos.metadados = 'Use um objeto JSON.';
  else if (Buffer.byteLength(JSON.stringify(metadados || {})) > METADADOS_MAXIMO_BYTES) campos.metadados = 'Metadados acima de 4 KB.';
  if (Object.keys(campos).length) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos });

  if (canal.envio_modo === 'desligado') throw erro('envio_desligado', 'O envio está desligado neste canal. A administração da plataforma liga quando for liberado.');
  if (!canal.ligado) throw erro('canal_desconectado', 'O canal está parado. Conecte-o antes de enviar.');
  if (exigirConectado && canal.estado !== 'conectado') throw erro('canal_desconectado', 'Conecte o canal antes de enviar.');

  const destino = telefone.normalizar(para);
  if (!regras.podeEnviarPara(canal, destino)) {
    throw erro('sem_permissao', 'Este canal envia só para os números de teste da lista.', { campos: { para: 'Fora da lista de teste.' } });
  }

  return repo.criar(db, {
    empresaId, canalId: canal.id, aplicacaoId, usuarioId, origem, destino, tipo, conteudo: corpo,
    correlacaoId: correlacaoId === null ? null : String(correlacaoId), metadados: metadados || {},
    detalhe: origem === 'teste_tela' ? 'Envio de teste pela tela.' : null,
  });
}

module.exports = { aceitarEnvio, TEXTO_MAXIMO };
