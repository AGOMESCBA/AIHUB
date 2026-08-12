/**
 * Rotas para geração do instalador do Agente Local.
 *
 * Fluxo:
 *  1. POST /api/ia-command/admin/instalador-agente/gerar
 *     → Gera script Inno Setup (.iss) e compila com ISCC.exe
 *     → Se ISCC não estiver disponível, empacota os arquivos num ZIP.
 *  2. GET  /api/ia-command/admin/instalador-agente/status
 *     → Retorna se ISCC está disponível e se há instalador já gerado.
 *  3. GET  /api/ia-command/admin/instalador-agente/download
 *     → Faz download do último arquivo gerado (.exe ou .zip).
 */

const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');
const { requireRotina } = require('./permissions');

// Caminho da pasta do agente-local (relativo a este arquivo)
const AGENTE_DIR = path.resolve(__dirname, '../agente-local');

// Pasta de saída para os instaladores gerados
const OUTPUT_DIR = path.join(AGENTE_DIR, 'dist');

// Arquivos/pastas a excluir ao empacotar
const EXCLUDES = new Set(['venv', 'logs', 'audit.db', '.env', '__pycache__', 'dist', 'nssm.exe']);

// Caminhos comuns do compilador Inno Setup
const ISCC_CANDIDATES = [
  'C:\\Program Files (x86)\\Inno Setup 7\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 7\\ISCC.exe',
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files (x86)\\Inno Setup 5\\ISCC.exe',
  'ISCC.exe',  // no PATH
];

function encontrarISCC() {
  for (const c of ISCC_CANDIDATES) {
    try {
      if (c === 'ISCC.exe') {
        execSync('ISCC.exe /?', { stdio: 'ignore', timeout: 3000 });
        return 'ISCC.exe';
      }
      if (fs.existsSync(c)) return c;
    } catch (_) {}
  }
  return null;
}

