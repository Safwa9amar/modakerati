import { StatusBar } from "expo-status-bar";
import { useSettingsStore } from "@/stores/settings-store";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSettingsStore((s) => s.theme);

  return (
    <>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      {children}
    </>
  );
}
