// The Paseo client (and its relay E2EE layer) rely on the Web Crypto globals
// `crypto.randomUUID` and `crypto.getRandomValues`. Those are only guaranteed
// to exist in "secure contexts":
//
//   - On the web, they are undefined when the dev bundle is served over a
//     plain-HTTP LAN address (e.g. http://10.0.0.5:8081 opened on a phone).
//     In that case `crypto.getRandomValues` exists but `crypto.randomUUID`
//     does NOT (randomUUID requires a secure origin).
//   - In React Native / Expo Go, there is no global `crypto` object at all, so
//     even referencing `crypto.randomUUID()` throws "Property 'crypto' doesn't
//     exist".
//
// `expo-crypto` exposes synchronous `getRandomValues` and `randomUUID`. On the
// web, however, its implementation simply delegates to `globalThis.crypto`.
// If we patched `crypto.randomUUID` with a function that itself calls
// `ExpoCrypto.randomUUID()`, the two would call each other forever
// ("Maximum call stack size exceeded"). So `randomUUID` here is fully
// self-contained: it builds a v4 UUID from random bytes, and those bytes come
// from whatever `getRandomValues` is actually available.
//
// Import this module for its side effects before any Paseo client code runs.

import * as ExpoCrypto from "expo-crypto";

type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
};

// Resolve a getRandomValues implementation without recursing back into the
// global crypto object we may be about to patch. Prefer a pre-existing native
// implementation; otherwise fall back to expo-crypto.
function resolveGetRandomValues(): <T extends ArrayBufferView | null>(
  array: T,
) => T {
  const holder = globalThis as { crypto?: CryptoLike };
  const nativeFn = holder.crypto?.getRandomValues;
  if (typeof nativeFn === "function") {
    // Bind to the real crypto object so `this` is correct.
    return nativeFn.bind(holder.crypto) as <T extends ArrayBufferView | null>(
      array: T,
    ) => T;
  }
  return function getRandomValues<T extends ArrayBufferView | null>(
    array: T,
  ): T {
    if (array == null) {
      return array;
    }
    return ExpoCrypto.getRandomValues(
      array as unknown as never,
    ) as unknown as T;
  };
}

const rng = resolveGetRandomValues();

const HEX: string[] = [];
for (let i = 0; i < 256; i += 1) {
  HEX.push((i + 0x100).toString(16).slice(1));
}

// Self-contained RFC 4122 v4 UUID built from 16 random bytes. Never delegates
// to crypto.randomUUID (which may be this very function on the web).
function randomUUID(): string {
  const bytes = new Uint8Array(16);
  rng(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  return (
    HEX[bytes[0]] +
    HEX[bytes[1]] +
    HEX[bytes[2]] +
    HEX[bytes[3]] +
    "-" +
    HEX[bytes[4]] +
    HEX[bytes[5]] +
    "-" +
    HEX[bytes[6]] +
    HEX[bytes[7]] +
    "-" +
    HEX[bytes[8]] +
    HEX[bytes[9]] +
    "-" +
    HEX[bytes[10]] +
    HEX[bytes[11]] +
    HEX[bytes[12]] +
    HEX[bytes[13]] +
    HEX[bytes[14]] +
    HEX[bytes[15]]
  );
}

function installCrypto(): void {
  const holder = globalThis as { crypto?: CryptoLike };
  const existing = holder.crypto;

  // No global crypto at all (typical in Expo Go / React Native): install one.
  if (!existing) {
    const shim: CryptoLike = { getRandomValues: rng, randomUUID };
    try {
      holder.crypto = shim;
    } catch {
      Object.defineProperty(holder, "crypto", {
        value: shim,
        configurable: true,
        writable: true,
      });
    }
    return;
  }

  // A crypto object exists but is missing pieces (e.g. insecure-context web
  // where getRandomValues is present but randomUUID is not). Patch each gap.
  if (typeof existing.getRandomValues !== "function") {
    defineOrAssign(existing, "getRandomValues", rng);
  }
  if (typeof existing.randomUUID !== "function") {
    defineOrAssign(existing, "randomUUID", randomUUID);
  }
}

function defineOrAssign(
  target: CryptoLike,
  key: "getRandomValues" | "randomUUID",
  value: unknown,
): void {
  try {
    (target as Record<string, unknown>)[key] = value;
  } catch {
    // Some environments expose `crypto` members as read-only; redefine instead.
    Object.defineProperty(target, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
}

installCrypto();
