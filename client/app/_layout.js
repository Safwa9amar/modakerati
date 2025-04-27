import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider } from '@/hooks/useAuth';
import { ThesisProvider } from '@/hooks/useThesis';
import { ThemeProvider } from '@/components/ThemeProvider';
import { I18nProvider } from '@/localization/i18nProvider';
import { useThesisStoreInit } from '../store/useThesisStore';

export default function RootLayout() {
  useFrameworkReady();
  useThesisStoreInit();

  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <ThesisProvider>
            <Stack
              screenOptions={{
                headerShown: false,
              }}
            >
              <Stack.Screen
                name="(onboarding)"
                options={{ headerShown: false }}
              />
              <Stack.Screen name="auth" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="+not-found"
                options={{ title: 'Not Found' }}
              />
            </Stack>
            <StatusBar style="auto" />
          </ThesisProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

