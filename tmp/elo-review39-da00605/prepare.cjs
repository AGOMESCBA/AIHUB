const fs=require('node:fs');
const root='C:/Apps/ELOGESTAO';
const out='C:/Apps/iahub/tmp/elo-review39-da00605';
let db=fs.readFileSync(root+'/tools/dev/check_foundation_db.py','utf8').replace('ROOT = Path(__file__).resolve().parents[2]',`ROOT = Path(r'${root}')`);
db=db.replace('out = ROOT / ".local" / "logs" / "fase39-banco.json"',`out = Path(r'${out}/database.json')`);
fs.writeFileSync(out+'/database.py',db);
let http=fs.readFileSync(root+'/tools/dev/smoke_foundation_39.py','utf8').split('# Fluxos simples')[0].replace('ROOT = Path(__file__).resolve().parents[2]',`ROOT = Path(r'${root}')`);
http+=fs.readFileSync(out+'/http-body.py','utf8');
fs.writeFileSync(out+'/http-selected.py',http);
