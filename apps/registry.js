const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

function fromRoot(...parts) {
  return path.join(ROOT_DIR, ...parts);
}

const sharedFrontend = fromRoot('frontend');

const IA_RECRUIT_STATIC_DIRS = [
  sharedFrontend,
  fromRoot('modules', 'whatsapp-curriculo', 'frontend'),
  fromRoot('modules', 'processo-seletivo', 'frontend'),
  fromRoot('modules', 'analisador-curriculos', 'frontend'),
  fromRoot('modules', 'integracoes', 'SECurriculo', 'frontend'),
  fromRoot('modules', 'integracoes', 'SEFuncao', 'frontend'),
  fromRoot('modules', 'integracoes', 'SEVaga', 'frontend'),
  fromRoot('modules', 'integracoes', 'SEApiConfigurator', 'frontend'),
];

const IA_ADMIN_STATIC_DIRS = [
  sharedFrontend,
  fromRoot('modules', 'configuracoes', 'frontend'),
  fromRoot('modules', 'empresas', 'frontend'),
  fromRoot('modules', 'usuarios', 'frontend'),
  fromRoot('modules', 'seguranca', 'frontend'),
];

const LEGACY_STATIC_DIRS = [
  sharedFrontend,
  fromRoot('modules', 'configuracoes', 'frontend'),
  fromRoot('modules', 'empresas', 'frontend'),
  fromRoot('modules', 'usuarios', 'frontend'),
  fromRoot('modules', 'whatsapp-curriculo', 'frontend'),
  fromRoot('modules', 'processo-seletivo', 'frontend'),
  fromRoot('modules', 'analisador-curriculos', 'frontend'),
  fromRoot('modules', 'seguranca', 'frontend'),
  fromRoot('modules', 'integracoes', 'SECurriculo', 'frontend'),
];

const APPS = {
  iahub: {
    code: 'iahub',
    name: 'IAHUB',
    rootDir: fromRoot('apps', 'IAHUB'),
    frontendDir: fromRoot('apps', 'IAHUB', 'frontend'),
    legacyFrontendDir: sharedFrontend,
  },
  iaRecruit: {
    code: 'recrutamento',
    name: 'IA Recruit',
    rootDir: fromRoot('apps', 'IA Recruit'),
    frontendDir: fromRoot('apps', 'IA Recruit', 'frontend'),
    backendDir: fromRoot('apps', 'IA Recruit', 'backend'),
    legacyStaticDirs: IA_RECRUIT_STATIC_DIRS,
  },
  iaAdministracao: {
    code: 'ia-admin',
    name: 'IA Administracao',
    rootDir: fromRoot('apps', 'IA Administracao'),
    frontendDir: fromRoot('apps', 'IA Administracao', 'frontend'),
    backendDir: fromRoot('apps', 'IA Administracao', 'backend'),
    legacyStaticDirs: IA_ADMIN_STATIC_DIRS,
  },
};

module.exports = {
  APPS,
  LEGACY_STATIC_DIRS,
  fromRoot,
};
