const fs = require('fs');

function edit(p, pairs) {
  let s = fs.readFileSync(p, 'utf8');
  const crlf = s.includes('\r\n');
  if (crlf) s = s.replace(/\r\n/g, '\n');
  for (const [a, b] of pairs) {
    if (s.split(a).length !== 2) throw new Error('trecho nao unico em ' + p + ': ' + a.slice(0, 70));
    s = s.replace(a, b);
  }
  if (crlf) s = s.replace(/\n/g, '\r\n');
  fs.writeFileSync(p, s);
}

const SVC = 'apps/IA Service/backend/';

// 1) Migration v44
edit(SVC + 'database/migrations.js', [[
  "      ALTER TABLE avaliacoes_investigacao ADD COLUMN origem_identidade TEXT DEFAULT NULL;\n    `,\n  },\n];",
  "      ALTER TABLE avaliacoes_investigacao ADD COLUMN origem_identidade TEXT DEFAULT NULL;\n    `,\n  },\n" +
  "  {\n    version: 44,\n" +
  "    descricao: 'Escolha PESSOAL de pre-analise automatica do consultor, separada do padrao vindo da Platform (2026-10): pre_analise_automatica passa a ser so o PADRAO copiado do cadastro da Platform a cada login; pre_analise_pessoal (NULL = segue o padrao, 0/1 = escolha do proprio analista no chat) nunca e sobrescrita pelo login nem pela sincronizacao. Valor efetivo = pessoal ?? padrao. Coluna aditiva, sem tocar no cadastro da Platform.',\n" +
  "    sql: `\n      ALTER TABLE consultores ADD COLUMN pre_analise_pessoal INTEGER DEFAULT NULL;\n    `,\n  },\n];",
]]);

// 2) Repository
edit(SVC + 'repositories/consultor-repository.js', [
  [
    "    preAnaliseAutomatica: !!row.pre_analise_automatica,\n    criadoEm: row.criado_em,",
    "    // Valor EFETIVO (escolha pessoal do analista, se houver; senao o padrao\n" +
    "    // do cadastro da Platform) -- e o que o resto do sistema consome.\n" +
    "    preAnaliseAutomatica: row.pre_analise_pessoal === null || row.pre_analise_pessoal === undefined\n" +
    "      ? !!row.pre_analise_automatica\n" +
    "      : !!row.pre_analise_pessoal,\n" +
    "    preAnalisePadrao: !!row.pre_analise_automatica,\n" +
    "    preAnalisePessoal: row.pre_analise_pessoal === null || row.pre_analise_pessoal === undefined\n" +
    "      ? null\n" +
    "      : !!row.pre_analise_pessoal,\n" +
    "    criadoEm: row.criado_em,",
  ],
  [
    "    // Preferencia de pre-analise: vence a alteracao mais recente. Se o\n" +
    "    // consultor foi alterado (ex.: toggle feito pelo proprio analista no chat)\n" +
    "    // DEPOIS da ultima edicao do cadastro na Platform, o valor dele e mantido\n" +
    "    // em vez de ser sobrescrito a cada login (reportado em producao, 2026-10).\n" +
    "    const platformEm = Date.parse(dados.platformAtualizadoEm || '');\n" +
    "    const consultorEm = Date.parse(existente.atualizado_em || '');\n" +
    "    const manterPreferencia = Number.isFinite(platformEm) && Number.isFinite(consultorEm) && consultorEm > platformEm;\n" +
    "    const preAnalise = manterPreferencia\n" +
    "      ? (existente.pre_analise_automatica ? 1 : 0)\n" +
    "      : (dados.preAnaliseAutomatica === false ? 0 : 1);\n",
    "    // pre_analise_automatica e so o PADRAO vindo da Platform (sempre copiado);\n" +
    "    // a escolha pessoal do analista fica em pre_analise_pessoal e nunca e\n" +
    "    // tocada aqui.\n" +
    "    const preAnalise = dados.preAnaliseAutomatica === false ? 0 : 1;\n",
  ],
  [
    "(patch.preAnaliseAutomatica ? 1 : 0) : (atual.preAnaliseAutomatica ? 1 : 0),",
    "(patch.preAnaliseAutomatica ? 1 : 0) : (atual.preAnalisePadrao ? 1 : 0),",
  ],
  [
    "function atualizarConsultor(empresaId, consultorId, patch) {",
    "/**\n" +
    " * Grava a escolha PESSOAL de pre-analise do analista (true/false) ou a remove\n" +
    " * (null = volta a seguir o padrao do cadastro). Nunca altera o padrao nem o\n" +
    " * cadastro da Platform.\n" +
    " */\n" +
    "function definirPreferenciaPessoal(empresaId, consultorId, valor) {\n" +
    "  if (!empresaId) throw new Error('empresaId é obrigatório.');\n" +
    "  const db = getDB();\n" +
    "  const atual = getConsultor(empresaId, consultorId);\n" +
    "  if (!atual) return null;\n" +
    "  const v = valor === null || valor === undefined ? null : (valor ? 1 : 0);\n" +
    "  db.prepare('UPDATE consultores SET pre_analise_pessoal = ?, atualizado_em = ? WHERE id = ? AND empresa_id = ?')\n" +
    "    .run(v, new Date().toISOString(), consultorId, Number(empresaId));\n" +
    "  return getConsultor(empresaId, consultorId);\n" +
    "}\n\n" +
    "function atualizarConsultor(empresaId, consultorId, patch) {",
  ],
  [
    "  upsertConsultorPlatform,\n  atualizarConsultor,",
    "  upsertConsultorPlatform,\n  definirPreferenciaPessoal,\n  atualizarConsultor,",
  ],
]);

