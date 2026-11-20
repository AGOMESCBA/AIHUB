from pathlib import Path
R=Path('C:/Apps/ELOGESTAO');p=R/'apps/api/tests/test_fase3_foundation.py';s=p.read_text(encoding='utf-8');s=s.replace('import sys\n','import sys\nimport time\n',1)
old='''    return subprocess.run([sys.executable, "-m", "alembic", *command], cwd=API_ROOT, env=env,
                          capture_output=True, text=True, encoding="utf-8", errors="replace")'''
new='''    # Bancos descartáveis diferentes ainda compartilham pg_roles no mesmo cluster.
    # Outra sessão pode alterar os papéis elo_* durante o upgrade. Só esse conflito
    # transitório de catálogo é repetido; erros de schema/dados continuam falhando.
    for attempt in range(4):
        result = subprocess.run([sys.executable, "-m", "alembic", *command], cwd=API_ROOT, env=env,
                                capture_output=True, text=True, encoding="utf-8", errors="replace")
        collision = (command and command[0] == "upgrade" and "tuple concurrently updated" in result.stderr
                     and "ALTER ROLE elo_" in result.stderr)
        if result.returncode == 0 or not collision or attempt == 3:
            return result
        time.sleep(0.2 * (attempt + 1))'''
assert old in s;s=s.replace(old,new,1);p.write_text(s,encoding='utf-8')
p=R/'apps/backoffice/src/app/app/contratos/approval-screens.tsx';s=p.read_text(encoding='utf-8');s=s.replace('import { useEffect, useRef, useState }','import { useEffect, useId, useRef, useState }',1);s=s.replace('  const [showQueue, setShowQueue]', '  const queueId = useId();\n  const [showQueue, setShowQueue]',1);s=s.replace('aria-controls="approval-full-queue"','aria-controls={queueId}',1);s=s.replace('id="approval-full-queue"','id={queueId}',1);p.write_text(s,encoding='utf-8')
print('Preparação dos bancos repete apenas conflito transitório de pg_roles; controles da fila únicos por aba.')
