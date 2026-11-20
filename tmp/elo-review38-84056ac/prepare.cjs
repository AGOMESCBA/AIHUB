const fs=require('node:fs');
let code=fs.readFileSync('C:/Apps/ELOGESTAO/tools/dev/browser-e2e-38.cjs','utf8');
code=code.replace("const root = path.resolve(__dirname, '../..');","const root = 'C:/Apps/ELOGESTAO';");
code=code.replace("const out = path.join(root, '.local/logs/browser-38');","const out = 'C:/Apps/iahub/tmp/elo-review38-84056ac/browser';");
code=code.replace(/^.*try \{ fs\.rmSync\(profile,.*$/m,'');
fs.writeFileSync('C:/Apps/iahub/tmp/elo-review38-84056ac/browser.cjs',code);
const support=code.slice(0,code.indexOf('async function platformScenario'));
fs.writeFileSync('C:/Apps/iahub/tmp/elo-review38-84056ac/independent.cjs',support.replace("/browser';","/independent';")+fs.readFileSync('C:/Apps/iahub/tmp/elo-review38-84056ac/independent-body.cjs','utf8'));
