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

export interface NewStyleInput {
  name: string;
  basedOn?: string;
  bold?: boolean;
  italic?: boolean;
  sizePt?: number;
  alignment?: "left" | "center" | "right" | "both";
  lineSpacing?: number; // multiple: 1, 1.5, 2
  spacingBeforePt?: number;
  spacingAfterPt?: number;
  indentLeftCm?: number;
}

// Create a new custom paragraph style in the thesis's styles.xml; returns the
// created style so the caller can add it to the list / apply it.
export async function createThesisStyle(thesisId: string, input: NewStyleInput): Promise<ThesisStyle> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`${API_URL}/api/thesis/${thesisId}/styles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || `create style ${res.status}`);
  }
  const json = (await res.json()) as { style: ThesisStyle };
  return json.style;
}
