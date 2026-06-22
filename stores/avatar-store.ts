import { create } from "zustand";
import * as ImagePicker from "expo-image-picker";
import { uploadAvatar as uploadAvatarApi } from "@/lib/api";
import { useProfileStore } from "./profile-store";

// Result of a pick+upload round trip. `error` distinguishes the cases the UI
// reacts to differently: "permission" → prompt to open settings; any other
// string → a generic upload-failed alert; null with no url → user cancelled.
export interface AvatarUploadResult {
  url: string | null;
  error: "permission" | string | null;
}

interface AvatarState {
  isUploading: boolean;
  error: string | null;
  // Launch the photo library, then upload the chosen image and fold the updated
  // profile back into the profile store. No-op (cancelled) is not an error.
  pickAndUpload: () => Promise<AvatarUploadResult>;
  reset: () => void;
}

// Fall back to a sensible mime if the picker doesn't report one.
const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

function guessMime(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.mimeType) return asset.mimeType;
  const ext = asset.uri.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "image/jpeg";
}

export const useAvatarStore = create<AvatarState>((set) => ({
  isUploading: false,
  error: null,

  pickAndUpload: async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      return { url: null, error: "permission" };
    }

    // Square crop keeps avatars consistent; modest quality keeps the base64
    // payload small. base64 is what the server endpoint expects.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]?.base64) {
      return { url: null, error: null };
    }

    const asset = result.assets[0];
    set({ isUploading: true, error: null });
    try {
      const updated = await uploadAvatarApi(asset.base64!, guessMime(asset));
      // The server returns the full updated profile — push it into the profile
      // store so every screen showing the avatar re-renders with the new image.
      useProfileStore.setState({ profile: updated });
      return { url: updated.avatarUrl ?? null, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      set({ error: message });
      return { url: null, error: message };
    } finally {
      set({ isUploading: false });
    }
  },

  reset: () => set({ isUploading: false, error: null }),
}));
