'use strict';

// Regras do canal pela linha de comando (plano B da tela): lista de teste, regra de
// envio e regra de recebimento. Toda mudança de regra fica na auditoria.
//
//   node "apps/IA Talk/backend/cli/canal-teste.js"                       (lista os canais)
//   node "apps/IA Talk/backend/cli/canal-teste.js" --canal "WhatsApp J2A" --numeros 5565999990000[,5565...]
//   node "apps/IA Talk/backend/cli/canal-teste.js" --canal "IA Talk" --envio qualquer|teste|desligado --recebimento todos|teste
//   (o mesmo que o bloco Regras do canal na tela; os antigos --modo ligado|desligado e --envio ligado|desligado
//    ainda funcionam e são traduzidos em canais/regras.js)
//   node "apps/IA Talk/backend/cli/canal-teste.js" --canal "IA Talk" --uso compartilhado|atendimento|integracao --setor suporte
//   (uso do número, contratos.md §8.1: --setor = código do setor que recebe as conversas novas, da empresa dona do canal;
//    "compartilhado" só passa a valer quando o canal do IA Command estiver com "Deixar para o IA Talk atender")

const path = require('path');
const config = require('../config');
const telefone = require('../seguranca/telefone');
const auditoria = require('../repositorios/auditoria');
const { Contexto } = require('../repositorios/base');
const regras = require('../canais/regras');

function lerArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  return a;
}

function executar(db, { canal, numeros, modo, envio, recebimento, uso, setor } = {}) {
  if (!canal) {
    return db.prepare('SELECT c.id, c.nome, c.estado, c.envio_modo, c.recebimento_modo, c.uso, c.numeros_teste, e.nome AS empresa FROM canais c JOIN empresas e ON e.id = c.empresa_dona_id ORDER BY c.nome').all()
      .map(c => ({ ...c, numeros_teste: JSON.parse(c.numeros_teste).map(telefone.mascarar) }));
  }
  const c = db.prepare('SELECT * FROM canais WHERE id = ? OR nome = ?').get(canal, canal);
  if (!c) throw new Error(`Canal "${canal}" não encontrado.`);
  const lista = numeros ? String(numeros).split(',').map(telefone.normalizar) : JSON.parse(c.numeros_teste);
  if (lista.some(n => !telefone.valido(n))) throw new Error('Número inválido: use DDI e DDD (ex.: 5565999990000).');
  if (modo !== undefined && !['ligado', 'desligado'].includes(modo)) throw new Error('Use --modo ligado ou --modo desligado.');
  // Nomes antigos (--modo, --envio ligado/desligado) traduzidos; novos valem por cima.
  const legado = {};
  if (modo !== undefined) legado.modo_teste = modo !== 'desligado';
  if (envio === 'ligado' || envio === 'desligado') legado.envio_habilitado = envio === 'ligado';
  const novas = regras.traduzirLegado(c, legado);
  if (envio !== undefined && !['ligado', 'desligado'].includes(envio)) novas.envio_modo = envio;
  if (recebimento !== undefined) novas.recebimento_modo = recebimento;
  if (!regras.ENVIO_MODOS.includes(novas.envio_modo)) throw new Error('Use --envio desligado, teste ou qualquer.');
  if (!regras.RECEBIMENTO_MODOS.includes(novas.recebimento_modo)) throw new Error('Use --recebimento teste ou todos.');
  db.prepare('UPDATE canais SET numeros_teste = ?, envio_modo = ?, recebimento_modo = ?, atualizado_em = ? WHERE id = ?')
    .run(JSON.stringify(lista), novas.envio_modo, novas.recebimento_modo, new Date().toISOString(), c.id);
  const ctx = new Contexto({ empresaId: c.empresa_dona_id });
  const sufixo = ' (linha de comando no servidor)';
  let usoFinal = c.uso;
  if (uso !== undefined || setor !== undefined) usoFinal = definirUso(db, c, { uso: uso ?? c.uso, setor }, ctx, sufixo);
  if (novas.envio_modo !== c.envio_modo) {
    auditoria.registrar(db, ctx, { acao: 'canal.regra_envio', alvoTipo: 'canal', alvoId: c.id,
      resumo: `Envio do canal ${c.nome}: ${regras.TEXTOS.envio[c.envio_modo]} → ${regras.TEXTOS.envio[novas.envio_modo]}${sufixo}` });
  }
  if (novas.recebimento_modo !== c.recebimento_modo) {
    auditoria.registrar(db, ctx, { acao: 'canal.regra_recebimento', alvoTipo: 'canal', alvoId: c.id,
      resumo: `Recebimento do canal ${c.nome}: ${regras.TEXTOS.recebimento[c.recebimento_modo]} → ${regras.TEXTOS.recebimento[novas.recebimento_modo]}${sufixo}` });
  }
  return { id: c.id, nome: c.nome, envio_modo: novas.envio_modo, recebimento_modo: novas.recebimento_modo, uso: usoFinal, numeros_teste: lista.map(telefone.mascarar) };
}

// Uso do número (as mesmas regras do PUT /canais/:id, rotas/canais.js aplicarUso). Quem atende: a empresa dona.
function definirUso(db, c, { uso, setor }, ctx, sufixo) {
  if (!['integracao', 'atendimento', 'compartilhado'].includes(uso)) throw new Error('Use --uso integracao, atendimento ou compartilhado.');
  if (uso === 'integracao') {
    db.prepare("UPDATE canais SET uso = 'integracao', atendimento_empresa_id = NULL, setor_padrao_id = NULL WHERE id = ?").run(c.id);
  } else {
    const codigo = setor ?? db.prepare('SELECT codigo FROM setores WHERE id = ?').get(c.setor_padrao_id || '')?.codigo;
    if (!codigo) throw new Error('Informe --setor com o código do setor que recebe as conversas novas (crie o setor na tela Setores).');
    const s = db.prepare("SELECT id, nome FROM setores WHERE empresa_id = ? AND codigo = ? AND situacao = 'ativo'").get(c.empresa_dona_id, String(codigo));
    if (!s) throw new Error(`Setor "${codigo}" não encontrado ou inativo na empresa dona do canal (crie na tela Setores).`);
    db.prepare('UPDATE canais SET uso = ?, atendimento_empresa_id = ?, setor_padrao_id = ? WHERE id = ?').run(uso, c.empresa_dona_id, s.id, c.id);
  }
  auditoria.registrar(db, ctx, { acao: 'canal.uso', alvoTipo: 'canal', alvoId: c.id, resumo: `Uso do canal ${c.nome}: ${uso}${sufixo}` });
  return uso;
}

module.exports = { executar };

if (require.main === module) {
  require('dotenv').config({ path: path.join(config.RAIZ_REPO, '.env') });
  const { abrirBanco } = require('../database');
  const db = abrirBanco();
  try {
    console.log(executar(db, lerArgs(process.argv.slice(2))));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
