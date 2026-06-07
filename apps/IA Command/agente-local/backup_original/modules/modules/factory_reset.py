import shutil
import subprocess
from pathlib import Path

BASE_DIR     = Path(__file__).parent.parent
BACKUP_DIR   = BASE_DIR / "backup_original"
SERVICE_NAME = "IACommand-Agente"

_ARQUIVOS = ["main.py", "database.py", "auth.py", "config.py"]
_PASTAS   = ["modules"]


def resetar_fabrica():
    """Copia backup_original/ → raiz e reinicia o serviço NSSM."""
    for arq in _ARQUIVOS:
        src = BACKUP_DIR / arq
        dst = BASE_DIR / arq
        if src.exists():
            shutil.copy2(src, dst)

    for pasta in _PASTAS:
        src = BACKUP_DIR / pasta
        dst = BASE_DIR / pasta
        if src.exists():
            shutil.copytree(src, dst, dirs_exist_ok=True)

    _reiniciar_servico()


def _reiniciar_servico():
    try:
        subprocess.Popen(
            ["nssm", "restart", SERVICE_NAME],
            creationflags=subprocess.DETACHED_PROCESS,
        )
        return
    except FileNotFoundError:
        pass

    # Fallback: net stop / net start
    try:
        subprocess.Popen(
            f'net stop "{SERVICE_NAME}" & net start "{SERVICE_NAME}"',
            shell=True,
            creationflags=subprocess.DETACHED_PROCESS,
        )
    except Exception:
        pass
