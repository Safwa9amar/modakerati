import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { FileText } from "lucide-react-native";
import { BottomSheet } from "@/components/BottomSheet";
import { useBottomSheet } from "@/stores/bottom-sheet-store";
import { useThesisStore } from "@/stores/thesis-store";
import { useThemeColors } from "@/hooks/useThemeColors";
import { getTextDirection } from "@/lib/text-direction";

interface Props {
  /** Called with the chosen thesis id. The caller does the PATCH. */
  onPick: (thesisId: string) => void;
}

/**
 * Pick a thesis to attach to an unattached conversation. Opened with
 * useBottomSheet.getState().openSheet("thesis-attach").
 *
 * Deliberately a plain list and nothing more — attaching is a one-tap decision,
 * and the student already knows which thesis they mean. The content only mounts
 * while the sheet is open (the wrapper unmounts it), so it always reflects the
 * current list without needing its own refresh.
 */
export function ThesisAttachSheet({ onPick }: Props) {
  return (
    <BottomSheet name="thesis-attach" snapPoints={["50%", "85%"]}>
      <AttachContent onPick={onPick} />
    </BottomSheet>
  );
}

function AttachContent({ onPick }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const theses = useThesisStore((s) => s.theses);

  const choose = (id: string) => {
    onPick(id);
    useBottomSheet.getState().closeSheet("thesis-attach");
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>
        {t("chat.threads.attachPrompt")}
      </Text>

      {theses.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          {t("chat.threads.attachEmpty")}
        </Text>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {theses.map((th) => (
            <Pressable
              key={th.id}
              onPress={() => choose(th.id)}
              style={[styles.row, { borderBottomColor: colors.borderDefault }]}
              accessibilityRole="button"
              accessibilityLabel={th.title}
            >
              <FileText size={18} color={colors.textSecondary} />
              {/* Direction comes from the TITLE, not the app locale: an Arabic
                  thesis in a French UI must still read right-to-left. */}
              <Text
                numberOfLines={1}
                style={[styles.rowText, { color: colors.textPrimary, writingDirection: getTextDirection(th.title) }]}
              >
                {th.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 16, paddingTop: 4 },
  title: { fontSize: 16, fontWeight: "600", marginBottom: 12 },
  empty: { fontSize: 14, lineHeight: 20, paddingVertical: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, fontSize: 15 },
});
