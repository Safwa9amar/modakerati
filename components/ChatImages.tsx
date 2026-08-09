import { memo, useState } from "react";
import { View, Image, Pressable, Modal, StyleSheet, ActivityIndicator, useWindowDimensions } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets, initialWindowMetrics } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { ChatImage } from "@/types/chat";

// Rendering for images a student attached to their own message: the thumbnails
// inside the bubble, and the full-screen viewer a tap opens.
//
// The source is whichever of the two the message has — `uri` while the send is
// still optimistic (a local file, so the picture is on screen the instant it's
// sent) or `url` once the server row has come back. Preferring the local file
// keeps the thumbnail from flickering through a re-download at sync time.
export function imageSource(img: ChatImage): string | undefined {
  return img.uri ?? img.url;
}

// A single attachment gets a real, proportional preview; several are laid out as
// squares, which is the only way a mixed-orientation set reads as one group.
const SINGLE_WIDTH = 216;
const SINGLE_MAX_HEIGHT = 260;
const TILE = 104;

export const ChatImageGrid = memo(function ChatImageGrid({
  images,
  onPress,
}: {
  images: ChatImage[];
  onPress?: (image: ChatImage) => void;
}) {
  const { t } = useTranslation();
  if (!images.length) return null;

  const single = images.length === 1;
  return (
    <View style={[styles.grid, single && styles.gridSingle]}>
      {images.map((img, i) => {
        const uri = imageSource(img);
        const ratio = img.width && img.height ? img.width / img.height : undefined;
        return (
          <Pressable
            key={(uri ?? "img") + i}
            onPress={uri ? () => onPress?.(img) : undefined}
            accessibilityRole="image"
            accessibilityLabel={t("chat.attachedImage", { defaultValue: "Attached image" })}
            style={
              single
                ? [styles.single, ratio ? { aspectRatio: ratio } : { height: 160 }]
                : styles.tile
            }
          >
            {uri ? (
              <Image
                source={{ uri }}
                style={styles.image}
                // A proportional single image is already the right shape, so it
                // must not be cropped; tiles are square and have to be.
                resizeMode={single ? "contain" : "cover"}
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
});

// Body lives under the Modal-local SafeAreaProvider — a Modal renders in its own
// native window, so the ROOT provider's insets don't reach it and the close
// button would sit under the status bar. Same arrangement as MessageViewer.
function ViewerBody({ uri, onClose }: { uri?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);

  return (
    <View style={styles.container}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {loading && uri ? <ActivityIndicator size="large" color="#FFFFFF" style={styles.spinner} /> : null}
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width, height: height * 0.82 }}
            resizeMode="contain"
            onLoadEnd={() => setLoading(false)}
          />
        ) : null}
      </Pressable>
      <View style={[styles.viewerBar, { top: insets.top }]} pointerEvents="box-none">
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t("common.close", { defaultValue: "Close" })}
          style={styles.viewerClose}
        >
          <X size={22} color="#FFFFFF" strokeWidth={2} />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Full-screen view of one attachment. Tapping the backdrop closes it, matching
 * every other photo viewer the student uses.
 */
export function ChatImageViewer({ image, onClose }: { image: ChatImage | null; onClose: () => void }) {
  return (
    <Modal
      visible={!!image}
      transparent
      animationType="fade"
      // Android hardware back has to close the viewer, not the screen behind it.
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        {/* Keyed on the source so opening a SECOND image remounts the body — the
            spinner would otherwise stay resolved from the first one. */}
        <ViewerBody key={image ? imageSource(image) : "none"} uri={image ? imageSource(image) : undefined} onClose={onClose} />
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  gridSingle: { flexDirection: "column" },
  single: {
    width: SINGLE_WIDTH,
    maxHeight: SINGLE_MAX_HEIGHT,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#00000018",
  },
  tile: { width: TILE, height: TILE, borderRadius: 10, overflow: "hidden", backgroundColor: "#00000018" },
  image: { width: "100%", height: "100%" },
  container: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)", alignItems: "center", justifyContent: "center" },
  spinner: { position: "absolute" },
  viewerBar: { position: "absolute", left: 0, right: 0, alignItems: "flex-end" },
  viewerClose: {
    margin: 12,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
});
