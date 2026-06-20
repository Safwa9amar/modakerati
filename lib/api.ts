import { supabase } from "./supabase";

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

export async function getChatHistory(thesisId: string) {
  return apiGet<any[]>(`/api/chat/${thesisId}`);
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

export async function getNotifications() {
  return apiGet<any[]>("/api/user/notifications");
}
