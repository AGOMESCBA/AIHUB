'use strict';
// Seleção reproduzível, sem alterar a origem e sem copiar relatos no relatório.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Module = require('module');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
async function main() {
  const destino = path.join(os.tmpdir(), `iahub-auditoria-${crypto.randomUUID()}.db`);
  const origem = new Database(path.join('apps', 'IA Service', 'data', 'ia-service.db'), { readonly: true, fileMustExist: true });
  await origem.backup(destino); origem.close();
  const database = require('../apps/IA Service/backend/database');
  const log = console.log; console.log = () => {}; try { database.inicializarDB(destino); } finally { console.log = log; }
  const db = database.getDB();
  const atual = require('../apps/IA Service/backend/repositories/chamado-repository');
  const arquivoRepo = path.resolve('apps/IA Service/backend/repositories/chamado-repository.js');
  const codigo = execFileSync('git', ['show', 'HEAD:apps/IA Service/backend/repositories/chamado-repository.js'], { encoding: 'utf8' });
  const anterior = new Module(arquivoRepo + '.baseline', module); anterior.filename = arquivoRepo; anterior.paths = Module._nodeModulePaths(path.dirname(arquivoRepo)); anterior._compile(codigo, arquivoRepo);
  const texto = "lower(coalesce(titulo,'') || ' ' || coalesce(descricao,'') || ' ' || coalesce(assunto,''))";
  const criterios = [
    ['erro ou código', `${texto} LIKE '%erro%'`, 'DESC'],
    ['API ou integração', `${texto} LIKE '%api%'`, 'DESC'],
    ['rotina técnica', `${texto} LIKE '%rotina%'`, 'ASC'],
    ['customização', `${texto} LIKE '%custom%'`, 'ASC'],
    ['configuração', `${texto} LIKE '%configur%'`, 'DESC'],
    ['relatório funcional', `${texto} LIKE '%relat%'`, 'DESC'],
    ['descrição curta', 'length(trim(coalesce(descricao,\'\'))) BETWEEN 1 AND 100', 'ASC'],
    ['marcação de solução', "solucao_aplicada = 'Sim'", 'ASC'],
    ['chamado antigo', 'descricao IS NOT NULL', 'ASC'],
    ['atendimento recente', 'descricao IS NOT NULL', 'DESC'],
  ];
  const casos = [], vistos = new Set();
  for (const [categoria, filtro, ordem] of criterios) {
    const candidatos = db.prepare(`SELECT id, numero, empresa_id, data_abertura FROM chamados WHERE ${filtro} ORDER BY data_abertura ${ordem}, id LIMIT 30`).all();
    const c = candidatos.find(x => !vistos.has(x.id));
    if (c) { vistos.add(c.id); casos.push({ ...c, categoria }); }
  }
  const saida = [];
  for (const c of casos) {
    const medir = fn => { const inicio = performance.now(); const lista = fn(); return { ms: Math.round(performance.now() - inicio), resultados: lista.slice(0, 5).map(x => ({ numero: x.chamado.numero, score: x.score })) }; };
    const baseAnterior = medir(() => anterior.exports.listarChamadosRelacionados(c.empresa_id, c.id, { limite: 5 }));
    const textual = medir(() => atual.listarChamadosRelacionados(c.empresa_id, c.id, { limite: 5 }));
    const pa = medir(() => atual.listarChamadosRelacionados(c.empresa_id, c.id, { limite: 5, escopo: 'cliente_pa' }));
    saida.push({ numero: c.numero, categoria: c.categoria, dataAbertura: c.data_abertura, identidadePa: atual.identidadeConfirmadaPa(c.empresa_id, c.id), anterior: baseAnterior, textualAtual: textual, paAtual: pa });
  }
  database.fecharDB();
  for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(destino + s); } catch (_) {}
  const arquivo = 'tmp/auditoria-amostra-comparativo.json';
  fs.writeFileSync(arquivo, JSON.stringify({ observacao: 'Seleção por palavras e datas; categorias são hipóteses, resultados ainda não revisados por consultores. Sem IA ou vetores. Versão anterior HEAD; PA anterior não é comparado por não ter isolamento equivalente.', casos: saida }, null, 2));
  const linhas = [
    '# Amostra para revisão de consultores — Base de Conhecimento', '',
    'Dez chamados selecionados por palavras e datas na base local; categorias são indicativas e não substituem a leitura. Resultados dos cinco primeiros da busca textual, sem expansão de IA nem índice vetorial. O motor anterior é o arquivo em HEAD; o PA anterior não é comparado por não ter isolamento equivalente.', '',
    'Para cada linha, o revisor deve preencher utilidade, mesmo problema e solução com evidência como sim, não ou inconclusivo; informar evidência e posicionamento no sistema, sem copiar dados sensíveis. Marcar casos úteis não recuperados e sua referência no final de cada chamado. Decisões do assistente anteriores estão em revisao-amostra-base-conhecimento.md e são parciais.', '',
    'A seleção não comprova que existam soluções conhecidas ou casos sem solução: os consultores devem identificar exemplos e acrescentá-los. A amostra não representa a população e não fornece taxa de assertividade.', '',
  ];
  for (const c of saida) {
    linhas.push(`## ${c.numero} — ${c.categoria}`, '', `Data: ${c.dataAbertura || 'ausente'}. Identidade PA verificada pelos critérios do sistema: ${c.identidadePa ? 'sim' : 'não'}.`, '', '| Busca | Posição | Candidato | Útil? | Mesmo problema? | Solução com evidência? | Referência da evidência / observações |', '|---|---:|---|---|---|---|---|');
    for (const [nome, lista] of [['Anterior empresa', c.anterior.resultados], ['Atual empresa', c.textualAtual.resultados], ['Atual PA', c.paAtual.resultados]]) lista.forEach((item, i) => linhas.push(`| ${nome} | ${i + 1} | ${item.numero} | Pendente | Pendente | Pendente | Pendente |`));
    linhas.push('', 'Casos úteis conhecidos não recuperados: pendente de revisão.', 'Revisor e data: pendente.', '');
  }
  fs.writeFileSync('tmp/amostra-para-consultores.md', linhas.join('\n'));
  console.log(JSON.stringify({ arquivo, casos: saida.length, paIdentificado: saida.filter(c => c.identidadePa).length }));
}
main().catch(() => { console.error('Falha na auditoria da amostra; dados não exibidos.'); process.exitCode = 1; });
