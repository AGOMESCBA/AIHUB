'use strict';

// G4 (Antigravity) — validação de arquivos e download seguro de mídia por URL.
// Assinaturas CONGELADAS na C0: C3 (envio) chama exatamente estas funções.
// Funções puras/isoladas: não acessam banco, sessão nem nada fora desta pasta.
// Testes de contrato: apps/IA Talk/tests/g4-midia.test.js (tirar o `todo`).

class ErroMidia extends Error {
  /**
   * @param {'url_invalida'|'destino_bloqueado'|'tempo_esgotado'|'arquivo_grande'|'falha_download'|'tipo_nao_suportado'|'arquivo_invalido'} codigo
   * @param {string} mensagem texto em pt-BR para a pessoa ler
   */
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroMidia';
    this.codigo = codigo;
  }
}

function _naoImplementado(nome) {
  const err = new Error(`${nome}: ainda não implementado (etapa G4).`);
  err.codigo = 'nao_implementado';
  return err;
}

/**
 * Descobre o tipo real pelo conteúdo (assinatura de bytes), nunca pela
 * extensão nem pelo mime informado. Cobrir no mínimo: PNG, JPEG, WEBP, GIF,
 * PDF, ZIP/OOXML (xlsx, docx, pptx), OGG, MP3, MP4.
 * @param {Buffer} dados
 * @returns {string|null} mime detectado ou null se desconhecido
 */
function detectarMime(dados) { // eslint-disable-line no-unused-vars
  throw _naoImplementado('detectarMime');
}

/**
 * Valida um arquivo antes de enviar.
 * @param {{ nome: string, mime: string, dados: Buffer }} arquivo
 * @param {{ mimesAceitos: string[], limiteBytes: number }} regras  (vêm das capacidades do canal)
 * @returns {{ ok: true, mime: string, tamanho: number, nome: string }
 *          | { ok: false, codigo: 'arquivo_invalido'|'tipo_nao_suportado'|'arquivo_grande', mensagem: string }}
 * Regras: nome sem caminho (remover / \ ..), mime informado deve bater com o
 * detectado (senão 'arquivo_invalido'), vazio = 'arquivo_invalido'.
 */
function validarArquivo(arquivo, regras) { // eslint-disable-line no-unused-vars
  throw _naoImplementado('validarArquivo');
}

/**
 * true se o IP não pode ser destino de download: loopback, privados (10/8,
 * 172.16/12, 192.168/16), link-local (169.254/16, fe80::/10), CGNAT
 * (100.64/10), 0.0.0.0/8, multicast, ULA (fc00::/7), ::1, IPv4 mapeado em
 * IPv6 (::ffff:a.b.c.d) com qualquer um desses.
 * @param {string} ip
 * @returns {boolean}
 */
function ipBloqueado(ip) { // eslint-disable-line no-unused-vars
  throw _naoImplementado('ipBloqueado');
}

/**
 * Baixa mídia de uma URL com proteção SSRF.
 * Regras: só https; resolve o DNS e recusa se QUALQUER endereço for
 * bloqueado; conecta no IP já conferido (evita troca de DNS no meio);
 * reconfere a cada redirecionamento; para ao passar de limiteBytes; não envia
 * cookies nem credenciais.
 * @param {string} url
 * @param {{ limiteBytes?: number, tempoMs?: number, maxRedirecionamentos?: number,
 *           resolverDns?: (host: string) => Promise<string[]> }} [opcoes]
 *        padrões: 16 MB, 15000 ms, 3 redirecionamentos, dns.promises.lookup(all)
 * @returns {Promise<{ dados: Buffer, mime: string, nome: string }>}
 * @throws {ErroMidia}
 */
async function baixarUrlSegura(url, opcoes = {}) { // eslint-disable-line no-unused-vars
  throw _naoImplementado('baixarUrlSegura');
}

module.exports = { ErroMidia, detectarMime, validarArquivo, ipBloqueado, baixarUrlSegura };
