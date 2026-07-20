import { getAuthHeader } from "@/lib/api";

// Ask the server to REWRITE a single paragraph per an instruction and return the
// proposed text WITHOUT applying it. The caller (suggestion-store) surfaces the
// result inline on the block so the student can approve / edit / reject / redo.
//
// Mirrors POST /api/thesis/:id/paragraphs/:index/suggest — Supabase bearer auth
// (getAuthHeader is the shared Authorization-only header helper in lib/api.ts).
export async function proposeBlockEdit(
  thesisId: string,
  index: number,
  instruction: string,
): Promise<{ proposed: string; original: string }> {
  const res = await fetch(
    `${process.env.EXPO_PUBLIC_API_URL}/api/thesis/${thesisId}/paragraphs/${index}/suggest`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
      body: JSON.stringify({ instruction }),
    },
  );
  if (!res.ok) throw new Error(`suggest ${res.status}`);
  return res.json();
}
