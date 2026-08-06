import "react-native-url-polyfill/auto";
// Must precede createClient: gives auth-js the TextEncoder + crypto.subtle it
// needs to hash a real S256 PKCE challenge instead of falling back to `plain`.
import "./webcrypto-shim";
import { createClient } from "@supabase/supabase-js";
import { secureStoreAdapter } from "./storage";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    // No URL to read a session out of on native — the Google flow hands the
    // callback URL to lib/google-auth.ts explicitly instead.
    detectSessionInUrl: false,
    // auth-js defaults to `implicit`, which returns the tokens themselves in the
    // redirect fragment. PKCE returns a one-shot code that is worthless without
    // the verifier held on this device, so the redirect carries nothing a
    // bystander could replay. `exchangeCodeForSession` requires it.
    flowType: "pkce",
  },
});
