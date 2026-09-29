import { sign, verify } from "node:crypto";
import type {
  SignedVerificationReceipt,
  VerificationReceiptPayload,
  VerificationReport,
} from "./types.js";

export interface SignedVerificationReceiptOptions {
  privateKeyPem: string;
  publicKeyPem: string;
  keyId?: string;
}

export interface ReceiptVerificationOptions {
  publicKeyPem?: string;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Receipt payload contains a non-finite number");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${entries.join(",")}}`;
  }

  throw new TypeError("Receipt payload contains an unsupported value");
}

export function serializeVerificationReceiptPayload(payload: VerificationReceiptPayload): string {
  return canonicalize(payload);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function createSignedVerificationReceipt(
  report: VerificationReport,
  options: SignedVerificationReceiptOptions,
): SignedVerificationReceipt {
  const payload: VerificationReceiptPayload = {
    report,
    publicKeyPem: options.publicKeyPem,
  };
  if (options.keyId !== undefined) {
    payload.keyId = options.keyId;
  }

  const serializedPayload = serializeVerificationReceiptPayload(payload);
  const signature = sign(null, new TextEncoder().encode(serializedPayload), options.privateKeyPem);

  return {
    version: 1,
    algorithm: "Ed25519",
    payload,
    signature: encodeBase64Url(signature),
  };
}

export function verifySignedVerificationReceipt(
  receipt: SignedVerificationReceipt,
  options: ReceiptVerificationOptions = {},
): boolean {
  if (receipt.version !== 1 || receipt.algorithm !== "Ed25519") {
    return false;
  }

  try {
    const publicKeyPem = options.publicKeyPem ?? receipt.payload.publicKeyPem;
    const serializedPayload = serializeVerificationReceiptPayload(receipt.payload);
    return verify(
      null,
      new TextEncoder().encode(serializedPayload),
      publicKeyPem,
      decodeBase64Url(receipt.signature),
    );
  } catch {
    return false;
  }
}
