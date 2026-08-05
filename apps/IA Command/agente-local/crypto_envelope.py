import base64
import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ENVELOPE_VERSION = 1
ENVELOPE_ALG = "AES-256-GCM"
IV_BYTES = 12
TAG_BYTES = 16


def is_encrypted_envelope(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and value.get("v") == ENVELOPE_VERSION
        and value.get("enc") == ENVELOPE_ALG
        and isinstance(value.get("iv"), str)
        and isinstance(value.get("tag"), str)
        and isinstance(value.get("data"), str)
    )


def normalize_key(key: str) -> bytes:
    raw = (key or "").strip()
    if not raw:
        raise ValueError("Chave de criptografia nao configurada.")

    try:
        if len(raw) == 64 and all(c in "0123456789abcdefABCDEF" for c in raw):
            key_bytes = bytes.fromhex(raw)
        else:
            key_bytes = base64.b64decode(raw, validate=True)
    except Exception as exc:
        raise ValueError("Chave de criptografia invalida: formato base64/hex invalido.") from exc

    if len(key_bytes) != 32:
        raise ValueError("Chave de criptografia invalida: esperado 32 bytes (AES-256).")
    return key_bytes


def generate_key_base64() -> str:
    return base64.b64encode(os.urandom(32)).decode("ascii")


def encrypt_payload(payload: Any, key: str, kid: str = "default") -> dict:
    key_bytes = normalize_key(key)
    iv = os.urandom(IV_BYTES)
    plaintext = json.dumps(payload if payload is not None else {}, ensure_ascii=False, default=str).encode("utf-8")
    encrypted_with_tag = AESGCM(key_bytes).encrypt(iv, plaintext, None)
    ciphertext = encrypted_with_tag[:-TAG_BYTES]
    tag = encrypted_with_tag[-TAG_BYTES:]
    return {
        "v": ENVELOPE_VERSION,
        "enc": ENVELOPE_ALG,
        "kid": kid,
        "iv": base64.b64encode(iv).decode("ascii"),
        "tag": base64.b64encode(tag).decode("ascii"),
        "data": base64.b64encode(ciphertext).decode("ascii"),
    }


def encrypt_text(plaintext: str, key: str) -> str:
    """Cifra uma string simples (ex.: senha) em um envelope serializado como JSON."""
    envelope = encrypt_payload(plaintext, key)
    return json.dumps(envelope)


def decrypt_text(stored: str, key: str) -> str:
    """Decifra o resultado de encrypt_text. Retorna '' se stored estiver vazio."""
    if not stored:
        return ""
    envelope = json.loads(stored)
    return decrypt_payload(envelope, key)


def decrypt_payload(envelope: dict, key: str) -> Any:
    if not is_encrypted_envelope(envelope):
        raise ValueError("Envelope criptografado invalido.")

    key_bytes = normalize_key(key)
    try:
        iv = base64.b64decode(envelope["iv"], validate=True)
        tag = base64.b64decode(envelope["tag"], validate=True)
        data = base64.b64decode(envelope["data"], validate=True)
    except Exception as exc:
        raise ValueError("Envelope criptografado contem base64 invalido.") from exc

    if len(iv) != IV_BYTES:
        raise ValueError("IV invalido no envelope criptografado.")
    if len(tag) != TAG_BYTES:
        raise ValueError("Tag invalida no envelope criptografado.")

    plaintext = AESGCM(key_bytes).decrypt(iv, data + tag, None)
    return json.loads(plaintext.decode("utf-8"))
