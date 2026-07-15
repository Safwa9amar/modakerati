import { fetch as expoFetch } from "expo/fetch";
import { supabase } from "./supabase";
import i18n from "./i18n";
import type {
  AppNotification,
  NotificationPreferences,
} from "@/types/notification";
import type { AskPayload, FilePayload } from "@/types/chat";
import type { NewsArticle, NewsCopy, NewsPagination, NewsRow } from "@/types/news";
import type {
  Align,
  DocumentContent,
  DocumentRecord,
  ParagraphMutationResult,
} from "@/types/document";
import type { Thesis, Template, NormProfile } from "@/types/thesis";
import type { ThesisSource } from "@/types/source";

const API_URL = process.env.EXPO_PUBLIC_API_URL

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiGet<T>(path: string): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_URL}${path}`, { headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API Error: ${response.status}`);
  }
  return response.json();
}

async function apiPost<T>(path: string, body: any): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API Error: ${response.status}`);
  }
  return response.json();
}

async function apiPut<T>(path: string, body: any): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_URL}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API Error: ${response.status}`);
  }
  return response.json();
}

async function apiDelete(path: string): Promise<void> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_URL}${path}`, { method: "DELETE", headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API Error: ${response.status}`);
  }
}

async function apiDeleteWithBody<T>(path: string, body: any): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_URL}${path}`, {
    method: "DELETE",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API Error: ${response.status}`);
  }
  return response.json();
}

// ============================================================
// Chat API
// ============================================================

export interface ChatSendResponse {
  response: string;
  model: string;
  provider: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  // Set when the turn ended on a question → the app opens the ask bottom sheet.
  ask?: AskPayload;
  // Downloadable artifacts produced this turn (e.g. an export), rendered as cards.
  files?: FilePayload[];
}

export async function chatSend(
  thesisId: string,
  message: string,
  options?: { chapterId?: string; sectionId?: string; selection?: string; docBlockIndex?: number | null; docBlockIndices?: number[] }
): Promise<ChatSendResponse> {
  return apiPost("/api/chat/send", {
    thesisId,
    message,
    chapterId: options?.chapterId,
    sectionId: options?.sectionId,
    selection: options?.selection,
    // Live-.docx (L2): the engine block index the student selected, so the AI
    // edits that exact paragraph. `null` when nothing block-specific is focused.
    docBlockIndex: options?.docBlockIndex ?? null,
    // Multi-select: every block the student long-pressed, so the AI acts on the
    // whole set. Omitted when there's a single (or no) selection.
    docBlockIndices: options?.docBlockIndices,
  });
}

/** One AI-generated composer quick-action chip. */
export interface ComposerSuggestion {
  label: string;
  prompt: string;
}

// Fetch dynamic composer quick-action chips for a thesis, grounded in the recent
// conversation + the current selection + RAG context. Best-effort: the server
// returns an empty array on any failure, and callers fall back to static presets.
export async function getComposerSuggestions(
  thesisId: string,
  options?: { selection?: string; docBlockIndex?: number | null; docBlockIndices?: number[] }
): Promise<ComposerSuggestion[]> {
  const res = await apiPost<{ suggestions?: ComposerSuggestion[] }>("/api/chat/suggestions", {
    thesisId,
    selection: options?.selection,
    docBlockIndex: options?.docBlockIndex ?? null,
    docBlockIndices: options?.docBlockIndices,
  });
  return Array.isArray(res?.suggestions) ? res.suggestions : [];
}

// Pass `since` (an ISO timestamp) to fetch only messages created after it —
// the incremental sync path used by the on-device cache.
export async function getChatHistory(thesisId: string, since?: string | null) {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  return apiGet<any[]>(`/api/chat/${thesisId}${query}`);
}

export interface ChatStreamHandlers {
  onDelta: (chunk: string) => void;
  onAsk?: (ask: AskPayload) => void;
  onThinking?: (chunk: string) => void;
  onFile?: (file: FilePayload) => void;
}

