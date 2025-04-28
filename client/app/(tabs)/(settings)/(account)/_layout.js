import { Tabs } from 'expo-router';
import { useTranslation } from '@/localization/i18nProvider';
import { useTheme } from '@/components/ThemeProvider';

export default function TabLayout() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          display: 'none',
          backgroundColor: theme.colors.gray[50],
        },
        animation: 'shift',
      }}
    >
      <Tabs.Screen name="account" />
      <Tabs.Screen name="changePassword" />
      <Tabs.Screen name="changeEmail" />
      <Tabs.Screen name="updateProfile" />
    </Tabs>
  );
}
