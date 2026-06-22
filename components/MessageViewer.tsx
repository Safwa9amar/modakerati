import { Modal, View, Text, StyleSheet, ScrollView, Pressable, Image } from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { Markdown } from "@/components/Markdown";
import { splitFileFrames } from "@/lib/file-frames";

const LOGO = require("../assets/icon.png");

/**
 * Body lives under a Modal-local SafeAreaProvider so insets are measured against
 * the modal's own native window — a Modal renders in a separate window and the
 * root provider's insets don't reach it (header would overlap the status bar).
 */
function ViewerBody({ content, onClose }: { content: string | null; onClose: () => void }) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.bgCard }}>
        <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
          <View style={styles.headerLeft}>
            <Image source={LOGO} style={styles.avatar} />
            <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
              {t("chat.response", { defaultValue: "Response" })}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t("common.close", { defaultValue: "Close" })}
            style={[styles.closeBtn, { backgroundColor: colors.bgSurface }]}
          >
            <X size={20} color={colors.textPrimary} strokeWidth={2} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}
        showsVerticalScrollIndicator
      >
        {content ? <Markdown content={splitFileFrames(content).text} color={colors.textPrimary} /> : null}
      </ScrollView>
    </View>
  );
}

/**
 * Full-screen viewer for a single assistant response. Long answers are hard to
 * read inside a constrained chat bubble, so this presents the same markdown in a
 * roomy, scrollable sheet with the brand logo in the header.
 */
export function MessageViewer({
  visible,
  content,
  onClose,
}: {
  visible: boolean;
  content: string | null;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ViewerBody content={content} onClose={onClose} />
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  avatar: { width: 30, height: 30, borderRadius: 15 },
  title: { fontSize: 16, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  body: { padding: 20, paddingTop: 16 },
});