// The streaming endpoint escapes emoji (astral chars) to \uXXXX because RN's
// native networking corrupts 4-byte UTF-8 mid-stream. Reverse it here. Adjacent
// escapes for a surrogate pair sit next to each other, so the two code units
// reconstruct the astral character.
function unescapeUnicode(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Index up to which `s` is safe to decode now — everything except a trailing
// partial \uXXXX (or lone backslash) that may complete in the next chunk.
function safeEscapeBoundary(s: string): number {
  const m = s.match(/\\(?:u[0-9a-fA-F]{0,3})?$/);
  return m && m.index !== undefined ? m.index : s.length;
}

/**
 * Streams the AI response from `/api/chat/stream`, invoking `onDelta` for each
 * text chunk as it arrives. Uses `expo/fetch`, whose Response exposes a real
 * `ReadableStream` body (the standard RN fetch buffers the whole response).
 * Bytes are decoded with a streaming TextDecoder so multi-byte UTF-8 (Arabic)
 * isn't corrupted when a character is split across chunks.
 */
export async function chatSendStream(
  thesisId: string,
  message: string,
  handlers: ChatStreamHandlers,
  options?: { chapterId?: string; sectionId?: string; selection?: string; docBlockIndex?: number | null; docBlockIndices?: number[]; signal?: AbortSignal }
): Promise<void> {
  const headers = await getAuthHeaders();
  const response = await expoFetch(`${API_URL}/api/chat/stream`, {
    method: "POST",
    headers,
    // `docBlockIndex` (live-.docx, L2): the selected engine block index → the AI
    // edits that paragraph. `docBlockIndices` carries a multi-select set so the AI
    // acts on all of them. Legacy fields (chapterId/sectionId/selection) stay so
    // the server's legacy chapter/section path keeps working unchanged.
    body: JSON.stringify({
      thesisId,
      message,
      chapterId: options?.chapterId,
      sectionId: options?.sectionId,
      selection: options?.selection,
      docBlockIndex: options?.docBlockIndex ?? null,
      docBlockIndices: options?.docBlockIndices,
    }),
    signal: options?.signal,
  });

  if (!response.ok || !response.body) {
    const err = new Error(`API Error: ${response.status}`) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  // Holds a trailing partial \uXXXX escape that straddles a chunk boundary until
  // the rest arrives, so an emoji is never decoded half-formed.
  let pending = "";

  // Control-region markers (must match the server). Reasoning streams between the
  // THINK markers → onThinking; the ask frame carries JSON between ASK markers.
  const THINK_OPEN = "[[MODK_THINK]]";
  const THINK_CLOSE = "[[/MODK_THINK]]";
  const ASK_OPEN = "[[MODK_ASK]]";
  const ASK_CLOSE = "[[/MODK_ASK]]";
  const FILE_OPEN = "[[MODK_FILE]]";
  const FILE_CLOSE = "[[/MODK_FILE]]";

  let mode: "answer" | "think" = "answer";
  let buf = ""; // unescaped text awaiting routing

  // How many trailing chars of `s` to hold back because they may be the start of
  // one of `markers` that completes in the next chunk.
  const heldLen = (s: string, markers: string[]): number => {
    let max = 0;
    for (const m of markers) {
      for (let k = Math.min(m.length - 1, s.length); k > 0; k--) {
        if (s.endsWith(m.slice(0, k))) { if (k > max) max = k; break; }
      }
    }
    return max;
  };

  const pump = (chunk: string, isFinal: boolean) => {
    buf += chunk;
    while (true) {
      if (mode === "answer") {
        const ti = buf.indexOf(THINK_OPEN);
        const ai = buf.indexOf(ASK_OPEN);
        const fi = buf.indexOf(FILE_OPEN);
        const first = [ti, ai, fi].filter((i) => i !== -1).sort((a, b) => a - b)[0];
        if (first === undefined) {
          const hold = isFinal ? 0 : heldLen(buf, [THINK_OPEN, ASK_OPEN, FILE_OPEN]);
          const out = buf.slice(0, buf.length - hold);
          if (out) handlers.onDelta(out);
          buf = buf.slice(buf.length - hold);
          break;
        }
        const before = buf.slice(0, first);
        if (before) handlers.onDelta(before);
        if (first === ti) {
          buf = buf.slice(first + THINK_OPEN.length);
          mode = "think";
          continue;
        }
        if (first === fi) {
          // FILE frame: need the closing marker before we can parse the JSON. The
          // frame never reaches onDelta, so the raw JSON is never shown as text.
          const closeAt = buf.indexOf(FILE_CLOSE, first + FILE_OPEN.length);
          if (closeAt === -1) { buf = buf.slice(first); break; }
          try { handlers.onFile?.(JSON.parse(buf.slice(first + FILE_OPEN.length, closeAt))); } catch {}
          buf = buf.slice(closeAt + FILE_CLOSE.length);
          continue;
        }
        // ASK frame: need the closing marker before we can parse the JSON.
        const closeAt = buf.indexOf(ASK_CLOSE, first + ASK_OPEN.length);
        if (closeAt === -1) { buf = buf.slice(first); break; }
        try { handlers.onAsk?.(JSON.parse(buf.slice(first + ASK_OPEN.length, closeAt))); } catch {}
        buf = buf.slice(closeAt + ASK_CLOSE.length);
        continue;
      } else {
        const ci = buf.indexOf(THINK_CLOSE);
        if (ci === -1) {
          const hold = isFinal ? 0 : heldLen(buf, [THINK_CLOSE]);
          const out = buf.slice(0, buf.length - hold);
          if (out) handlers.onThinking?.(out);
          buf = buf.slice(buf.length - hold);
          break;
        }
        const reason = buf.slice(0, ci);
        if (reason) handlers.onThinking?.(reason);
        buf = buf.slice(ci + THINK_CLOSE.length);
        mode = "answer";
        continue;
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const cut = safeEscapeBoundary(pending);
      const ready = pending.slice(0, cut);
      pending = pending.slice(cut);
      if (ready) pump(unescapeUnicode(ready), false);
    }
    pending += decoder.decode();
    pump(pending ? unescapeUnicode(pending) : "", true);
  } finally {
    reader.releaseLock();
  }
}

// ============================================================
// Thesis API
// ============================================================

export async function listTheses() {
  return apiGet<Thesis[]>("/api/thesis");
}

export async function getThesis(id: string) {
  return apiGet<Thesis>(`/api/thesis/${id}`);
}

export async function createThesis(input: {
  title: string;
  templateId?: string;
  normProfileId?: string;
  language?: string;
  // The generated outline that SEEDS the working .docx. It is not persisted as
  // section/chapter rows — the .docx is the source of truth.
  sections?: Array<{ title: string; kind?: "introduction" | "section" | "conclusion"; chapters?: Array<{ title: string; content?: string }> }>;
}) {
  return apiPost<Thesis>("/api/thesis", input);
}

// AI autocomplete for the thesis title — returns a few suggested titles for the
// user's partial input. Best-effort: never throws (returns [] on failure).
export async function suggestThesisTitles(input: string, language?: string): Promise<string[]> {
  try {
    const res = await apiPost<{ suggestions: string[] }>("/api/thesis/title-suggestions", {
      input,
      // Only a tiebreaker for short/ambiguous input — the server primarily matches
      // the language the user is actually typing in.
      language: language ?? i18n.language,
    });
    return res.suggestions ?? [];
  } catch {
    return [];
  }
}

export async function updateThesis(id: string, updates: any) {
  return apiPut<any>(`/api/thesis/${id}`, updates);
}

export async function deleteThesis(id: string) {
  return apiDelete(`/api/thesis/${id}`);
}

export async function listTemplates() {
  return apiGet<Template[]>("/api/templates");
}

export async function listNormProfiles() {
  return apiGet<NormProfile[]>("/api/norm-profiles");
}

export async function getNormProfile(id: string) {
  return apiGet<NormProfile>(`/api/norm-profiles/${id}`);
}

export async function generateThesisPlan(input: { title: string; language?: string; bodyPreset?: string; templateId?: string }) {
  return apiPost<{ sections: Array<{ title: string; kind: "introduction" | "section" | "conclusion"; chapters: Array<{ title: string; hint?: string; content?: string }> }> }>("/api/thesis/generate-plan", input);
}

// ============================================================
// Thesis Import & Analysis API
// ============================================================

export interface AnalysisSuggestion {
  id: string;
  category: "structure" | "formatting" | "content";
  severity: "error" | "warning" | "info";
  message: string;
  fix: string | null;
}

export interface AnalysisReport {
  structure: AnalysisSuggestion[];
  formatting: AnalysisSuggestion[];
  content: AnalysisSuggestion[];
}

export async function importThesis(input: {
  base64: string;
  filename: string;
  language?: string;
  normProfileId?: string;
}): Promise<{ thesis: Thesis; analysisReport: AnalysisReport | null }> {
  return apiPost("/api/thesis/import", input);
}

export async function getThesisAnalysis(thesisId: string): Promise<AnalysisReport> {
  return apiGet(`/api/thesis/${thesisId}/analysis`);
}

export async function applyThesisSuggestions(thesisId: string, acceptedIds: string[]): Promise<{ applied: string[] }> {
  return apiPost(`/api/thesis/${thesisId}/apply`, { acceptedIds });
}

export async function formatThesis(
  thesisId: string,
  normProfileId?: string
): Promise<{ formatted: boolean; applied: string[]; skipped: string[] }> {
  return apiPost(`/api/thesis/${thesisId}/format`, normProfileId ? { normProfileId } : {});
}

// ============================================================
// Combine documents API
// Mirrors the server DTOs from POST /api/thesis/combine/classify and /combine.
// ============================================================

export type PartRole =
  | "introduction"
  | "revue_litterature"
  | "partie_theorique"
  | "methodologie"
  | "partie_pratique"
  | "resultats"
  | "discussion"
  | "conclusion"
  | "annexe"
  | "autre";

export interface ClassifiedPartDTO {
  filename: string;
  suggestedTitle: string;
  role: PartRole;
  wordCount: number;
  pageCount: number;
}

// Classify uploaded parts (read content → role + suggested title + default order).
export async function classifyCombineParts(
  parts: { filename: string; base64: string }[]
): Promise<{ parts: ClassifiedPartDTO[]; suggestedOrder: string[] }> {
  return apiPost("/api/thesis/combine/classify", { parts });
}

// Combine ordered parts into one new live-docx thesis (returns the import shape).
export async function combineThesis(input: {
  title: string;
  normProfileId?: string;
  language?: string;
  parts: { filename: string; base64: string; title: string; order: number }[];
}): Promise<{ thesis: Thesis; analysisReport: AnalysisReport | null }> {
  return apiPost("/api/thesis/combine", input);
}

// ============================================================
// Live-.docx thesis document (read-only block render)
// Mirrors the server DTO from GET /api/thesis/:id/document.
// ============================================================

export type DocBlockDTO =
  | { index: number; kind: "paragraph"; text: string; styleId: string | null; level: 0 | 1 | 2 | 3 | 4 | 5 | 6; alignment: "left" | "center" | "right" | "both" | null; direction: "rtl" | "ltr" | null }
  | { index: number; kind: "table"; rows: string[][] }
  // L4c: image blocks (charts/figures). The server inlines small images (charts
  // ≤ ~200KB) as a base64 `dataUri` so the workspace can render the real image;
  // larger figures omit `dataUri` and the app shows a placeholder. `width`/`height`
  // are the intrinsic pixel size (for aspect-fit); `caption` is the adjacent label.
  | {
      index: number;
      kind: "image";
      dataUri?: string;
      // Real image bytes exist for this block (any size). When `dataUri` is absent
      // (figure too large to inline), the app lazily loads the bytes from
      // `thesisBlockImageUrl(id, index)`. Absent → render the "figure" placeholder.
      hasMedia?: boolean;
      width?: number;
      height?: number;
      caption?: string;
    }
  | { index: number; kind: "other"; tag: string };

export type DocumentDTO =
  | {
      id: string;
      title: string;
      docMode: "live-docx";
      available: true;
      blocks: DocBlockDTO[];
      downloadUrl: string;
    }
  | { docMode: string; available: false };

// Fetch the live-.docx block model for a thesis. When `available:false` the
// thesis is still on the legacy section/chapter model — the workspace falls
// back to that render.
export async function getThesisDocument(id: string): Promise<DocumentDTO> {
  return apiGet<DocumentDTO>(`/api/thesis/${id}/document`);
}

// URL that streams a single figure's image bytes (by engine block index) out of
// the live .docx — the on-demand source for figures too large to inline as a
// `dataUri`. Loaded by an <Image> with an Authorization header (see
// `getAuthHeader`); `version` busts the cache after an edit changes the doc.
export function thesisBlockImageUrl(id: string, index: number, version?: number | string): string {
  const v = version != null ? `?v=${encodeURIComponent(String(version))}` : "";
  return `${API_URL}/api/thesis/${id}/document/media/${index}${v}`;
}

// Just the Bearer Authorization header (no Content-Type), for attaching to a
// native <Image source={{ uri, headers }}> that hits an authed API route.
export async function getAuthHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ============================================================
// Docx-as-source structural outline (detail screen)
// Mirrors GET /api/thesis/:id/outline. Sections (Partie) derived from the live
// .docx headings, each grouping its chapters (Chapitre). `index` is the engine
// block index → tapping navigates the workspace to that block.
// ============================================================

export type OutlineSectionDTO = {
  index: number;
  title: string;
  chapters: { index: number; title: string }[];
};
// Full multi-level heading tree (Thesis Structure sheet): every heading (H1..H6)
// nests the deeper headings that follow it, like a table of contents. `index` is
// the engine block index → tap navigates the workspace to it; `level` is depth (1+).
export type OutlineNodeDTO = {
  index: number;
  level: number;
  title: string;
  children: OutlineNodeDTO[];
};
export type OutlineDTO =
  | {
      id: string;
      title: string;
      docMode: "live-docx";
      available: true;
      wordCount: number;
      pageCount: number;
      sectionCount: number;
      chapterCount: number;
      headingCount: number;
      sections: OutlineSectionDTO[];
      nodes: OutlineNodeDTO[];
    }
  | { id: string; title: string; docMode: string; available: false };

export async function getThesisOutline(id: string): Promise<OutlineDTO> {
  return apiGet<OutlineDTO>(`/api/thesis/${id}/outline`);
}

// OnlyOffice Docs editor config (signed DocEditor config + the public Document
// Server URL). `enabled:false` when the server has no Document Server configured
// → the workspace falls back to the docx-preview viewer (WordDocxView). The
// signed `config.document.key` changes whenever the .docx changes, so a fresh
// fetch after an AI turn forces the OnlyOffice view to reload the new bytes.
export type EditorConfigDTO =
  | { enabled: false }
  | { enabled: true; documentServerUrl: string; config: any };

export async function getThesisEditorConfig(id: string): Promise<EditorConfigDTO> {
  return apiGet<EditorConfigDTO>(`/api/thesis/${id}/editor-config`);
}

// Signed URL to a TEMPORARY PDF render of the live .docx (converted on demand by
// the OnlyOffice Document Server, not persisted). `available:false` when no
// Document Server is configured ("disabled"), the thesis has no .docx
// ("not-seeded"), or the conversion failed ("failed") → the PDF view shows the
// matching message. Re-fetched after each AI turn so the preview reflects edits;
// the preview object is removed via deleteThesisPdf when the view closes.
export type ThesisPdfDTO =
  | { available: true; url: string }
  | { available: false; reason: "disabled" | "not-seeded" | "failed" };

export async function getThesisPdf(id: string): Promise<ThesisPdfDTO> {
  return apiGet<ThesisPdfDTO>(`/api/thesis/${id}/pdf`);
}

// Discard the transient PDF preview — called when the user switches away from the
// PDF view or leaves the workspace, so the throwaway render isn't kept around.
export async function deleteThesisPdf(id: string): Promise<void> {
  return apiDelete(`/api/thesis/${id}/pdf`);
}

// Export the thesis to a downloadable file (default .docx) → signed URL.
export async function exportThesis(thesisId: string, format: "docx" | "latex" = "docx") {
  return apiPost<{ success: boolean; url: string; filename: string; format: string; bytes: number; pageCount?: number }>(`/api/export/${thesisId}`, { format });
}

// ============================================================
// Source materials API (helper files mounted at /api/thesis/:id/sources)
// ============================================================

export async function listSources(thesisId: string) {
  return apiGet<ThesisSource[]>(`/api/thesis/${thesisId}/sources`);
}

// Add a reference file. The file is sent as base64 (binary/multipart bodies are
// unreliable from RN); the server stores it and extracts its text for the AI.
export async function addSource(
  thesisId: string,
  input: { base64: string; filename: string; title?: string; description?: string }
) {
  return apiPost<ThesisSource>(`/api/thesis/${thesisId}/sources`, input);
}

export async function deleteSource(thesisId: string, sourceId: string) {
  return apiDelete(`/api/thesis/${thesisId}/sources/${sourceId}`);
}

// ============================================================
// Enhance API
// ============================================================

export async function checkGrammar(text: string, language?: string) {
  return apiPost<any>("/api/enhance/grammar", { text, language });
}

export async function paraphraseText(text: string, language?: string) {
  return apiPost<any>("/api/enhance/paraphrase", { text, language });
}

export async function generateCitations(topic: string, style?: string) {
  return apiPost<any>("/api/enhance/citations", { topic, style });
}

// ============================================================
// User API
// ============================================================

export async function getProfile() {
  return apiGet<any>("/api/user/profile");
}

export async function updateProfile(updates: any) {
  return apiPut<any>("/api/user/profile", updates);
}

// Upload a profile picture. The image is sent as base64 (binary/multipart bodies
// are unreliable from RN); the server stores it and returns the updated profile.
export async function uploadAvatar(base64: string, mimeType: string) {
  return apiPost<any>("/api/user/avatar", { base64, mimeType });
}

// Permanently delete the account and all associated data (irreversible). The
// caller is responsible for signing the user out afterwards — the auth user no
// longer exists, so the cached session is dead.
export async function deleteAccount() {
  return apiDelete("/api/user/account");
}

// ============================================================
// Notifications API (server router mounted at /api/notifications)
// ============================================================

export async function listNotifications(opts?: {
  limit?: number;
  before?: string; // ISO createdAt cursor — returns only older notifications
}) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.before) params.set("before", opts.before);
  const query = params.toString();
  return apiGet<AppNotification[]>(
    `/api/notifications${query ? `?${query}` : ""}`
  );
}

export async function getUnreadCount() {
  return apiGet<{ count: number }>("/api/notifications/unread-count");
}

export async function markNotificationRead(id: string) {
  return apiPut<{ success: true }>(`/api/notifications/${id}/read`, {});
}

export async function markAllNotificationsRead() {
  return apiPut<{ success: true }>("/api/notifications/read-all", {});
}

export async function deleteNotification(id: string) {
  return apiDelete(`/api/notifications/${id}`) as Promise<void>;
}

export async function clearAllNotifications() {
  return apiDelete("/api/notifications") as Promise<void>;
}

export async function registerPushToken(token: string, platform: string) {
  return apiPost<{ success: true }>("/api/notifications/push-token", {
    token,
    platform,
  });
}

export async function unregisterPushToken(token: string) {
  return apiDeleteWithBody<{ success: true }>("/api/notifications/push-token", {
    token,
  });
}

export async function getNotificationPreferences() {
  return apiGet<NotificationPreferences>("/api/notifications/preferences");
}

export async function updateNotificationPreferences(
  patch: Partial<NotificationPreferences>
) {
  return apiPut<NotificationPreferences>(
    "/api/notifications/preferences",
    patch
  );
}

// ============================================================
// News
// ============================================================

const EMPTY_COPY: NewsCopy = { title: "", sum: "", body: "" };

// Resolve the article copy for the current UI language, falling back across the
// other languages so a post is never blank just because one translation is missing.
function pickCopy(row: NewsRow): NewsCopy {
  const lang = (i18n.language || "en").split("-")[0];
  const byLang: Record<string, NewsCopy | null> = {
    en: row.contentEng,
    fr: row.contentFr,
    ar: row.contentAr,
  };
  return byLang[lang] ?? row.contentEng ?? row.contentFr ?? row.contentAr ?? EMPTY_COPY;
}

function toArticle(row: NewsRow): NewsArticle {
  const copy = pickCopy(row);
  return {
    id: row.id,
    slug: row.slug,
    category: row.category,
    imageUrl: row.coverUrl ?? undefined,
    title: copy.title,
    summary: copy.sum,
    body: copy.body,
    ctaLabel: row.ctaLabel ?? undefined,
    ctaHref: row.ctaHref ?? undefined,
    pinned: row.pinned,
    views: row.views ?? 0,
    publishedAt: row.publishedAt ?? row.createdAt ?? "",
  };
}

export async function listNews(opts?: {
  q?: string;
  category?: string;
  page?: number;
  limit?: number;
}): Promise<{ news: NewsArticle[]; pagination: NewsPagination }> {
  const params = new URLSearchParams();
  if (opts?.q) params.set("q", opts.q);
  if (opts?.category && opts.category !== "all") params.set("category", opts.category);
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await apiGet<{ news: NewsRow[]; pagination: NewsPagination }>(
    `/api/news${qs ? `?${qs}` : ""}`
  );
  return { news: res.news.map(toArticle), pagination: res.pagination };
}

export async function getNewsArticle(idOrSlug: string): Promise<NewsArticle> {
  const res = await apiGet<{ news: NewsRow }>(`/api/news/${idOrSlug}`);
  return toArticle(res.news);
}

export async function getNewsCategories(): Promise<string[]> {
  const res = await apiGet<{ categories: string[] }>(`/api/news/categories`);
  return res.categories;
}

export async function recordNewsClick(idOrSlug: string) {
  return apiPost<{ message: string; clicks: number }>(
    `/api/news/${idOrSlug}/click`,
    {}
  );
}

// ============================================================
// Documents API (imported .docx, mounted at /api/documents)
// ============================================================

// Import a .docx → new document. The file is sent as base64 (binary/multipart
// bodies are unreliable from RN); the server copies it into storage and parses it.
export async function importDocument(
  base64: string,
  filename: string,
  language?: string
): Promise<DocumentRecord> {
  return apiPost<DocumentRecord>("/api/documents/import", { base64, filename, language });
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  return apiGet<DocumentRecord[]>("/api/documents");
}

export async function getDocument(id: string): Promise<DocumentRecord> {
  return apiGet<DocumentRecord>(`/api/documents/${id}`);
}

export async function getDocumentContent(id: string): Promise<DocumentContent> {
  return apiGet<DocumentContent>(`/api/documents/${id}/content`);
}

// Short-lived signed URL for opening the real .docx in the OS viewer.
export async function getDocumentDownload(
  id: string
): Promise<{ url: string; filename: string }> {
  return apiGet<{ url: string; filename: string }>(`/api/documents/${id}/download`);
}

// OnlyOffice editor config to VIEW an imported .docx (same shape as the thesis
// editor-config; `{ enabled:false }` → the app falls back to docx-preview).
export async function getDocumentEditorConfig(id: string): Promise<EditorConfigDTO> {
  return apiGet<EditorConfigDTO>(`/api/documents/${id}/editor-config`);
}

export async function editDocumentParagraph(
  id: string,
  index: number,
  changes: { text?: string; alignment?: Align; styleId?: string }
): Promise<ParagraphMutationResult> {
  return apiPut<ParagraphMutationResult>(`/api/documents/${id}/paragraphs/${index}`, changes);
}

// Manual single-paragraph edit of a live-.docx THESIS (the in-app block editor).
// Distinct from editDocumentParagraph above, which targets the imported-documents
// feature; theses are edited through their own thesis-scoped route (which shares
// the AI's thesis lock). `index` is the engine block index from the document DTO.
export async function editThesisParagraph(
  thesisId: string,
  index: number,
  changes: { text?: string; level?: number; alignment?: "left" | "center" | "right" | "justify"; direction?: "rtl" | "ltr"; clearFormatting?: boolean }
): Promise<{ ok: true }> {
  return apiPut<{ ok: true }>(`/api/thesis/${thesisId}/paragraphs/${index}`, changes);
}

// Bulk-apply ONE formatting change (level / alignment / direction / clearFormatting —
// text is per-paragraph, so it's excluded) to several live-.docx paragraph blocks at
// once: the workspace multi-select edit tools. Non-paragraph blocks in `indices` are
// skipped server-side. One locked pass, so it can't race the AI. Engine block indices.
export async function editThesisParagraphs(
  thesisId: string,
  indices: number[],
  changes: { level?: number; alignment?: "left" | "center" | "right" | "justify"; direction?: "rtl" | "ltr"; clearFormatting?: boolean }
): Promise<{ ok: true; changed: number }> {
  return apiPost<{ ok: true; changed: number }>(`/api/thesis/${thesisId}/paragraphs/bulk`, { indices, ...changes });
}

// Bulk-delete several live-.docx thesis blocks at once (the workspace multi-select).
// `indices` are engine block indices; the server removes them high-to-low so they
// stay valid as the list shrinks. Shares the AI's thesis lock.
// Move one block from engine index `from` to index `to` (drag-reorder / up-down).
export async function moveThesisBlock(
  thesisId: string,
  from: number,
  to: number
): Promise<{ ok: true }> {
  return apiPost<{ ok: true }>(`/api/thesis/${thesisId}/blocks/move`, { from, to });
}

// Insert a base64 image as a new block AFTER `afterIndex` (-1 = top). width/height
// are the image's pixel size (server clamps the on-page width).
export async function insertThesisImage(
  thesisId: string,
  img: { data: string; format: string; width?: number; height?: number; afterIndex: number }
): Promise<{ ok: true; newIndex: number }> {
  return apiPost<{ ok: true; newIndex: number }>(`/api/thesis/${thesisId}/blocks/image`, img);
}

// Replace the image bytes of an existing figure block (engine block `index`) with
// new bytes produced on-device (crop / rotate / replace). `width`/`height` are the
// NEW pixel size — when the aspect ratio changed the server rescales the drawing so
// the picture isn't stretched.
export async function replaceThesisBlockImage(
  thesisId: string,
  index: number,
  img: { data: string; format: string; width?: number; height?: number }
): Promise<{ ok: true }> {
  return apiPost<{ ok: true }>(`/api/thesis/${thesisId}/blocks/${index}/image`, img);
}

// Remove the background from a figure block's image (server-side via the rembg
// sidecar → re-embeds a transparent PNG). No image bytes travel through the app.
export async function removeThesisBlockBg(
  thesisId: string,
  index: number
): Promise<{ ok: true }> {
  return apiPost<{ ok: true }>(`/api/thesis/${thesisId}/blocks/${index}/remove-bg`, {});
}

export async function deleteThesisBlocks(
  thesisId: string,
  indices: number[]
): Promise<{ ok: true; deleted: number; skipped: number }> {
  // `skipped` counts protected non-paragraph blocks (cover logo / jury table) the
  // server refused to delete.
  return apiPost<{ ok: true; deleted: number; skipped: number }>(`/api/thesis/${thesisId}/blocks/delete`, { indices });
}

// Make each selected block start on a new page (a next-page section break), in one
// locked pass. `indices` are engine block indices.
export async function startThesisBlocksOnNewPage(
  thesisId: string,
  indices: number[],
  breakType?: "nextPage" | "evenPage" | "oddPage"
): Promise<{ ok: true; changed: number }> {
  return apiPost<{ ok: true; changed: number }>(`/api/thesis/${thesisId}/blocks/start-on-new-page`, { indices, breakType });
}

export interface ThesisPageSetup {
  marginPreset?: "normal" | "narrow" | "moderate" | "wide" | "mirrored";
  orientation?: "portrait" | "landscape";
  pageSize?: "A4" | "USLetter" | "USLegal" | "A3" | "A5";
  columns?: 1 | 2 | 3;
}

/** Document-wide page setup (margins / orientation / size / columns). Byte-safe on
 *  the server; pass only the field(s) you want to change. */
export async function setThesisPageSetup(
  thesisId: string,
  setup: ThesisPageSetup,
): Promise<{ ok: true; applied: string[] }> {
  return apiPost<{ ok: true; applied: string[] }>(`/api/thesis/${thesisId}/page-setup`, setup);
}

export async function addDocumentParagraph(
  id: string,
  body: { index?: number; text: string; styleId?: string; alignment?: Align }
): Promise<ParagraphMutationResult> {
  return apiPost<ParagraphMutationResult>(`/api/documents/${id}/paragraphs`, body);
}

export async function deleteDocumentParagraph(
  id: string,
  index: number
): Promise<{ document: DocumentRecord }> {
  return apiDeleteWithBody<{ document: DocumentRecord }>(
    `/api/documents/${id}/paragraphs/${index}`,
    {}
  );
}

export async function deleteDocument(id: string): Promise<void> {
  return apiDelete(`/api/documents/${id}`);
}
