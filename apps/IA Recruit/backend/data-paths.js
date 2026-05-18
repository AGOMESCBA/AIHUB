const fs = require('fs');
const path = require('path');

const APP_DATA_DIR = path.join(__dirname, '..', 'data');
const PLATFORM_DATA_DIR = path.join(__dirname, '..', '..', '..', 'apps', 'IAHUB', 'data');
const LEGACY_PLATFORM_DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');

function ensureAppDataDir() {
  fs.mkdirSync(APP_DATA_DIR, { recursive: true });
}

function appDataFile(fileName) {
  ensureAppDataDir();
  const target = path.join(APP_DATA_DIR, fileName);
  const legacy = path.join(PLATFORM_DATA_DIR, fileName);

  if (!fs.existsSync(target) && fs.existsSync(legacy)) {
    fs.copyFileSync(legacy, target);
  }

  return target;
}

function platformDataFile(fileName) {
  const target = path.join(PLATFORM_DATA_DIR, fileName);
  const legacy = path.join(LEGACY_PLATFORM_DATA_DIR, fileName);
  if (!fs.existsSync(target) && fs.existsSync(legacy)) {
    fs.mkdirSync(PLATFORM_DATA_DIR, { recursive: true });
    fs.copyFileSync(legacy, target);
  }
  return target;
}

function empresaDataFile(empresaId) {
  if (!empresaId) throw new Error('empresa_id e obrigatorio');
  return appDataFile(`empresa_${empresaId}.json`);
}

function iaUsageFile(empresaId) {
  return appDataFile(`ia-usage-${empresaId || 'global'}.json`);
}

module.exports = {
  APP_DATA_DIR,
  PLATFORM_DATA_DIR,
  LEGACY_PLATFORM_DATA_DIR,
  ensureAppDataDir,
  appDataFile,
  platformDataFile,
  empresaDataFile,
  iaUsageFile,
};
