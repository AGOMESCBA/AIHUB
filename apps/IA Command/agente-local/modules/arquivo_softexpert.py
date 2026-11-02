"""Leitura de anexos do SoftExpert gravados em diretorio controlado.

O arquivo fica em <pasta>/<CDFILE com 8 digitos>.<extensao>[.gz] (ex.:
00043254.pdf.gz). O chamador informa so a pasta configurada e o codigo numerico:
o nome e sempre montado aqui, entao nao ha como pedir outro arquivo do servidor.
Somente leitura. Usa apenas a biblioteca padrao.
"""
import base64
import gzip
import os
import re
import zlib
from pathlib import Path

TAMANHO_MAX_BYTES = 25 * 1024 * 1024
CDFILE_MAX = 10 ** 12

_RE_EXTENSAO = re.compile(r"^[A-Za-z0-9]{1,8}$")
_RE_NOME_GRAVADO = re.compile(r"^\d{8,13}\.[A-Za-z0-9]{1,8}(\.gz)?$", re.IGNORECASE)


class ArquivoErro(Exception):
    def __init__(self, codigo, mensagem):
        super().__init__(mensagem)
        self.codigo = codigo


def _validar_pasta(pasta):
    texto = str(pasta or "").strip()
    if not texto:
        raise ArquivoErro("pasta_nao_configurada", "Pasta de arquivos nao configurada.")
    caminho = Path(texto)
    if not caminho.is_absolute() or ".." in caminho.parts:
        raise ArquivoErro("pasta_invalida", "A pasta de arquivos precisa ser um caminho absoluto.")
    try:
        if not caminho.is_dir():
            raise ArquivoErro("pasta_inacessivel", "Pasta de arquivos inacessivel pelo Agente Local.")
    except OSError:
        raise ArquivoErro("pasta_inacessivel", "Pasta de arquivos inacessivel pelo Agente Local.")
    return caminho


def _validar_cdfile(cdfile):
    # bool e subclasse de int: True nao pode virar o arquivo 00000001.
    if isinstance(cdfile, bool):
        raise ArquivoErro("codigo_invalido", "Codigo do arquivo invalido.")
    if isinstance(cdfile, str) and not re.fullmatch(r"\d{1,13}", cdfile):
        raise ArquivoErro("codigo_invalido", "Codigo do arquivo invalido.")
    if not isinstance(cdfile, (int, str)):
        raise ArquivoErro("codigo_invalido", "Codigo do arquivo invalido.")
    numero = int(cdfile)
    if numero <= 0 or numero > CDFILE_MAX:
        raise ArquivoErro("codigo_invalido", "Codigo do arquivo invalido.")
    return numero


def _eh_arquivo(caminho):
    try:
        return caminho.is_file() and not caminho.is_symlink()
    except OSError:
        return False


def _localizar(pasta, cdfile, extensao):
    base = f"{cdfile:08d}"
    ext = str(extensao or "").strip().lstrip(".")
    if ext and _RE_EXTENSAO.match(ext):
        # A extensao gravada pode divergir em maiusculas (00043242.PDF.gz).
        for variante in dict.fromkeys((ext, ext.lower(), ext.upper())):
            for sufixo in (".gz", ".GZ", ""):
                candidato = pasta / f"{base}.{variante}{sufixo}"
                if _eh_arquivo(candidato):
                    return candidato
    # Extensao desconhecida ou divergente do nome de exibicao.
    prefixo = f"{base}."
    try:
        with os.scandir(pasta) as itens:
            for item in itens:
                if item.name.startswith(prefixo) and _RE_NOME_GRAVADO.match(item.name):
                    candidato = pasta / item.name
                    if _eh_arquivo(candidato):
                        return candidato
    except OSError:
        raise ArquivoErro("pasta_inacessivel", "Pasta de arquivos inacessivel pelo Agente Local.")
    raise ArquivoErro("arquivo_nao_encontrado", f"Arquivo {base} nao encontrado na pasta configurada.")


def _ler_conteudo(caminho):
    compactado = caminho.name.lower().endswith(".gz")
    try:
        # Le ate o limite + 1 byte: arquivo compactado nao pode estourar a memoria.
        if compactado:
            with gzip.open(caminho, "rb") as origem:
                conteudo = origem.read(TAMANHO_MAX_BYTES + 1)
                if len(conteudo) <= TAMANHO_MAX_BYTES:
                    origem.read(1)  # chega ao fim do fluxo, onde o gzip confere o CRC
        else:
            with open(caminho, "rb") as origem:
                conteudo = origem.read(TAMANHO_MAX_BYTES + 1)
    except (gzip.BadGzipFile, EOFError, zlib.error):
        raise ArquivoErro("arquivo_corrompido", "Arquivo compactado invalido ou incompleto.")
    except OSError:
        raise ArquivoErro("leitura_falhou", "Nao foi possivel ler o arquivo.")
    if len(conteudo) > TAMANHO_MAX_BYTES:
        raise ArquivoErro("arquivo_grande", f"Arquivo excede o limite de {TAMANHO_MAX_BYTES // (1024 * 1024)} MB.")
    if not conteudo:
        raise ArquivoErro("arquivo_corrompido", "Arquivo vazio.")
    return conteudo, compactado


def ler_arquivo(pasta, cdfile, extensao=None):
    """Devolve {status, nome_gravado, compactado, tamanho, conteudo_base64} ou {status: erro, codigo, erro}."""
    try:
        caminho_pasta = _validar_pasta(pasta)
        numero = _validar_cdfile(cdfile)
        caminho = _localizar(caminho_pasta, numero, extensao)
        conteudo, compactado = _ler_conteudo(caminho)
    except ArquivoErro as exc:
        return {"status": "erro", "codigo": exc.codigo, "erro": str(exc)}
    return {
        "status": "ok",
        "nome_gravado": caminho.name,
        "compactado": compactado,
        "tamanho": len(conteudo),
        "conteudo_base64": base64.b64encode(conteudo).decode("ascii"),
    }
