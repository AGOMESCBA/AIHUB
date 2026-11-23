'use strict';
const D = require('better-sqlite3'), path = require('path'), os = require('os'), crypto = require('crypto'), fs = require('fs');
async function main() {
  const arquivo = path.join(os.tmpdir(), `pa-par-${crypto.randomUUID()}.db`);
  const origem = new D('apps/IA Service/data/ia-service.db', { readonly: true, fileMustExist: true });
  await origem.backup(arquivo); origem.close();
  const banco = require('../apps/IA Service/backend/database');
  const log = console.log; console.log = () => {}; try { banco.inicializarDB(arquivo); } finally { console.log = log; }
  const repo = require('../apps/IA Service/backend/repositories/chamado-repository');
  const atual = repo.getChamadoPorNumero(1, '037058', 'softexpert', { exigirUnico: true });
  const anterior = repo.getChamadoPorNumero(1, '034545', 'softexpert', { exigirUnico: true });
  const atualOk = !!atual && repo.identidadeConfirmadaPa(1, atual.id);
  const anteriorOk = !!anterior && repo.identidadeConfirmadaPa(1, anterior.id);
  const autorizado = !!(atual && anterior && repo.obterCandidatosPorIds(1, atual.id, [anterior.id], { escopo: 'cliente_pa' }).length);
  console.log(JSON.stringify({ chamado: '037058', candidato: '034545', atualIdentificado: atualOk, candidatoIdentificado: anteriorOk, elegivelPa: autorizado }));
  banco.fecharDB(); for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(arquivo + s); } catch (_) {}
}
main().catch(() => { console.error('Não foi possível verificar o par.'); process.exitCode = 1; });
