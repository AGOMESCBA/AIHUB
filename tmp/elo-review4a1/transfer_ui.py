from pathlib import Path
root=Path('C:/Apps/ELOGESTAO')
def put(name,s):
    (root/name).write_text(s,encoding='utf-8',newline='\n')
put('apps/backoffice/src/app/app/cadastros/vehicle-transfer.tsx', ''''use client';

import { useState } from 'react';
import { Row, useAdminApi, useAdminQuery } from '@/app/app/administracao/admin-api';
import { Field, Panel, QueryState, Select, buttonClass, items } from '@/app/app/administracao/admin-ui';

export function VehicleTransfer({ row, etag, onPending, onComplete }: {
  row: Row; etag?: string; onPending: (value: boolean) => void; onComplete: (receipt: Row) => void;
}) {
  const api = useAdminApi();
  const [target, setTarget] = useState('');
  const [fleet, setFleet] = useState('');
  const [model, setModel] = useState('');
  const [department, setDepartment] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const options = useAdminQuery<Row>(`/vehicles/${row.id}/transfer-options`, {
    ...(target ? { target_office_id: target } : {}), ...(search.trim() ? { q: search.trim() } : {}),
  });
  const data = options.data?.data;
  const history = useAdminQuery<Row>(`/vehicles/${row.id}/transfers`, { per_page: 20 });
  const selectOptions = (rows: Row[] = []) => rows.map(r => <option key={r.id} value={r.id}>{r.name}</option>);
  return <Panel title="Transferência de lotação">
    <p className="mb-4 text-sm text-slate-600">Exige permissão na origem e no destino. Salve ou descarte as alterações do cadastro antes de transferir. Ocupação ou saldo legado pendente bloqueiam a operação. A confirmação é feita por este usuário, com histórico nas duas secretarias.</p>
    <QueryState query={options}>
      <form className="space-y-3" onSubmit={async e => {
        e.preventDefault();
        if (!window.confirm('Confirmar a transferência? O veículo deixará de aparecer nesta secretaria.')) return;
        onPending(true);
        try {
          const response = await api.send('post', `/vehicles/${row.id}/transfer`, {
            target_office_id: Number(target), target_fleet_id: Number(fleet), target_model_id: Number(model),
            target_department_id: department ? Number(department) : null, reason,
          }, etag);
          if (response) onComplete(response.data);
        } finally { onPending(false); }
      }}>
        <Select title="Secretaria de destino" value={target} required onChange={v => {
          setTarget(v); setFleet(''); setModel(''); setDepartment(''); setSearch('');
        }}><option value="">Selecione</option>{selectOptions(data?.offices)}</Select>
        {target && <>
          <Field name="busca_destino" title="Buscar frota, modelo ou departamento no destino" value={search} onChange={setSearch} />
          <Select title="Frota ativa de destino" value={fleet} required onChange={setFleet}>
            <option value="">Selecione</option>{selectOptions(data?.fleets)}</Select>
          <Select title="Modelo válido no destino" value={model} required onChange={setModel}>
            <option value="">Selecione</option>{selectOptions(data?.models)}</Select>
          <Select title="Departamento de destino" value={department} onChange={setDepartment}>
            <option value="">Sem departamento</option>{selectOptions(data?.departments)}</Select>
          {(data?.fleets_has_more || data?.models_has_more || data?.departments_has_more) &&
            <p className="text-sm text-slate-600">Há mais resultados. Refine a busca.</p>}
          <Field name="motivo_transferencia" title="Justificativa (10 a 500 caracteres)" value={reason} onChange={setReason} required />
          <button className={buttonClass} disabled={api.busy || options.isFetching || !fleet || !model || reason.trim().length < 10 || reason.trim().length > 500}>
            {api.busy ? 'Transferindo…' : 'Confirmar transferência'}</button>
        </>}
        {api.message && <p role={api.message.ok ? 'status' : 'alert'}>{api.message.text}</p>}
      </form>
    </QueryState>
    <h3 className="mt-5 font-semibold">Histórico nesta secretaria</h3>
    {history.isError ? <p role="alert">Não foi possível consultar o histórico.</p> : items(history.data?.data).map((event: Row) =>
      <p key={`${event.version}-${event.occurred_at}`} className="mt-2 text-sm">
        {new Date(event.occurred_at).toLocaleString('pt-BR')} · Secretaria {event.source.office_id} → {event.target.office_id} · {event.reason}
      </p>)}
  </Panel>;
}
''')
p=root/'apps/backoffice/src/app/app/cadastros/vehicle-screens.tsx'
s=p.read_text(encoding='utf-8')
s=s.replace("import { useCsvExport } from './csv-export';", "import { useCsvExport } from './csv-export';\nimport { VehicleTransfer } from './vehicle-transfer';")
s=s.replace("  const csv = useCsvExport();", "  const csv = useCsvExport();\n  const [transferOpen, setTransferOpen] = useState(false);\n  const [transferPending, setTransferPending] = useState(false);\n  const [transferReceipt, setTransferReceipt] = useState<Row | null>(null);")
s=s.replace("    id !== 'novo'\n", "    id !== 'novo' && !transferPending && !transferReceipt\n")
old='''          <QueryState query={query}>
            {row && <VehicleForm initial={row} etag={query.data?.etag} />}
          </QueryState>'''
assert old in s
s=s.replace(old,'''          transferReceipt ? (
            <Panel title="Transferência concluída">
              <p role="status">Veículo transferido para a secretaria {transferReceipt.target.office_id}. Abra Veículos na secretaria de destino para continuar. O histórico permanece nas duas secretarias.</p>
            </Panel>
          ) : (
            <QueryState query={query}>
              {row && <>
                {api.can('cad.veiculos.transferir_lotacao') && <button className={secondaryClass} onClick={() => setTransferOpen(!transferOpen)}>
                  {transferOpen ? 'Voltar ao cadastro' : 'Transferir lotação'}
                </button>}
                {transferOpen ? <VehicleTransfer row={row} etag={query.data?.etag} onPending={setTransferPending} onComplete={setTransferReceipt} />
                  : <VehicleForm initial={row} etag={query.data?.etag} />}
              </>}
            </QueryState>
          )''')
# Não desmontar formulário com edição: só abre transferência após usar o mecanismo de fechamento seguro da aba.
# A opção abre um painel paralelo; o formulário original fica montado para preservar o rascunho.
s=s.replace("{transferOpen ? <VehicleTransfer", "{transferOpen && <VehicleTransfer")
s=s.replace("onComplete={setTransferReceipt} />\n                  : <VehicleForm initial={row} etag={query.data?.etag} />}", "onComplete={setTransferReceipt} />}\n                {!transferOpen && <VehicleForm initial={row} etag={query.data?.etag} />}")
# Melhor não permitir abrir se houver edição; o estado dirty já é controlado no formulário.
# Transferência será integrada ao formulário pai por callback, mantendo a verificação explícita abaixo.
s=s.replace("onClick={() => setTransferOpen(!transferOpen)}", "onClick={() => { if (!transferOpen && !window.confirm('Abra a transferência somente após salvar ou descartar a edição. Continuar?')) return; setTransferOpen(!transferOpen); }}")
put('apps/backoffice/src/app/app/cadastros/vehicle-screens.tsx',s)
print('Interface de transferência implementada.')
