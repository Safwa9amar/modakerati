import { fetch as expoFetch } from "expo/fetch";
import { supabase } from "./supabase";
import type {
  AppNotification,
  NotificationPreferences,
} from "@/types/notification";

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
}

export async function chatSend(
  thesisId: string,
  message: string,
  options?: { chapterId?: string }
): Promise<ChatSendResponse> {
  return apiPost("/api/chat/send", {
    thesisId,
    message,
    chapterId: options?.chapterId,
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
  options?: { chapterId?: string; signal?: AbortSignal }
): Promise<void> {
  const headers = await getAuthHeaders();
  const response = await expoFetch(`${API_URL}/api/chat/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ thesisId, message, chapterId: options?.chapterId }),
    signal: options?.signal,
  });

  if (!response.ok || !response.body) {
    const err = new Error(`API Error: ${response.status}`) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) handlers.onDelta(chunk);
    }
    const tail = decoder.decode(); // flush any trailing bytes
    if (tail) handlers.onDelta(tail);
  } finally {
    reader.releaseLock();
  }
}

// ============================================================
// Thesis API
// ============================================================

export async function listTheses() {
  return apiGet<any[]>("/api/thesis");
}

export async function getThesis(id: string) {
  return apiGet<any>(`/api/thesis/${id}`);
}

export async function createThesis(title: string, chapters?: string[], templateId?: string) {
  return apiPost<any>("/api/thesis", { title, chapters, templateId });
}

export async function updateThesis(id: string, updates: any) {
  return apiPut<any>(`/api/thesis/${id}`, updates);
}

export async function deleteThesis(id: string) {
  return apiDelete(`/api/thesis/${id}`);
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

// ============================================================
// Notifications API (server router mounted at /api/notifications)
// ============================================================

export async function listNotifications() {
  return apiGet<AppNotification[]>("/api/notifications");
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
