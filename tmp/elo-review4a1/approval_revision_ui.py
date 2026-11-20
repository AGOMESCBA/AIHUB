from pathlib import Path
R=Path('C:/Apps/ELOGESTAO')
p=R/'apps/backoffice/src/app/app/contratos/approval-screens.tsx';s=p.read_text(encoding='utf-8')
s=s.replace("import { useRef, useState } from 'react';","import { useEffect, useRef, useState } from 'react';",1)
s=s.replace("  const a = row.approval;","  const a = row.approval;\n  const [showQueue, setShowQueue] = useState(true);\n  useEffect(() => { setShowQueue(window.matchMedia('(min-width: 1280px)').matches); }, []);",1)
s=s.replace("    if (!form.current?.reportValidity() || api.busy) return;","    if (!a.can_decide || !form.current?.reportValidity() || api.busy) return;",1)
start=s.index('      <Panel title="Sua decisão">');end=s.index('\n    </div>\n  );\n}',start)
old=s[start:end];assert '<form' in old
top='''      <Panel title="Análise de aprovação" actions={<>
        <button type="button" className={compactSecondaryClass} aria-expanded={showQueue} aria-controls="approval-full-queue" onClick={() => setShowQueue(v => !v)}>{showQueue ? 'Recolher fila' : 'Exibir fila de aprovadores'}</button>
        <button type="button" className={compactButtonClass} disabled={api.busy || !a.can_decide} title={a.decision_block_reason ?? 'Aprovar nível atual'} onClick={() => void decide('approve')}>{api.busy ? 'Registrando…' : 'Aprovar'}</button>
        <button type="button" className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={api.busy || !a.can_decide} title={a.decision_block_reason ?? 'Reprovar nível atual'} onClick={() => void decide('reject')}>Reprovar</button><Back />
      </>}>
        {!a.can_decide && <Notice text={a.decision_block_reason} />}
        <form ref={form} onSubmit={e => e.preventDefault()}><fieldset disabled={api.busy || !a.can_decide}><Field name="approval_reason" title="Justificativa da decisão" value={reason} onChange={setReason} required /></fieldset></form>
        {api.message && <Notice error={!api.message.ok} text={api.message.text} />}
      </Panel>'''
s=s[:start]+s[end:]
line='      <Approvals row={{ ...row, approval_rounds: [round] }} />\n';assert line in s;s=s.replace(line,'',1)
notice='      <Notice text="Análise somente leitura. Nenhum dado do contrato pode ser alterado nesta tela." />';assert notice in s
s=s.replace(notice,top+'\n'+notice+'\n      <div className={showQueue ? "grid items-start gap-3 xl:grid-cols-[320px_minmax(0,1fr)]" : "space-y-3"}>\n      {showQueue && <aside id="approval-full-queue" aria-label="Fila completa de aprovadores" className="min-w-0 xl:sticky xl:top-3 xl:max-h-[calc(100vh-12rem)] xl:overflow-y-auto"><Approvals row={{ ...row, approval_rounds: [round] }} compact /></aside>}\n      <div className="min-w-0 space-y-3">',1)
s=s.replace("['Etapa atual', `Nível ${a.current_level} de ${a.total_levels}`]","['Sua etapa', `Nível ${a.my_level} · atual ${a.current_level}`]",1)
s=s.replace('          Alçada suficiente. Esse limite autoriza cada operação; não é um saldo','          Sua alçada atende ao valor. A decisão depende da liberação do seu nível. Esse limite não é um saldo',1)
idx=s.index('\n    </div>\n  );\n}',s.index('function ApprovalAnalysis'));s=s[:idx]+'\n      </div></div>'+s[idx:]
s=s.replace('Somente contratos e aditivos que aguardam sua decisão no nível atual, nesta secretaria.','Contratos e aditivos com sua participação: disponíveis para decidir ou aguardando os níveis anteriores, nesta secretaria.')
s=s.replace("                'Nível',\n                'Sua alçada',","                'Seu nível',\n                'Situação da aprovação',\n                'Sua alçada',",1)
# Filtros seguem paralelos às nove colunas, sem filtro fictício de situação.
s=s.replace("                cols.text('q'),\n                null,","                cols.text('q'),\n                null,\n                null,",1)
s=s.replace("                    {r.approval.current_level} de {r.approval.total_levels}","                    {r.approval.my_level} de {r.approval.total_levels}",1)
s=s.replace('                  <Cell>{money(r.approval.limit_cents)}</Cell>','                  <Cell><span className={r.approval.can_decide ? "text-emerald-700" : "text-amber-700"}>{r.approval.can_decide ? "Pode decidir" : `Aguardando nível ${r.approval.current_level}`}</span></Cell>\n                  <Cell>{money(r.approval.limit_cents)}</Cell>',1)
s=s.replace('                      Analisar aprovação','                      {r.approval.can_decide ? "Analisar e decidir" : "Consultar análise"}',1)
s=s.replace('A fila não inclui níveis futuros nem decisões que você já registrou.','A fila inclui seus níveis atuais e futuros ainda sem decisão. Os botões de decisão só são liberados quando chegar sua vez.')
p.write_text(s,encoding='utf-8')
p=R/'apps/backoffice/src/app/app/contratos/contract-screens.tsx';s=p.read_text(encoding='utf-8')
s=s.replace('export function Approvals({ row }: { row: Row }) {','export function Approvals({ row, compact = false }: { row: Row; compact?: boolean }) {',1)
s=s.replace('<ol aria-label="Fila de aprovadores" className="flex flex-wrap gap-3">','<ol aria-label="Fila de aprovadores" className={compact ? "space-y-3" : "flex flex-wrap gap-3"}>',1)
# Contrato: mesmos botões do CRUD comum no cabeçalho do Panel.
old='''        {canSave && !saved && (
          <button className={compactButtonClass} disabled={api.busy}>
            {api.busy ? 'Salvando…' : 'Salvar contrato'}
          </button>
        )}
        <CancelToList />''';assert old in s;s=s.replace(old,'',1)
