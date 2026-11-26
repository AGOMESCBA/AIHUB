'use strict';

// IA Talk: as dependências externas vêm de dentro da whatsapp-web.js instalada
// na raiz (node_modules/whatsapp-web.js) — as mesmas versões que o IA Command usa
// (puppeteer 24.x, mime 3.x). A raiz tem outras versões que não servem aqui.
const { createRequire } = require('module');

module.exports = createRequire(require.resolve('whatsapp-web.js'));
