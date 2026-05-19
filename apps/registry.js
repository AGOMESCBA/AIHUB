const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

function fromRoot(...parts) {
  return path.join(ROOT_DIR, ...parts);
}

const sharedFrontend = fromRoot('frontend');
const iahubFrontend = fromRoot('apps', 'IAHUB', 'frontend');
const iaRecruitFrontend = fromRoot('apps', 'IA Recruit', 'frontend');
const iaAdministracaoFrontend = fromRoot('apps', 'IA Administracao', 'frontend');
const iaCommandFrontend = fromRoot('apps', 'IA Command', 'frontend');
const uiFrontend = fromRoot('packages', 'ui', 'frontend');
const authFrontend = fromRoot('packages', 'auth', 'frontend');

const SHARED_STATIC_DIRS = [
  uiFrontend,
  authFrontend,
];

const IA_RECRUIT_STATIC_DIRS = [
  ...SHARED_STATIC_DIRS,
  iaRecruitFrontend,
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
  ...SHARED_STATIC_DIRS,
  iaAdministracaoFrontend,
  sharedFrontend,
  fromRoot('modules', 'configuracoes', 'frontend'),
  fromRoot('modules', 'empresas', 'frontend'),
  fromRoot('modules', 'usuarios', 'frontend'),
  fromRoot('modules', 'seguranca', 'frontend'),
];

const LEGACY_STATIC_DIRS = [
  ...SHARED_STATIC_DIRS,
  iahubFrontend,
  iaAdministracaoFrontend,
  iaRecruitFrontend,
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
    frontendDir: iahubFrontend,
    legacyFrontendDir: sharedFrontend,
  },
  iaRecruit: {
    code: 'recrutamento',
    name: 'IA Recruit',
    rootDir: fromRoot('apps', 'IA Recruit'),
    frontendDir: iaRecruitFrontend,
    backendDir: fromRoot('apps', 'IA Recruit', 'backend'),
    legacyStaticDirs: IA_RECRUIT_STATIC_DIRS,
  },
  iaAdministracao: {
    code: 'ia-admin',
    name: 'IA Administracao',
    rootDir: fromRoot('apps', 'IA Administracao'),
    frontendDir: iaAdministracaoFrontend,
    backendDir: fromRoot('apps', 'IA Administracao', 'backend'),
    legacyStaticDirs: IA_ADMIN_STATIC_DIRS,
  },
  iaCommand: {
    code: 'ia-command',
    name: 'IA Command',
    rootDir: fromRoot('apps', 'IA Command'),
    frontendDir: iaCommandFrontend,
    backendDir: fromRoot('apps', 'IA Command', 'modules'),
    staticDirs: [
      iaCommandFrontend,
      fromRoot('modules', 'configuracoes', 'frontend'),
    ],
  },
};

module.exports = {
  APPS,
  LEGACY_STATIC_DIRS,
  SHARED_STATIC_DIRS,
  fromRoot,
};