needle='''      title={initial ? 'Dados do contrato' : 'Novo contrato'}''';assert needle in s;s=s.replace(needle,needle+'''\n      actions={<>{canSave && <button type="button" className={compactButtonClass} disabled={api.busy || !!saved} onClick={() => formRef.current?.requestSubmit()}>{api.busy ? 'Salvando…' : 'Salvar contrato'}</button>}<CancelToList /></>}''',1)
old='''        {allowed && !saved && (
          <button className={compactButtonClass} disabled={api.busy || !row}>
            Registrar
          </button>
        )}
        <CancelToList />''';assert old in s;s=s.replace(old,'',1)
needle="      title={measurement ? 'Registrar medição' : 'Registrar empenho autorizado'}";assert needle in s;s=s.replace(needle,needle+'''\n      actions={<>{allowed && <button type="button" className={compactButtonClass} disabled={api.busy || !row || !!saved} onClick={() => ref.current?.requestSubmit()}>Registrar</button>}<CancelToList /></>}''',1)
# Aditivo: submissão no cabeçalho, preservando validação nativa e handler existente.
s=s.replace('function Amendments({ row }: { row: Row }) {\n  const api = useAdminApi();','function Amendments({ row }: { row: Row }) {\n  const api = useAdminApi();\n  const amendmentForm = useRef<HTMLFormElement>(null);',1)
s=s.replace('<Panel title="Aditivos">','<Panel title="Aditivos" actions={allowed && <button type="button" className={compactButtonClass} disabled={api.busy} onClick={() => amendmentForm.current?.requestSubmit()}>Submeter aditivo</button>}>',1)
start=s.index('function Amendments(');end=s.index('\nfunction ',start+15);part=s[start:end]
part=part.replace('<form\n          className=', '<form\n          ref={amendmentForm}\n          className=',1)
old='''          <button className={compactButtonClass} disabled={api.busy}>
            Submeter aditivo
          </button>''';assert old in part;part=part.replace(old,'',1);s=s[:start]+part+s[end:]
# Regras: botão salvar no topo da própria seção de configuração.
start=s.index('function PolicyForm(');part=s[start:]
part=part.replace('  const api = useAdminApi();','  const api = useAdminApi();\n  const policyForm = useRef<HTMLFormElement>(null);',1)
part=part.replace('  return (\n    <form','  return (\n    <Panel title="Regras de aprovação" actions={permitted && <button type="button" className={compactButtonClass} disabled={api.busy || !approvers.length} onClick={() => policyForm.current?.requestSubmit()}>Salvar alçadas</button>}>\n    <form ref={policyForm}',1)
old='''      {permitted && (
        <button
          className={compactButtonClass}
          disabled={api.busy || !approvers.length}
        >
          Salvar alçadas
        </button>
      )}''';assert old in part;part=part.replace(old,'',1);part=part.replace('    </form>\n  );','    </form></Panel>\n  );',1);s=s[:start]+part
p.write_text(s,encoding='utf-8')
print('CRUD com ações no topo; análise com fila lateral completa e bloqueio explícito dos níveis futuros.')
