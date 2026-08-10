function requiredText(value, name, maximum = 4096) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${name} is required and must be at most ${maximum} characters.`);
  }
  return value;
}

function bytesFromHex(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new TypeError("payment action encryption key must be exactly 32 bytes of hex.");
  }
  return Uint8Array.from(value.match(/../g), (pair) => Number.parseInt(pair, 16));
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function bytesFromBase64Url(value, name) {
  requiredText(value, name, 8192);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError(`${name} is not valid base64url.`);
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function additionalData(context) {
  return new TextEncoder().encode(JSON.stringify([
    requiredText(context?.businessId, "businessId", 128),
    requiredText(context?.bookingId, "bookingId", 128),
    requiredText(context?.attemptId, "attemptId", 128),
    requiredText(context?.route, "route", 128),
  ]));
}

async function key(options) {
  return crypto.subtle.importKey(
    "raw",
    bytesFromHex(options?.encryptionKeyHex),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function keyVersion(options) {
  const version = requiredText(options?.keyVersion, "keyVersion", 64);
  if (!/^[A-Za-z0-9._-]+$/.test(version)) throw new TypeError("keyVersion is invalid.");
  return version;
}

export async function sealPaymentActionToken(token, context, options) {
  const plaintext = new TextEncoder().encode(requiredText(token, "providerAccessToken"));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: additionalData(context), tagLength: 128 },
    await key(options),
    plaintext,
  );
  return Object.freeze({
    ciphertext: base64Url(new Uint8Array(ciphertext)),
    nonce: base64Url(nonce),
    keyVersion: keyVersion(options),
  });
}

export async function openPaymentActionToken(sealed, context, options) {
  if (requiredText(sealed?.keyVersion, "keyVersion", 64) !== keyVersion(options)) {
    throw new Error("The payment action key version is unavailable.");
  }
  const nonce = bytesFromBase64Url(sealed?.nonce, "nonce");
  if (nonce.length !== 12) throw new TypeError("nonce must be exactly 12 bytes.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, additionalData: additionalData(context), tagLength: 128 },
    await key(options),
    bytesFromBase64Url(sealed?.ciphertext, "ciphertext"),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}
