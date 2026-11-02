// Limpeza das cópias de anexos do SoftExpert em chamados encerrados (LGPD e
// espaço em disco). Decisão do usuário, 2026-11-02: o original continua no
// SoftExpert e volta a ser copiado se o chamado for reaberto e o anexo usado.
//
// Apaga o arquivo e o texto extraído; mantém o registro (nome, tamanho e
// origem), referenciado pelo dossiê e pelas validações. Não toca em anexos
// enviados pelo chat, que só existem aqui. A base de conhecimento usa o texto
// de chamados e posicionamentos, nunca anexos.
//
// O prazo conta da última movimentação do chamado (último posicionamento):
// atualizado_origem_em marca a importação local, não o encerramento.
// Modo padrão: só simula. Apaga apenas com SVC_LIMPEZA_ANEXOS_MODO=apagar.

const fs = require('fs');
const path = require('path');
const { getDB } = require('../database');
const anexoRepo = require('../repositories/anexo-repository');
const armazenamento = require('./armazenamento-anexos');

const PRAZO_PADRAO_DIAS = 15;
const PRIMEIRA_EXECUCAO_MS = 10 * 60 * 1000;
const INTERVALO_MS = 24 * 60 * 60 * 1000;

function configuracao() {
  return {
    modo: process.env.SVC_LIMPEZA_ANEXOS_MODO === 'apagar' ? 'apagar' : 'simular',
    prazoDias: Number(process.env.SVC_LIMPEZA_ANEXOS_PRAZO_DIAS) > 0 ? Number(process.env.SVC_LIMPEZA_ANEXOS_PRAZO_DIAS) : PRAZO_PADRAO_DIAS,
  };
}

function listarCandidatos({ prazoDias = PRAZO_PADRAO_DIAS, agora = new Date() } = {}) {
  const corte = new Date(agora.getTime() - prazoDias * 24 * 60 * 60 * 1000).toISOString();
  const linhas = getDB().prepare(`
    SELECT an.id, an.empresa_id, an.caminho_relativo, an.tamanho, an.nome_original, ch.numero
      FROM anexos an
      JOIN atendimentos at ON at.id = an.atendimento_id AND at.empresa_id = an.empresa_id
      JOIN chamados ch ON ch.empresa_id = at.empresa_id AND ch.numero = at.referencia_externa AND ch.sistema_origem = at.origem
     WHERE an.origem_sistema = 'softexpert'
       AND an.arquivo_removido_em IS NULL
       AND ch.status_encerramento = 'Encerrado'
       AND COALESCE((SELECT MAX(p.data_posicionamento) FROM posicionamentos p WHERE p.chamado_id = ch.id), ch.data_abertura) < ?
     ORDER BY ch.numero
  `).all(corte);
  return { corte, linhas };
}

function _apagarArquivo(caminhoRelativo) {
  if (!caminhoRelativo) return;
  const raiz = path.resolve(armazenamento.ANEXOS_DIR);
  const alvo = path.resolve(raiz, caminhoRelativo);
  // Nunca fora da pasta de anexos, mesmo com caminho adulterado no banco.
  if (!alvo.startsWith(raiz + path.sep)) throw new Error('Caminho de anexo fora da pasta de anexos.');
  try {
    fs.unlinkSync(alvo);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

let _emExecucao = false;

/**
 * Executa a limpeza (ou só a simula). Devolve o resumo; nunca grava o conteúdo
 * dos arquivos em log.
 */
function executar({ modo = configuracao().modo, prazoDias = configuracao().prazoDias, agora = new Date() } = {}) {
  if (_emExecucao) return { ignorado: 'execucao_em_andamento' };
  _emExecucao = true;
  try {
    const { corte, linhas } = listarCandidatos({ prazoDias, agora });
    const resumo = {
      modo, prazoDias, corte,
      anexos: linhas.length,
      bytes: linhas.reduce((s, l) => s + (Number(l.tamanho) || 0), 0),
      chamados: new Set(linhas.map(l => l.numero)).size,
      removidos: 0,
      erros: [],
      exemplos: linhas.slice(0, 10).map(l => `${l.numero}: ${l.nome_original}`),
    };
    if (modo === 'apagar') {
      const quando = agora.toISOString();
      for (const l of linhas) {
        try {
          _apagarArquivo(l.caminho_relativo);
          if (anexoRepo.marcarArquivoRemovido(l.empresa_id, l.id, quando)) resumo.removidos += 1;
        } catch (err) {
          resumo.erros.push({ chamado: l.numero, anexoId: l.id, erro: err.message });
        }
      }
    }
    const mb = (resumo.bytes / (1024 * 1024)).toFixed(1);
    console.log(`[IA Service] Limpeza de anexos de chamados encerrados (${modo}, ${prazoDias} dias): ${resumo.anexos} anexo(s), ${mb} MB, ${resumo.chamados} chamado(s)` +
      (modo === 'apagar' ? `; removidos ${resumo.removidos}, erros ${resumo.erros.length}` : '; nada apagado (simulação)'));
    return resumo;
  } finally {
    _emExecucao = false;
  }
}

function iniciarAgendamento() {
  const rodar = () => {
    try {
      executar();
    } catch (err) {
      console.error('[IA Service] Limpeza de anexos de chamados encerrados falhou:', err.message);
    }
  };
  setTimeout(() => {
    rodar();
    setInterval(rodar, INTERVALO_MS).unref?.();
  }, PRIMEIRA_EXECUCAO_MS).unref?.();
}

module.exports = { executar, listarCandidatos, iniciarAgendamento, configuracao };
