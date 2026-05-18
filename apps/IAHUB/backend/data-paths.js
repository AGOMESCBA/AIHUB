const fs = require('fs');
const path = require('path');

const APP_DATA_DIR = path.join(__dirname, '..', 'data');
const LEGACY_DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');

function ensureAppDataDir() {
  fs.mkdirSync(APP_DATA_DIR, { recursive: true });
}

function appDataFile(fileName) {
  ensureAppDataDir();
  const target = path.join(APP_DATA_DIR, fileName);
  const legacy = path.join(LEGACY_DATA_DIR, fileName);

  if (!fs.existsSync(target) && fs.existsSync(legacy)) {
    fs.copyFileSync(legacy, target);
  }

  return target;
}

function appDataDir(...parts) {
  ensureAppDataDir();
  const target = path.join(APP_DATA_DIR, ...parts);
  const legacy = path.join(LEGACY_DATA_DIR, ...parts);

  if (!fs.existsSync(target) && fs.existsSync(legacy)) {
    fs.cpSync(legacy, target, { recursive: true });
  }

  return target;
}

function legacyDataFile(fileName) {
  return path.join(LEGACY_DATA_DIR, fileName);
}

module.exports = {
  APP_DATA_DIR,
  LEGACY_DATA_DIR,
  ensureAppDataDir,
  appDataFile,
  appDataDir,
  legacyDataFile,
};
