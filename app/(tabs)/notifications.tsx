import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";

interface Notification {
  id: string;
  title: string;
  description: string;
  time: string;
  color: string;
  read: boolean;
}

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();

  const notifications: Notification[] = [
    { id: "1", title: "AI Generation Complete", description: "Chapter 2 has been generated successfully.", time: "2 min ago", color: colors.brandPrimary, read: false },
    { id: "2", title: "Export Ready", description: "Your thesis PDF is ready to download.", time: "15 min ago", color: colors.semanticSuccess, read: false },
    { id: "3", title: "Formatting Applied", description: "Auto-formatting has been applied to your thesis.", time: "1 hour ago", color: colors.brandAccent, read: false },
    { id: "4", title: "New Template Available", description: "University of Djelfa template has been added.", time: "3 hours ago", color: colors.semanticWarning, read: true },
    { id: "5", title: "Subscription Renewed", description: "Your Pro Student plan has been renewed.", time: "Yesterday", color: colors.brandPrimary, read: true },
    { id: "6", title: "Welcome to Modakerati", description: "Start building your thesis with AI assistance.", time: "2 days ago", color: colors.textSecondary, read: true },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("nav.notifications")}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {notifications.map((notif) => (
          <Card
            key={notif.id}
            borderColor={!notif.read ? notif.color : undefined}
            style={[
              styles.notifCard,
              {
                backgroundColor: !notif.read ? colors.bgCard : "transparent",
                borderWidth: !notif.read ? 1 : 0,
              },
            ]}
          >
            <View style={styles.notifRow}>
              <View style={[styles.dot, { backgroundColor: notif.color }]} />
              <View style={styles.notifContent}>
                <Text
                  style={[
                    styles.notifTitle,
                    { color: colors.textPrimary },
                    !notif.read && { fontFamily: "Inter_600SemiBold" },
                  ]}
                >
                  {notif.title}
                </Text>
                <Text style={[styles.notifDesc, { color: colors.textSecondary }]}>{notif.description}</Text>
                <Text style={[styles.notifTime, { color: colors.textPlaceholder }]}>{notif.time}</Text>
              </View>
            </View>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 10 },
  notifCard: { padding: 14 },
  notifRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  notifContent: { flex: 1 },
  notifTitle: { fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 4 },
  notifDesc: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 6 },
  notifTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
