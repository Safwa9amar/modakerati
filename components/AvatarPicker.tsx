import { View, Text, StyleSheet, Pressable, Image, ActivityIndicator, Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { Camera } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useAvatarStore } from "@/stores/avatar-store";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface AvatarPickerProps {
  /** Name used to derive initials when there's no picture yet. */
  name: string;
  avatarUrl?: string | null;
  /** Diameter in px. */
  size?: number;
  /** When false, renders a plain read-only avatar (no badge, not tappable). */
  editable?: boolean;
  /** Optional caption below the avatar (e.g. "Change Photo") — also tappable. */
  caption?: string;
}

/**
 * Circular profile avatar that shows the user's picture (or initials fallback)
 * and, when editable, lets them pick + upload a new one. Pick/upload state lives
 * in the avatar store, so this component stays presentational and reusable
 * across the Profile tab and the Edit Profile screen.
 */
export function AvatarPicker({ name, avatarUrl, size = 88, editable = true, caption }: AvatarPickerProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const isUploading = useAvatarStore((s) => s.isUploading);
  const pickAndUpload = useAvatarStore((s) => s.pickAndUpload);

  const handlePress = async () => {
    if (!editable || isUploading) return;
    const { error } = await pickAndUpload();
    if (error === "permission") {
      Alert.alert(t("profile.photoPermissionTitle"), t("profile.photoPermissionMessage"));
    } else if (error) {
      Alert.alert(t("profile.editProfile"), t("profile.uploadError"));
    }
  };

  const radius = size / 2;
  const badgeSize = Math.round(size * 0.3);

  const avatar = (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: radius, backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimaryLight }]}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: radius }} />
      ) : (
        <Text style={[styles.initials, { fontSize: size * 0.36 }]}>{getInitials(name)}</Text>
      )}

      {editable && (
        <View style={[styles.cameraCircle, { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2, backgroundColor: colors.brandAccent, borderColor: colors.bgPrimary }]}>
          <Camera size={Math.round(badgeSize * 0.55)} color="#fff" />
        </View>
      )}

      {isUploading && (
        <View style={[styles.overlay, { borderRadius: radius }]}>
          <ActivityIndicator color="#fff" />
        </View>
      )}
    </View>
  );

  if (!editable) return avatar;

  return (
    <>
      <Pressable onPress={handlePress} disabled={isUploading} hitSlop={6}>
        {avatar}
      </Pressable>
      {!!caption && (
        <Pressable onPress={handlePress} disabled={isUploading} hitSlop={6}>
          <Text style={[styles.caption, { color: colors.brandPrimary }]}>{caption}</Text>
        </Pressable>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  avatar: { borderWidth: 3, alignItems: "center", justifyContent: "center", position: "relative" },
  initials: { fontFamily: "Inter_700Bold", color: "#fff" },
  cameraCircle: { position: "absolute", bottom: 0, right: 0, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  caption: { fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 10, textAlign: "center" },
});