function listarArquivosRecursivo(dir, base) {
  const entries = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDES.has(entry.name) || entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    const rel = base ? `${base}\\${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      entries.push(...listarArquivosRecursivo(abs, rel));
    } else {
      entries.push({ abs, rel });
    }
  }
  return entries;
}

function gerarISS(versao, outputPath) {
  const arquivos = listarArquivosRecursivo(AGENTE_DIR, '');

  // Gera as linhas [Files] agrupando por pasta de destino
  const fileLines = arquivos.map(({ abs, rel }) => {
    const destDir = rel.includes('\\')
      ? `{app}\\${rel.substring(0, rel.lastIndexOf('\\'))}`
      : '{app}';
    const safeAbs = abs.replace(/\\/g, '\\');
    return `Source: "${safeAbs}"; DestDir: "${destDir}"; Flags: ignoreversion`;
  });

  return `; Script gerado automaticamente pelo IA Command
; Instalador do Agente Local - versao ${versao}

[Setup]
AppName=IA Command - Agente Local
AppVersion=${versao}
AppPublisher=IAHub
DefaultDirName={autopf}\\IACommand\\agente-local
DefaultGroupName=IA Command
DisableProgramGroupPage=yes
OutputDir=${outputPath}
OutputBaseFilename=IACommand-AgenteLocal-Setup-v${versao}
Compression=lzma2/ultra
SolidCompression=yes
PrivilegesRequired=admin
WizardStyle=modern
UninstallDisplayName=IA Command - Agente Local

[Languages]
Name: "portuguese"; MessagesFile: "compiler:Languages\\Portuguese.isl"

[Dirs]
Name: "{app}\\logs"

[Files]
${fileLines.join('\r\n')}

[Run]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\\instalar-gui.ps1"" -SkipCopy -Destino ""{app}"""; Flags: waituntilterminated; StatusMsg: "Configurando ambiente Python e servico Windows..."

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-Command ""& {{ $s='IA Hub - IACommand_AgenteLocal_API'; if (Get-Service $s -ErrorAction SilentlyContinue) {{ Stop-Service $s -Force; sc.exe delete $s }} }}"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveIACommandAgenteLocalService"

`;
}

function gerarZip(versao, outputPath) {
  // Usa o módulo nativo do Windows (via PowerShell) para criar o ZIP
  // pois não queremos dependência de pacotes npm externos aqui
  const zipName  = `IACommand-AgenteLocal-v${versao}.zip`;
  const zipPath  = path.join(outputPath, zipName);
  const tmpStage = path.join(os.tmpdir(), `iac-agente-${crypto.randomBytes(4).toString('hex')}`);

  fs.mkdirSync(tmpStage, { recursive: true });

  // Copiar arquivos para a pasta temporária
  const arquivos = listarArquivosRecursivo(AGENTE_DIR, '');
  for (const { abs, rel } of arquivos) {
    const dest = path.join(tmpStage, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
  }

  // Compactar com PowerShell (disponível no Windows 5.1+)
  const ps = `Compress-Archive -Path '${tmpStage}\\*' -DestinationPath '${zipPath}' -Force`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { timeout: 60000 });

  fs.rmSync(tmpStage, { recursive: true, force: true });

  if (result.status !== 0) {
    throw new Error(`Falha ao criar ZIP: ${result.stderr?.toString()}`);
  }

  return zipPath;
}

function compactarArquivo(filePath, outputPath, zipName) {
  const zipPath = path.join(outputPath, zipName);
  const safeFile = filePath.replace(/'/g, "''");
  const safeZip = zipPath.replace(/'/g, "''");
  const ps = `Compress-Archive -LiteralPath '${safeFile}' -DestinationPath '${safeZip}' -Force`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { timeout: 60000 });

  if (result.status !== 0) {
    throw new Error(`Falha ao criar ZIP: ${result.stderr?.toString()}`);
  }

  return zipPath;
}

module.exports = function registrarRotasInstalador(app, { requireAuth, requireIaCommand }) {
  const canInstall = requireRotina('iac-admin-instalador-agente');

  // ── Status: informa se ISCC está disponível e se há instalador gerado ──────
  app.get('/api/ia-command/admin/instalador-agente/status',
    requireAuth, requireIaCommand, canInstall,
    (_req, res) => {
      const iscc = encontrarISCC();
      let ultimoArquivo = null;
      let ultimoNome    = null;
      let ultimoTamanho = null;

      if (fs.existsSync(OUTPUT_DIR)) {
        const arquivos = fs.readdirSync(OUTPUT_DIR)
          .filter(f => f.endsWith('.exe') || f.endsWith('.zip'))
          .map(f => ({ nome: f, stat: fs.statSync(path.join(OUTPUT_DIR, f)) }))
          .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

        if (arquivos.length) {
          ultimoNome    = arquivos[0].nome;
          ultimoArquivo = ultimoNome;
          ultimoTamanho = arquivos[0].stat.size;
        }
      }

      res.json({
        isccDisponivel: !!iscc,
        isccPath:       iscc || null,
        ultimoArquivo,
        ultimoNome,
        ultimoTamanho,
        agenteDir:      AGENTE_DIR,
      });
    }
  );

  // ── Gerar instalador ───────────────────────────────────────────────────────
  app.post('/api/ia-command/admin/instalador-agente/gerar',
    requireAuth, requireIaCommand, canInstall,
    (req, res) => {
      const versao = String(req.body?.versao || '1.0.0').replace(/[^0-9.]/g, '') || '1.0.0';
      const formato = req.body?.formato === 'zip' ? 'zip' : 'exe';

      fs.mkdirSync(OUTPUT_DIR, { recursive: true });

      // Limpar arquivos antigos
      if (fs.existsSync(OUTPUT_DIR)) {
        fs.readdirSync(OUTPUT_DIR)
          .filter(f => f.endsWith('.exe') || f.endsWith('.zip') || f.endsWith('.iss'))
          .forEach(f => {
            try { fs.unlinkSync(path.join(OUTPUT_DIR, f)); } catch (_) {}
          });
      }

      const iscc = encontrarISCC();

      if (iscc) {
        // ── Modo Inno Setup: gera .exe com wizard ──────────────────────────
        const issContent = gerarISS(versao, OUTPUT_DIR);
        const issPath    = path.join(OUTPUT_DIR, `agente-local-v${versao}.iss`);
        fs.writeFileSync(issPath, issContent, 'utf8');

        const result = spawnSync(iscc, [issPath], {
          timeout:   120000,
          encoding:  'utf8',
          maxBuffer: 20 * 1024 * 1024,
        });

        const fullOutput = (result.stdout || '') + (result.stderr || '');

        // Extrai somente as linhas que contêm erro para exibição destacada
        const linhasErro = fullOutput
          .split('\n')
          .filter(l => /error|invalid|not found|cannot|falha/i.test(l))
          .join('\n');

        if (result.status !== 0 || result.error) {
          return res.status(500).json({
            ok:         false,
            erro:       linhasErro || result.error?.message || 'ISCC falhou sem mensagem.',
            saidaCompleta: fullOutput,
          });
        }

        const exeName = `IACommand-AgenteLocal-Setup-v${versao}.exe`;
        const exePath = path.join(OUTPUT_DIR, exeName);
        if (formato === 'zip') {
          try {
            const zipName = `IACommand-AgenteLocal-Setup-v${versao}.zip`;
            const zipPath = compactarArquivo(exePath, OUTPUT_DIR, zipName);
            return res.json({
              ok:      true,
              tipo:    'zip',
              arquivo: path.basename(zipPath),
              saida:   fullOutput.slice(-1200),
              aviso:   'Gerado como ZIP contendo o instalador .exe para reduzir bloqueios no download.',
            });
          } catch (err) {
            return res.status(500).json({ ok: false, erro: err.message });
          }
        }

        return res.json({
          ok:      true,
          tipo:    'exe',
          arquivo: exeName,
          saida:   fullOutput.slice(-1200),
        });
      }

      // ── Fallback: empacota como ZIP ────────────────────────────────────────
      try {
        const zipPath = gerarZip(versao, OUTPUT_DIR);
        return res.json({
          ok:      true,
          tipo:    'zip',
          arquivo: path.basename(zipPath),
          aviso:   'Inno Setup não encontrado — gerado como ZIP. Instale o Inno Setup 6 para gerar o .exe.',
        });
      } catch (err) {
        return res.status(500).json({ ok: false, erro: err.message });
      }
    }
  );

  // ── Download do último arquivo gerado ─────────────────────────────────────
  app.get('/api/ia-command/admin/instalador-agente/download',
    requireAuth, requireIaCommand, canInstall,
    (req, res) => {
      const { arquivo } = req.query;
      if (!arquivo || arquivo.includes('..') || arquivo.includes('/')) {
        return res.status(400).json({ error: 'Nome de arquivo inválido.' });
      }
      const filePath = path.join(OUTPUT_DIR, arquivo);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Arquivo não encontrado. Gere o instalador primeiro.' });
      }
      res.download(filePath, arquivo);
    }
  );
};
