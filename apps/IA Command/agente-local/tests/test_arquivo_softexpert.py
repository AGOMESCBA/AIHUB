# python -m unittest discover -s tests  (na pasta agente-local)
import base64
import gzip
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from modules import arquivo_softexpert as modulo  # noqa: E402

PDF = b"%PDF-1.4 conteudo de teste " * 50


class LeituraTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.pasta = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def gravar_gz(self, nome, conteudo=PDF):
        with gzip.open(self.pasta / nome, "wb") as destino:
            destino.write(conteudo)

    def test_descompacta_e_devolve_o_original(self):
        self.gravar_gz("00043254.pdf.gz")
        r = modulo.ler_arquivo(str(self.pasta), 43254, "pdf")
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["nome_gravado"], "00043254.pdf.gz")
        self.assertTrue(r["compactado"])
        self.assertEqual(r["tamanho"], len(PDF))
        self.assertEqual(base64.b64decode(r["conteudo_base64"]), PDF)

    def test_extensao_em_maiuscula(self):
        self.gravar_gz("00043242.PDF.gz")
        r = modulo.ler_arquivo(str(self.pasta), "43242", "pdf")
        self.assertEqual(r["status"], "ok")
        self.assertEqual(base64.b64decode(r["conteudo_base64"]), PDF)

    def test_sem_extensao_procura_pelo_codigo(self):
        self.gravar_gz("00000007.docx.gz")
        r = modulo.ler_arquivo(str(self.pasta), 7)
        self.assertEqual(r["nome_gravado"], "00000007.docx.gz")

    def test_arquivo_sem_compactacao(self):
        (self.pasta / "00000008.txt").write_bytes(b"texto")
        r = modulo.ler_arquivo(str(self.pasta), 8, "txt")
        self.assertFalse(r["compactado"])
        self.assertEqual(base64.b64decode(r["conteudo_base64"]), b"texto")

    def test_nao_encontrado(self):
        r = modulo.ler_arquivo(str(self.pasta), 99, "pdf")
        self.assertEqual(r["codigo"], "arquivo_nao_encontrado")

    def test_pasta_inexistente_relativa_ou_vazia(self):
        self.assertEqual(modulo.ler_arquivo(str(self.pasta / "nao-existe"), 1, "pdf")["codigo"], "pasta_inacessivel")
        self.assertEqual(modulo.ler_arquivo("relativa", 1, "pdf")["codigo"], "pasta_invalida")
        self.assertEqual(modulo.ler_arquivo(str(self.pasta / ".." / "x"), 1, "pdf")["codigo"], "pasta_invalida")
        self.assertEqual(modulo.ler_arquivo("", 1, "pdf")["codigo"], "pasta_nao_configurada")

    def test_codigo_invalido_nao_vira_caminho(self):
        for invalido in ("../segredo", "1;2", "-1", 0, -5, True, None, 1.5, ["1"], "", 10 ** 13):
            r = modulo.ler_arquivo(str(self.pasta), invalido, "pdf")
            self.assertEqual(r["codigo"], "codigo_invalido", repr(invalido))

    def test_extensao_nao_escapa_da_pasta(self):

        sub = self.pasta / "sub"
        sub.mkdir()
        (sub / "00000001.txt").write_bytes(b"segredo")
        for extensao in ("../sub/00000001.txt", "..\\sub\\x", "txt/../../x", "a b"):
            r = modulo.ler_arquivo(str(self.pasta), 1, extensao)
            self.assertEqual(r["codigo"], "arquivo_nao_encontrado", extensao)

    def test_nome_fora_do_padrao_e_ignorado(self):
        (self.pasta / "00000002.pdf.gz.bak").write_bytes(b"x")
        (self.pasta / "00000002.a.b.c").write_bytes(b"x")
        self.assertEqual(modulo.ler_arquivo(str(self.pasta), 2)["codigo"], "arquivo_nao_encontrado")

    def test_gzip_corrompido_e_truncado(self):
        (self.pasta / "00000003.pdf.gz").write_bytes(b"nao e gzip")
        self.assertEqual(modulo.ler_arquivo(str(self.pasta), 3, "pdf")["codigo"], "arquivo_corrompido")
        self.gravar_gz("00000004.pdf.gz", os.urandom(4096))
        caminho = self.pasta / "00000004.pdf.gz"
        caminho.write_bytes(caminho.read_bytes()[:-10])
        self.assertEqual(modulo.ler_arquivo(str(self.pasta), 4, "pdf")["codigo"], "arquivo_corrompido")

    def test_crc_invalido_e_recusado(self):
        self.gravar_gz("00000005.pdf.gz")
        caminho = self.pasta / "00000005.pdf.gz"
        dados = bytearray(caminho.read_bytes())
        dados[-8] ^= 0xFF
        caminho.write_bytes(bytes(dados))
        self.assertEqual(modulo.ler_arquivo(str(self.pasta), 5, "pdf")["codigo"], "arquivo_corrompido")

    def test_limite_de_tamanho_vale_depois_de_descompactar(self):
        with mock.patch.object(modulo, "TAMANHO_MAX_BYTES", 1024):
            self.gravar_gz("00000006.pdf.gz", b"\0" * 100000)
            self.assertEqual(modulo.ler_arquivo(str(self.pasta), 6, "pdf")["codigo"], "arquivo_grande")

    def test_vazio(self):
        self.gravar_gz("00000009.pdf.gz", b"")
        self.assertEqual(modulo.ler_arquivo(str(self.pasta), 9, "pdf")["codigo"], "arquivo_corrompido")


if __name__ == "__main__":
    unittest.main()
