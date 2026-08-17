import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutAnimation, Platform, Pressable, ScrollView, StyleSheet, Text, UIManager, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useBottomInset } from "@/hooks/useBottomInset";
import { getSupportFaq } from "@/lib/support-faq-content";

// LayoutAnimation is opt-in on old-architecture Android. Harmless where it is
// already enabled, so it is set once at module scope rather than per render.
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * The Support Center FAQ — grouped questions, one answer open at a time.
 *
 * Accordion rather than a flat wall of text: the value of an FAQ is scanning the
 * questions, and twenty expanded answers is not scannable on a phone. Opening
 * one closes the previous one for the same reason.
 */
export default function SupportFaqScreen() {
  const { t, i18n } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection, textAlign } = useRTL();
  const bottomInset = useBottomInset(32);
  const router = useRouter();

  const faq = getSupportFaq(i18n.language);
  const [open, setOpen] = useState<string | null>(null);

  const toggle = (q: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((cur) => (cur === q ? null : q));
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={[styles.header, { flexDirection }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {t("support.faq.title", { defaultValue: "Common questions" })}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.lead, { color: colors.textSecondary, textAlign }]}>{faq.lead}</Text>

        {faq.groups.map((group) => (
          <View key={group.heading} style={styles.group}>
            <Text style={[styles.groupHeading, { color: colors.textSecondary, textAlign }]}>
              {group.heading}
            </Text>

            <Card style={styles.groupCard}>
              {group.items.map((item, i) => {
                const on = open === item.q;
                return (
                  <View
                    key={item.q}
                    style={[
                      styles.item,
                      i > 0 && { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
                    ]}
                  >
                    <Pressable
                      onPress={() => toggle(item.q)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: on }}
                      accessibilityLabel={item.q}
                    >
                      {({ pressed }) => (
                        <View style={[styles.qRow, { flexDirection, opacity: pressed ? 0.7 : 1 }]}>
                          <Text style={[styles.question, { color: colors.textPrimary, textAlign }]}>
                            {item.q}
                          </Text>
                          {on ? (
                            <ChevronUp size={17} color={colors.brandPrimary} />
                          ) : (
                            <ChevronDown size={17} color={colors.textPlaceholder} />
                          )}
                        </View>
                      )}
                    </Pressable>

                    {on ? (
                      <Text style={[styles.answer, { color: colors.textSecondary, textAlign }]}>
                        {item.a}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </Card>
          </View>
        ))}

        <Card style={[styles.stuck, { backgroundColor: colors.bgSurface }]}>
          <Text style={[styles.stuckHeading, { color: colors.textPrimary, textAlign }]}>
            {faq.stillStuckHeading}
          </Text>
          <Text style={[styles.stuckBody, { color: colors.textSecondary, textAlign }]}>
            {faq.stillStuck}
          </Text>
          <Button
            title={t("support.contact.title", { defaultValue: "Contact us" })}
            onPress={() => router.push("/(app)/support-contact" as any)}
            style={styles.stuckButton}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: { flex: 1, fontSize: 18, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  content: { paddingHorizontal: 20 },
  lead: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 24, marginBottom: 20 },
  group: { marginBottom: 18 },
  groupHeading: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  groupCard: { paddingVertical: 2, paddingHorizontal: 16 },
  item: { paddingVertical: 14 },
  qRow: { alignItems: "center", gap: 10 },
  question: { flex: 1, fontSize: 14.5, fontFamily: "Inter_600SemiBold", lineHeight: 21 },
  answer: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, marginTop: 8 },
  stuck: { marginTop: 4 },
  stuckHeading: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  stuckBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  stuckButton: { marginTop: 14 },
});
