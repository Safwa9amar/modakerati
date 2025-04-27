import { Tabs } from 'expo-router';
import { useTranslation } from '@/localization/i18nProvider';
import { useTheme } from '@/components/ThemeProvider';


export default function TabLayout() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown : false,
        tabBarStyle: {
          display: 'none',
          backgroundColor: theme.colors.gray[50],
        },
        animation : "shift"
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="notification" />
      <Tabs.Screen name="account" />
      <Tabs.Screen name="privacyPolicy" />
      <Tabs.Screen name="termsOfService" />
      <Tabs.Screen name="feedback" />
      <Tabs.Screen name="about" />
    </Tabs>
  );
}
