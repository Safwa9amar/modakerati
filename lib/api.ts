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
import type { Thesis, SectionKind, Template } from "@/types/thesis";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "https://modakerati-api.fly.dev";

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
  options?: { chapterId?: string; sectionId?: string }
): Promise<ChatSendResponse> {
  return apiPost("/api/chat/send", {
    thesisId,
    message,
    chapterId: options?.chapterId,
    sectionId: options?.sectionId,
  });
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
  options?: { chapterId?: string; sectionId?: string; signal?: AbortSignal }
): Promise<void> {
  const headers = await getAuthHeaders();
  const response = await expoFetch(`${API_URL}/api/chat/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ thesisId, message, chapterId: options?.chapterId, sectionId: options?.sectionId }),
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
  return apiGet<Array<Thesis & { sectionCount: number; chapterCount: number }>>("/api/thesis");
}

export async function getThesis(id: string) {
  return apiGet<Thesis>(`/api/thesis/${id}`);
}

export async function createThesis(input: {
  title: string;
  templateId?: string;
  language?: string;
  sections?: Array<{ title: string; kind?: SectionKind; chapters?: Array<{ title: string; content?: string }> }>;
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

export async function generateThesisPlan(input: { title: string; language?: string; bodyPreset?: string }) {
  return apiPost<{ sections: Array<{ title: string; kind: "introduction" | "section" | "conclusion"; chapters: Array<{ title: string; hint?: string }> }> }>("/api/thesis/generate-plan", input);
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

export async function editDocumentParagraph(
  id: string,
  index: number,
  changes: { text?: string; alignment?: Align; styleId?: string }
): Promise<ParagraphMutationResult> {
  return apiPut<ParagraphMutationResult>(`/api/documents/${id}/paragraphs/${index}`, changes);
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
