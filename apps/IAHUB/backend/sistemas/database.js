const crud = require('../crud');
const empresasDb = require('../empresas/database');
const usuariosDb = require('../usuarios/database');
const permissoesDb = require('../permissoes/database');
const { systemActiveFromRotinas } = require('../permissoes/system-routines');

const SYSTEMS_FILE = 'systems';
const COMPANY_SYSTEMS_FILE = 'company_systems';
const USER_SYSTEMS_FILE = 'user_systems';

const DEFAULT_SYSTEMS = [
  {
    code: 'recrutamento',
    name: 'IA Recruit',
    description: 'A inteligencia que encontra os talentos certos.',
    url: '/app/ia-recruit',
    image_url: '',
    accent: '#2563eb',
    badge: 'IA Recruit',
    active: true,
  },
  {
    code: 'ia-admin',
    name: 'IA Administracao',
    description: 'Administracao global de empresas, usuarios, sistemas e regras.',
    url: '/app/ia-administracao',
    image_url: '',
    accent: '#0f766e',
    badge: 'Plataforma',
    admin_only: true,
    active: true,
  },
  {
    code: 'ia-command',
    name: 'IA Command',
    description: 'A inteligencia que conversa com seu ERP e executa comandos operacionais.',
    url: '/app/ia-command',
    image_url: '',
    accent: '#7c3aed',
    badge: 'IA Command',
    active: true,
  },
];

function listarSystems() {
  return crud.listar(SYSTEMS_FILE);
}

function getSystem(code) {
  return listarSystems().find(s => s.code === code) || null;
}

function atualizarSystem(code, patch) {
  const row = getSystem(code);
  if (!row) return null;

  const allowed = ['name', 'description', 'url', 'image_url', 'accent', 'badge', 'active'];
  const data = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) data[key] = patch[key];
  }

  if (!Object.keys(data).length) return row;
  return crud.atualizar(SYSTEMS_FILE, row.id, data);
}

function listarCompanySystems() {
  return crud.listar(COMPANY_SYSTEMS_FILE);
}

function listarUserSystems() {
  return crud.listar(USER_SYSTEMS_FILE);
}

function hasCompanySystem(companyId, systemCode) {
  const company = empresasDb.buscarPorId(companyId);
  if (!company) return false;
  const system = getSystem(systemCode);
  if (!system?.active) return false;
  const row = listarCompanySystems().find(r =>
    Number(r.company_id) === Number(companyId) && r.system_code === systemCode
  );
  return !!row?.active;
}

function hasUserSystem(userId, companyId, systemCode) {
  const user = usuariosDb.buscarPorId(userId);
  if (!user?.ativo) return false;
  const system = getSystem(systemCode);
  if (system?.admin_only && user.role !== 'admin') return false;
  if (user.role === 'admin') return hasCompanySystem(companyId, systemCode);

  const row = listarUserSystems().find(r =>
    Number(r.user_id) === Number(userId) &&
    Number(r.company_id) === Number(companyId) &&
    r.system_code === systemCode
  );
  return !!row?.active && hasCompanySystem(companyId, systemCode);
}

function usuarioTemEmpresa(user, companyId) {
  if (!user) return false;
  if (user.role === 'admin' || user.empresas === 'all') return true;
  return Array.isArray(user.empresas) && user.empresas.includes(Number(companyId));
}

function listarDisponiveis(userId, companyId) {
  const user = usuariosDb.buscarPorId(userId);
  if (!usuarioTemEmpresa(user, companyId)) return [];

  return listarSystems()
    .filter(system => system.active)
    .filter(system => hasUserSystem(userId, companyId, system.code))
    .map(system => ({
      code: system.code,
      name: system.name,
      description: system.description,
      url: system.url,
      image_url: system.image_url || '',
      accent: system.accent || '#2563eb',
      badge: system.badge || system.code,
      admin_only: !!system.admin_only,
      active: system.active,
    }));
}

function ensureCrudRow(file, predicate, data) {
  const exists = crud.listar(file).find(predicate);
  if (exists) return exists;
  return crud.criar(file, data);
}

function inicializarSistemas() {
  for (const system of DEFAULT_SYSTEMS) {
    const row = ensureCrudRow(SYSTEMS_FILE, s => s.code === system.code, system);
    const patch = {};
    for (const [key, value] of Object.entries(system)) {
      if (
        row[key] === undefined ||
        row[key] === null ||
        row[key] === '' ||
        key === 'name' ||
        key === 'description' ||
        key === 'url' ||
        key === 'badge'
      ) patch[key] = value;
    }
    if (Object.keys(patch).length) crud.atualizar(SYSTEMS_FILE, row.id, patch);
  }

  const systems = listarSystems();
  const empresas = empresasDb.listar();
  const usuarios = usuariosDb.listar();

  for (const empresa of empresas) {
    for (const system of systems) {
      ensureCrudRow(COMPANY_SYSTEMS_FILE, r =>
        Number(r.company_id) === Number(empresa.id) && r.system_code === system.code,
        { company_id: Number(empresa.id), system_code: system.code, active: true }
      );
    }
  }

  for (const usuario of usuarios) {
    if (usuario.role === 'admin') continue;
    const empresasUsuario = Array.isArray(usuario.empresas) ? usuario.empresas : [];
    for (const empresaId of empresasUsuario) {
      for (const system of systems) {
        const rotinas = permissoesDb.getRotinas(usuario.id, empresaId);
        const active = systemActiveFromRotinas(system.code, rotinas);

        ensureCrudRow(USER_SYSTEMS_FILE, r =>
          Number(r.user_id) === Number(usuario.id) &&
          Number(r.company_id) === Number(empresaId) &&
          r.system_code === system.code,
          {
            user_id: Number(usuario.id),
            company_id: Number(empresaId),
            system_code: system.code,
            active,
          }
        );
      }
    }
  }
}

function salvarCompanySystems(companyId, systems) {
  const todos = listarCompanySystems();
  const ativos = new Set((systems || []).filter(s => s.active).map(s => s.system_code || s.code));
  const known = listarSystems().map(s => s.code);

  for (const code of known) {
    const row = todos.find(r => Number(r.company_id) === Number(companyId) && r.system_code === code);
    const patch = { company_id: Number(companyId), system_code: code, active: ativos.has(code) };
    if (row) crud.atualizar(COMPANY_SYSTEMS_FILE, row.id, patch);
    else crud.criar(COMPANY_SYSTEMS_FILE, patch);
  }
}

function salvarUserSystems(userId, companyId, systems) {
  const todos = listarUserSystems();
  const ativos = new Set((systems || []).filter(s => s.active).map(s => s.system_code || s.code));
  const known = listarSystems().map(s => s.code);

  for (const code of known) {
    const row = todos.find(r =>
      Number(r.user_id) === Number(userId) &&
      Number(r.company_id) === Number(companyId) &&
      r.system_code === code
    );
    const patch = {
      user_id: Number(userId),
      company_id: Number(companyId),
      system_code: code,
      active: ativos.has(code),
    };
    if (row) crud.atualizar(USER_SYSTEMS_FILE, row.id, patch);
    else crud.criar(USER_SYSTEMS_FILE, patch);
  }
}

module.exports = {
  inicializarSistemas,
  listarSystems,
  getSystem,
  atualizarSystem,
  listarCompanySystems,
  listarUserSystems,
  listarDisponiveis,
  hasCompanySystem,
  hasUserSystem,
  salvarCompanySystems,
  salvarUserSystems,
};
