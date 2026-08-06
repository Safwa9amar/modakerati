/**
 * The slice of WebCrypto that Supabase's PKCE flow needs, backed by expo-crypto.
 *
 * `@supabase/auth-js` derives the S256 code challenge with `new TextEncoder()`
 * and `crypto.subtle.digest("SHA-256", …)`. Hermes ships neither, and auth-js
 * does not fail when they're missing — it logs "WebCrypto API is not supported"
 * and silently downgrades the challenge to `plain`, which puts the code verifier
 * itself in the authorization URL. Supplying the two calls it actually makes
 * keeps us on S256.
 *
 * Import this for its side effect BEFORE creating the Supabase client (see
 * lib/supabase.ts) — the checks it satisfies run when the challenge is
 * generated, but the globals have to be in place before anything can look.
 *
 * Every assignment is guarded, so on web — where the real implementations
 * already exist and are the ones we want — this module does nothing.
 */

/**
 * expo-crypto resolves its native module at IMPORT time, so on a binary built
 * before it was added the import itself throws "Cannot find native module
 * 'ExpoCrypto'". This module sits under lib/supabase.ts, which the root layout
 * pulls in on every launch, so an unguarded import takes the WHOLE APP down at
 * boot rather than costing us one feature. Degrade instead: see the comment on
 * the install block below for what we deliberately do NOT do without it.
 */
let Crypto: typeof import("expo-crypto") | null = null;
try {
  Crypto = require("expo-crypto") as typeof import("expo-crypto");
} catch {
  Crypto = null;
}

const g = globalThis as any;

/** Assign through a read-only getter or a frozen object if a plain write bounces. */
function install(target: any, key: string, value: unknown) {
  try {
    target[key] = value;
    if (target[key] === value) return;
  } catch {
    // fall through to defineProperty
  }
  try {
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
  } catch {
    // Nothing more to try. auth-js falls back to a `plain` challenge, which
    // still authenticates — it is only weaker.
  }
}

// Pure JS, no native dependency, so this half is always safe to install.
if (typeof g.TextEncoder === "undefined") {
  install(
    g,
    "TextEncoder",
    class TextEncoder {
      readonly encoding = "utf-8";

      encode(input = ""): Uint8Array {
        const bytes: number[] = [];
        for (let i = 0; i < input.length; i++) {
          let cp = input.charCodeAt(i);

          // JS strings are UTF-16: an astral character arrives as a surrogate
          // PAIR that has to be recombined into the one code point it stands
          // for. A surrogate with no partner is not encodable — the spec says
          // to emit U+FFFD rather than invent bytes for it.
          if (cp >= 0xd800 && cp <= 0xdbff) {
            const low = input.charCodeAt(i + 1);
            if (low >= 0xdc00 && low <= 0xdfff) {
              cp = (cp - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
              i++;
            } else {
              cp = 0xfffd;
            }
          } else if (cp >= 0xdc00 && cp <= 0xdfff) {
            cp = 0xfffd;
          }

          if (cp < 0x80) {
            bytes.push(cp);
          } else if (cp < 0x800) {
            bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
          } else if (cp < 0x10000) {
            bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
          } else {
            bytes.push(
              0xf0 | (cp >> 18),
              0x80 | ((cp >> 12) & 0x3f),
              0x80 | ((cp >> 6) & 0x3f),
              0x80 | (cp & 0x3f),
            );
          }
        }
        return new Uint8Array(bytes);
      }
    },
  );
}

// Without expo-crypto we install NOTHING here, on purpose — a half-built
// `crypto` is worse than none. auth-js's generatePKCEVerifier only tests
// `typeof crypto === 'undefined'` before calling `crypto.getRandomValues`, so an
// object that exists but lacks that method turns a graceful Math.random +
// `plain` fallback into a TypeError mid-sign-in.
if (Crypto) {
  const cryptoModule = Crypto;

  if (typeof g.crypto === "undefined") install(g, "crypto", {});

  if (typeof g.crypto?.getRandomValues !== "function") {
    install(g.crypto, "getRandomValues", (array: any) => cryptoModule.getRandomValues(array));
  }

  if (typeof g.crypto?.subtle === "undefined") {
    install(g.crypto, "subtle", {
      // The only algorithm auth-js asks for. Anything else is better off
      // throwing than quietly returning the wrong digest.
      digest: (algorithm: string | { name: string }, data: BufferSource) => {
        const name = typeof algorithm === "string" ? algorithm : algorithm?.name;
        return cryptoModule.digest(name as any, data);
      },
    });
  }
}