// 3) Service
edit(SVC + 'services/consultor-service.js', [
  [
    "function excluirConsultor(empresaId, consultorId) {",
    "function definirPreferenciaPessoal(empresaId, consultorId, valor) {\n" +
    "  return consultorRepo.definirPreferenciaPessoal(empresaId, consultorId, valor);\n}\n\n" +
    "function excluirConsultor(empresaId, consultorId) {",
  ],
  [
    "  atualizarConsultor,\n  excluirConsultor,\n};",
    "  atualizarConsultor,\n  definirPreferenciaPessoal,\n  excluirConsultor,\n};",
  ],
]);

// 4) Rotas externas
edit(SVC + 'routes/externo-routes.js', [
  [
    "        consultorEncontrado: true,\n        consultorId: consultor.id,\n        preAnaliseAutomatica: consultor.preAnaliseAutomatica !== false,\n      });",
    "        consultorEncontrado: true,\n        consultorId: consultor.id,\n        preAnaliseAutomatica: consultor.preAnaliseAutomatica !== false,\n" +
    "        preAnalisePadrao: consultor.preAnalisePadrao !== false,\n        preAnalisePessoal: consultor.preAnalisePessoal,\n      });",
  ],
  [
    "      const { preAnaliseAutomatica } = req.body || {};\n" +
    "      const atualizado = consultorService.atualizarConsultor(req.svcEmpresaId, consultor.id, {\n" +
    "        preAnaliseAutomatica: !!preAnaliseAutomatica,\n      });\n" +
    "      res.json({\n        consultorEncontrado: true,\n        consultorId: atualizado.id,\n" +
    "        preAnaliseAutomatica: atualizado.preAnaliseAutomatica !== false,\n      });",
    "      // null = \"voltar ao padrao\" (remove a escolha pessoal); true/false = escolha do analista.\n" +
    "      const { preAnaliseAutomatica } = req.body || {};\n" +
    "      const atualizado = consultorService.definirPreferenciaPessoal(\n" +
    "        req.svcEmpresaId, consultor.id, preAnaliseAutomatica === null ? null : !!preAnaliseAutomatica,\n      );\n" +
    "      res.json({\n        consultorEncontrado: true,\n        consultorId: atualizado.id,\n" +
    "        preAnaliseAutomatica: atualizado.preAnaliseAutomatica !== false,\n" +
    "        preAnalisePadrao: atualizado.preAnalisePadrao !== false,\n        preAnalisePessoal: atualizado.preAnalisePessoal,\n      });",
  ],
]);

// 5) Rotas internas
edit(SVC + 'routes/index.js', [
  [
    "        consultorEncontrado: true,\n        consultorId: consultor.id,\n        preAnaliseAutomatica: consultor.preAnaliseAutomatica !== false,\n      });",
    "        consultorEncontrado: true,\n        consultorId: consultor.id,\n        preAnaliseAutomatica: consultor.preAnaliseAutomatica !== false,\n" +
    "        preAnalisePadrao: consultor.preAnalisePadrao !== false,\n        preAnalisePessoal: consultor.preAnalisePessoal,\n      });",
  ],
  [
    "      const { preAnaliseAutomatica } = req.body || {};\n" +
    "      const atualizado = consultorService.atualizarConsultor(empresaId, consultor.id, {\n" +
    "        preAnaliseAutomatica: !!preAnaliseAutomatica,\n      });\n" +
    "      res.json({\n        consultorEncontrado: true,\n        consultorId: atualizado.id,\n" +
    "        preAnaliseAutomatica: atualizado.preAnaliseAutomatica !== false,\n      });",
    "      const { preAnaliseAutomatica } = req.body || {};\n" +
    "      const atualizado = consultorService.definirPreferenciaPessoal(\n" +
    "        empresaId, consultor.id, preAnaliseAutomatica === null ? null : !!preAnaliseAutomatica,\n      );\n" +
    "      res.json({\n        consultorEncontrado: true,\n        consultorId: atualizado.id,\n" +
    "        preAnaliseAutomatica: atualizado.preAnaliseAutomatica !== false,\n" +
    "        preAnalisePadrao: atualizado.preAnalisePadrao !== false,\n        preAnalisePessoal: atualizado.preAnalisePessoal,\n      });",
  ],
]);

// 6) Login/sincronizacao: a Platform so atualiza o PADRAO
edit(SVC + 'services/login-externo-service.js', [
  [
    "          preAnaliseAutomatica: item.preAnaliseAutomatica,\n          platformAtualizadoEm: item.atualizadoEm,\n        });",
    "          preAnaliseAutomatica: item.preAnaliseAutomatica,\n        });",
  ],
  [
    "    if (!item?.atualizadoEm) return false;\n\n" +
    "    const platformEm = new Date(item.atualizadoEm).getTime();\n" +
    "    const consultorEm = new Date(consultor.atualizadoEm).getTime();\n" +
    "    if (!Number.isFinite(platformEm) || (Number.isFinite(consultorEm) && platformEm <= consultorEm)) return false;\n" +
    "    if (item.preAnaliseAutomatica === consultor.preAnaliseAutomatica && item.ativo === consultor.ativo) return false;",
    "    if (!item) return false;\n" +
    "    // So o PADRAO e sincronizado; a escolha pessoal do analista nunca e tocada.\n" +
    "    if (item.preAnaliseAutomatica === consultor.preAnalisePadrao && item.ativo === consultor.ativo) return false;",
  ],
]);

console.log('patch aplicado');
