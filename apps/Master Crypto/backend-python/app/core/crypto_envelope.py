import base64
import json
import os
import re
from typing import Any, Dict

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


def normalize_key(key: str | None) -> bytes:
    raw = str(key or "").strip()
    if not raw:
        raise ValueError("Chave de criptografia nao configurada.")

    if re.fullmatch(r"[0-9a-fA-F]{64}", raw):
        key_bytes = bytes.fromhex(raw)
    else:
        key_bytes = base64.b64decode(raw)

    if len(key_bytes) != 32:
        raise ValueError("Chave de criptografia invalida: esperado 32 bytes (AES-256).")
    return key_bytes


def _secret_key() -> str:
    key = os.getenv("MASTER_CRYPTO_DATA_CRYPTO_KEY") or os.getenv("SVC_DATA_CRYPTO_KEY")
    if not key:
        raise ValueError(
            "MASTER_CRYPTO_DATA_CRYPTO_KEY nao configurada. Defina uma chave AES-256 "
            "(32 bytes, base64 ou hex) antes de armazenar credenciais de exchange."
        )
    return key


def encrypt_payload(payload: Dict[str, Any], key: str, kid: str = "default") -> Dict[str, str | int]:
    key_bytes = normalize_key(key)
    iv = os.urandom(IV_BYTES)
    plaintext = json.dumps(payload or {}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encrypted_with_tag = AESGCM(key_bytes).encrypt(iv, plaintext, None)
    data = encrypted_with_tag[:-TAG_BYTES]
    tag = encrypted_with_tag[-TAG_BYTES:]
    return {
        "v": ENVELOPE_VERSION,
        "enc": ENVELOPE_ALG,
        "kid": kid,
        "iv": base64.b64encode(iv).decode("ascii"),
        "tag": base64.b64encode(tag).decode("ascii"),
        "data": base64.b64encode(data).decode("ascii"),
    }


def decrypt_payload(envelope: Dict[str, Any], key: str) -> Dict[str, Any]:
    if not is_encrypted_envelope(envelope):
        raise ValueError("Envelope criptografado invalido.")
    key_bytes = normalize_key(key)
    iv = base64.b64decode(envelope["iv"])
    tag = base64.b64decode(envelope["tag"])
    data = base64.b64decode(envelope["data"])
    if len(iv) != IV_BYTES:
        raise ValueError("IV invalido no envelope criptografado.")
    if len(tag) != TAG_BYTES:
        raise ValueError("Tag invalida no envelope criptografado.")
    plaintext = AESGCM(key_bytes).decrypt(iv, data + tag, None)
    return json.loads(plaintext.decode("utf-8"))


def encrypt_secret(plain_text: str | None) -> str:
    if plain_text is None or plain_text == "":
        return ""
    envelope = encrypt_payload({"s": str(plain_text)}, _secret_key())
    return json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))


def decrypt_secret(stored_text: str | None, *, allow_plaintext_legacy: bool = True) -> str:
    if not stored_text:
        return ""
    try:
        envelope = json.loads(stored_text)
    except (TypeError, json.JSONDecodeError):
        if allow_plaintext_legacy:
            return str(stored_text)
        raise ValueError("Segredo armazenado em formato invalido.")

    if not is_encrypted_envelope(envelope):
        if allow_plaintext_legacy:
            return str(stored_text)
        raise ValueError("Envelope criptografado invalido.")

    payload = decrypt_payload(envelope, _secret_key())
    return str(payload.get("s") or "")


def mask_secret(value: str | None, *, keep_start: int = 4, keep_end: int = 4) -> str:
    raw = str(value or "")
    if not raw:
        return ""
    if len(raw) <= keep_start + keep_end:
        return "*" * len(raw)
    return f"{raw[:keep_start]}{'*' * 8}{raw[-keep_end:]}"
