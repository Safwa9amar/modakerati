import { Component, type ReactNode } from "react";
import { View, Text, StyleSheet, ScrollView, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { Button } from "@/components/ui/Button";

/**
 * The last line of defence.
 *
 * Without one, ANY render error anywhere in the tree unmounts the whole app and
 * leaves a white screen — no message, no way back, and on a student's phone no
 * way for us to learn it happened. React only offers this through a class
 * component; there is no hook form.
 *
 * ⚠️ It catches RENDER errors only. A rejected promise in an event handler or an
 * effect never reaches here — those still need their own try/catch, which is why
 * lib/safe-error.ts exists.
 */

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Where a crash reporter goes when there is one. Until then the dev console
    // is the only record — a student's crash is still invisible to us, which is
    // the remaining half of this gap.
    console.error("[RootErrorBoundary]", error?.message, info?.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    // The fallback is a FUNCTION component so it can use the theme and locale
    // hooks a class cannot.
    return <ErrorFallback error={this.state.error} onReset={this.reset} />;
  }
}

function ErrorFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const colors = useThemeColors();
  const { t } = useTranslation();

  return (
    <View style={[styles.fill, { backgroundColor: colors.bgPrimary }]}>
      <View style={[styles.iconCircle, { backgroundColor: colors.semanticError + "1A" }]}>
        <AlertTriangle size={44} color={colors.semanticError} strokeWidth={1.5} />
      </View>
      <Text style={[styles.title, { color: colors.textPrimary }]}>
        {t("errors.crashTitle", { defaultValue: "Something went wrong" })}
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        {t("errors.crashBody", {
          defaultValue:
            "Your thesis is safe — it is saved on our servers, not in this screen. Try again, and tell us if it keeps happening.",
        })}
      </Text>

      {/* The message itself only in development. A student can do nothing with a
          stack trace, and it would leak host names — the rule lib/safe-error.ts
          exists to enforce. */}
      {__DEV__ && (
        <ScrollView style={styles.trace} contentContainerStyle={styles.traceInner}>
          <Text selectable style={[styles.traceText, { color: colors.semanticError }]}>
            {error?.message}
            {"\n\n"}
            {error?.stack}
          </Text>
        </ScrollView>
      )}

      <View style={styles.action}>
        <Button
          title={t("errors.crashRetry", { defaultValue: "Try again" })}
          onPress={onReset}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingTop: Platform.OS === "ios" ? 60 : 40,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 12, textAlign: "center" },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, textAlign: "center" },
  trace: { maxHeight: 200, marginTop: 20, alignSelf: "stretch" },
  traceInner: { paddingVertical: 8 },
  traceText: { fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  action: { alignSelf: "stretch", marginTop: 28 },
});
