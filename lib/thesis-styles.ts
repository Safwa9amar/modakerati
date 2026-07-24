// Fetch helper for the thesis's real Word styles (word/styles.xml), used by the
// Insert drawer's Styles tab. Deliberately separate from lib/api.ts (DO-NOT-TOUCH)
// — replicates its private auth pattern (Supabase session token + global fetch).
import { supabase } from "./supabase";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export interface ThesisStyle {
  id: string;
  name: string;
  type: "paragraph" | "character" | string;
}

export async function getThesisStyles(thesisId: string): Promise<ThesisStyle[]> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`${API_URL}/api/thesis/${thesisId}/styles`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`styles ${res.status}`);
  const json = (await res.json()) as { styles?: ThesisStyle[] };
  return json.styles ?? [];
}
