// Launcher sem espaços no path — redirecionado para o worker real.
// Usa __dirname para ser portável entre ambientes (dev, produção, servidor).
require(require('path').join(__dirname, 'apps', 'IA Command', 'modules', 'whatsapp', 'windows-service', 'worker.js'));
