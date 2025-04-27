import { Tabs } from 'expo-router';
import { useTranslation } from '@/localization/i18nProvider';
import {
  Home,
  FileText,
  Settings,
  User,
  Bell,
  HelpCircle,
  Info,
} from 'lucide-react-native';
import { useTheme } from '@/components/ThemeProvider';
import { StyleSheet, View } from 'react-native';
import { Image } from 'react-native';

export default function TabLayout() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary[600],
        tabBarInactiveTintColor: theme.colors.gray[400],
        tabBarStyle: {
          borderTopWidth: 1,
          borderTopColor: theme.colors.border
            ? theme.colors.border.light
            : theme.colors.gray[200],
          height: 60,
          backgroundColor: theme.colors.background
            ? theme.colors.background.main
            : theme.colors.gray[50],
        },
        tabBarItemStyle: {
          paddingVertical: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
        headerShown: false,
      
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('myTheses'),
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: t('documents'),
          tabBarIcon: ({ color, size }) => (
            <FileText size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="(settings)"
        options={{
          title: t('settings'),
          tabBarIcon: ({ color, size }) => (
            <Settings size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}


