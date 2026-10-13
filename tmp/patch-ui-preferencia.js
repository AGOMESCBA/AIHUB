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

const FRONT = 'apps/IA Service/frontend/j2a/';

edit(FRONT + 'index.html', [[
  '              <input id="pre-analysis-toggle" type="checkbox" checked>\n            </label>\n',
  '              <input id="pre-analysis-toggle" type="checkbox" checked>\n            </label>\n' +
  '            <div class="pre-analysis-padrao" id="pre-analysis-padrao" hidden>\n' +
  '              <span id="pre-analysis-padrao-texto"></span>\n' +
  '              <button type="button" id="pre-analysis-padrao-btn" class="link-button">Voltar ao padrão</button>\n' +
  '            </div>\n',
]]);

edit(FRONT + 'assets/radar.js', [
  [
    "    toggle.checked = pref.preAnaliseAutomatica !== false;\n    try {\n      const config",
    "    toggle.checked = pref.preAnaliseAutomatica !== false;\n    renderPreferenciaPadrao(pref);\n    try {\n      const config",
  ],
  [
    "  async function savePreferences() {\n    try {\n      await request(ext('/radar/minhas-preferencias'), {\n        method: 'PUT',\n        body: JSON.stringify({ preAnaliseAutomatica: $('pre-analysis-toggle').checked }),\n      });\n      toast('Preferencia salva.');\n    } catch (err) {\n      toast(`Nao foi possivel salvar: ${err.message}`);\n    }\n  }\n",
    "  // O padrao vem do cadastro da Plataforma; a escolha feita aqui e pessoal e\n" +
    "  // fica guardada a parte (nunca altera o cadastro). Mostra o aviso e o botao\n" +
    "  // \"Voltar ao padrao\" so quando a escolha pessoal difere do padrao.\n" +
    "  function renderPreferenciaPadrao(pref) {\n" +
    "    const box = $('pre-analysis-padrao');\n" +
    "    if (!box) return;\n" +
    "    const difere = pref && pref.preAnalisePessoal !== null && pref.preAnalisePessoal !== undefined\n" +
    "      && pref.preAnalisePessoal !== (pref.preAnalisePadrao !== false);\n" +
    "    box.hidden = !difere;\n" +
    "    if (difere) {\n" +
    "      $('pre-analysis-padrao-texto').textContent = `Sua escolha. Padrão do cadastro: ${pref.preAnalisePadrao !== false ? 'Automática' : 'Manual'}.`;\n" +
    "    }\n" +
    "  }\n\n" +
    "  async function savePreferences(valor) {\n" +
    "    // valor: undefined = usa o toggle; null = voltar ao padrao do cadastro.\n" +
    "    const enviar = valor === undefined ? $('pre-analysis-toggle').checked : valor;\n" +
    "    try {\n" +
    "      const pref = await request(ext('/radar/minhas-preferencias'), {\n" +
    "        method: 'PUT',\n" +
    "        body: JSON.stringify({ preAnaliseAutomatica: enviar }),\n" +
    "      });\n" +
    "      $('pre-analysis-toggle').checked = pref.preAnaliseAutomatica !== false;\n" +
    "      renderPreferenciaPadrao(pref);\n" +
    "      toast(enviar === null ? 'Voltou ao padrão do cadastro.' : 'Preferencia salva.');\n" +
    "    } catch (err) {\n" +
    "      toast(`Nao foi possivel salvar: ${err.message}`);\n" +
    "    }\n" +
    "  }\n",
  ],
  [
    "    $('pre-analysis-toggle').addEventListener('change', savePreferences);",
    "    $('pre-analysis-toggle').addEventListener('change', () => savePreferences());\n" +
    "    $('pre-analysis-padrao-btn').addEventListener('click', () => savePreferences(null));",
  ],
]);

edit(FRONT + 'assets/radar.css', [[
  ".theme-menu {\n",
  ".pre-analysis-padrao {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  margin-top: 6px;\n  padding: 0 4px;\n  font-size: 11px;\n  color: var(--muted, #8aa0b6);\n}\n" +
  ".pre-analysis-padrao .link-button {\n  border: 0;\n  background: transparent;\n  color: var(--brand);\n  font-size: 11px;\n  font-weight: 700;\n  cursor: pointer;\n  padding: 0;\n}\n" +
  ".theme-menu {\n",
]]);

console.log('ui aplicada');
