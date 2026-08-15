import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  FileCheck2,
  Image as ImageIcon,
  LayoutList,
  MessageSquareText,
  Paperclip,
  PenLine,
  Quote,
  SlidersHorizontal,
  Type,
  type LucideIcon,
} from "lucide-react-native";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useBottomInset } from "@/hooks/useBottomInset";
import { getChatGuide, type GuideIcon } from "@/lib/chat-guide-content";

// The content module names a glyph; the screen owns which one, so the copy file
// never has to import from lucide.
const ICONS: Record<GuideIcon, LucideIcon> = {
  write: PenLine,
  structure: LayoutList,
  format: Type,
  objects: ImageIcon,
  cite: Quote,
  sources: Paperclip,
  ask: MessageSquareText,
  edits: FileCheck2,
  controls: SlidersHorizontal,
};

/**
 * "What Kwill can do" — the long answer to the one-line welcome copy in the empty
 * conversation, reached from the button under it.
 *
 * Read-only prose, so it is a plain scroll of cards rather than anything stateful.
 * Text comes from lib/chat-guide-content.ts per language (see legal-content.ts for
 * the same pattern); RTL is handled the app's way, through useRTL.
 */
export default function ChatGuideScreen() {
  const { t, i18n } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection, textAlign } = useRTL();
  const bottomInset = useBottomInset(32);

  const guide = getChatGuide(i18n.language);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={[styles.header, { flexDirection }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {t("chat.guide.title", { defaultValue: "What Kwill can do" })}
        </Text>
        {/* Balances the back button so the title sits centred. */}
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.lead, { color: colors.textPrimary, textAlign }]}>{guide.lead}</Text>

        {guide.sections.map((section) => {
          const Icon = ICONS[section.icon];
          return (
            <Card key={section.heading} style={styles.card}>
              <View style={[styles.cardHead, { flexDirection }]}>
                <View style={[styles.badge, { backgroundColor: colors.brandPrimary + "1F" }]}>
                  <Icon size={18} color={colors.brandPrimary} strokeWidth={2} />
                </View>
                <Text style={[styles.heading, { color: colors.textPrimary, textAlign }]}>
                  {section.heading}
                </Text>
              </View>

              {section.items.map((item) => (
                <View key={item.title} style={styles.item}>
                  <Text style={[styles.itemTitle, { color: colors.textPrimary, textAlign }]}>
                    {item.title}
                  </Text>
                  <Text style={[styles.itemBody, { color: colors.textSecondary, textAlign }]}>
                    {item.body}
                  </Text>
                </View>
              ))}
            </Card>
          );
        })}

        {/* Prompts to copy word for word. Deliberately last: a student who read
            this far wants something to type, not another explanation. */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary, textAlign }]}>
          {guide.examplesHeading}
        </Text>
        {guide.examples.map((example) => (
          <View
            key={example}
            style={[styles.example, { backgroundColor: colors.bgSurface, borderColor: colors.borderSubtle }]}
          >
            <Text style={[styles.exampleText, { color: colors.textPrimary, textAlign }]}>
              {example}
            </Text>
          </View>
        ))}

        <Card style={[styles.card, { backgroundColor: colors.bgSurface }]}>
          <Text style={[styles.heading, { color: colors.textPrimary, textAlign }]}>
            {guide.noteHeading}
          </Text>
          <Text style={[styles.itemBody, { color: colors.textSecondary, textAlign, marginTop: 6 }]}>
            {guide.note}
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { flex: 1, fontSize: 18, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  content: { paddingHorizontal: 20 },
  lead: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 24, marginBottom: 20 },
  card: { marginBottom: 12 },
  cardHead: { alignItems: "center", gap: 10, marginBottom: 12 },
  badge: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  heading: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold" },
  item: { marginBottom: 12 },
  itemTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 3 },
  itemBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 12, marginBottom: 10 },
  example: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 },
  exampleText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
});
