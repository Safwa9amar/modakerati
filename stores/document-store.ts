import { create } from "zustand";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
// NOTE: expo-sharing is loaded lazily inside preview() (not a top-level import).
// Its native module "ExpoSharing" only exists in a build that compiled it in;
// importing it eagerly would throw at module load on an older binary and crash
// the whole app (the import sits above the app's screen tree). Lazy-loading keeps
// the failure contained to the share action. Rebuild the app to enable sharing.
import {
  deleteDocument as deleteDocumentApi,
  getDocumentDownload,
  importDocument as importDocumentApi,
  listDocuments,
} from "@/lib/api";
import type { DocumentRecord } from "@/types/document";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Discriminated result so the screen can react: open the new doc, ignore a
// cancel, or surface an error — without throwing across the store boundary.
// `code` lets the SCREEN localize store-origin errors (the store has no i18n);
// "generic" carries an already-meaningful (server/native) message verbatim.
export type ImportErrorCode = "picker" | "notDocx" | "generic";
export type PreviewErrorCode = "sharing" | "generic";

export type ImportResult =
  | { status: "ok"; document: DocumentRecord }
  | { status: "canceled" }
  | { status: "error"; code: ImportErrorCode; message: string };

interface DocumentState {
  documents: DocumentRecord[];
  loading: boolean;
  importing: boolean;
  fetchList: () => Promise<void>;
  importDocx: () => Promise<ImportResult>;
  remove: (id: string) => Promise<void>;
  // Download the real .docx and hand it to the OS viewer (Quick Look / open-with).
  preview: (id: string) => Promise<{ error?: string; code?: PreviewErrorCode }>;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  loading: false,
  importing: false,

  fetchList: async () => {
    set({ loading: true });
    try {
      const documents = await listDocuments();
      set({ documents });
    } catch {
      set({ documents: [] });
    } finally {
      set({ loading: false });
    }
  },

  importDocx: async () => {
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type: [DOCX_MIME],
        copyToCacheDirectory: true,
      });
    } catch {
      return { status: "error", code: "picker", message: "Could not open the file picker" };
    }
    if (picked.canceled || !picked.assets?.[0]) return { status: "canceled" };

    const asset = picked.assets[0];
    if (!/\.docx$/i.test(asset.name ?? "")) {
      return { status: "error", code: "notDocx", message: "Please choose a .docx file" };
    }

    set({ importing: true });
    try {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const document = await importDocumentApi(base64, asset.name ?? "document.docx");
      // Prepend so the newest import is first (matches server list ordering).
      set({ documents: [document, ...get().documents] });
      return { status: "ok", document };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      return { status: "error", code: "generic", message };
    } finally {
      set({ importing: false });
    }
  },

  remove: async (id) => {
    // Optimistic: drop it from the list immediately, restore on failure.
    const prev = get().documents;
    set({ documents: prev.filter((d) => d.id !== id) });
    try {
      await deleteDocumentApi(id);
    } catch {
      set({ documents: prev });
    }
  },

  preview: async (id) => {
    try {
      // Lazy import: defers loading the native "ExpoSharing" module until needed,
      // so a build without it fails here gracefully instead of at app startup.
      const Sharing = await import("expo-sharing");
      if (!(await Sharing.isAvailableAsync())) {
        return { error: "Sharing is not available on this device", code: "sharing" };
      }
      const { url, filename } = await getDocumentDownload(id);
      const safeName = (filename || `${id}.docx`).replace(/[^a-zA-Z0-9._-]/g, "_");
      const dest = `${FileSystem.cacheDirectory}${safeName}`;
      const { uri } = await FileSystem.downloadAsync(url, dest);
      await Sharing.shareAsync(uri, {
        UTI: "org.openxmlformats.wordprocessingml.document",
        mimeType: DOCX_MIME,
        dialogTitle: filename || "Document",
      });
      return {};
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preview failed";
      return { error: message, code: "generic" };
    }
  },
}));
