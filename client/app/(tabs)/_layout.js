import { Tabs } from 'expo-router';
import { useTranslation } from '@/localization/i18nProvider';
import { Home, FileText, Settings } from 'lucide-react-native';
import { useTheme } from '@/components/ThemeProvider';
import { Image, TouchableOpacity, View } from 'react-native';
import { Menu } from 'lucide-react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
export default function TabLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigation = useNavigation();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary[600],
        tabBarInactiveTintColor: theme.colors.gray[400],
        tabBarStyle: {
          // display: 'none',
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
        headerShown: true,
        headerTitleStyle: {
          display: 'none',
        },
        headerStyle: {
          backgroundColor: theme.colors.background.main,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border
            ? theme.colors.border.light
            : theme.colors.gray[200],
        },

        headerLeft: () => (
          <View>
            <Image
              source={require('@/assets/fullLogo.png')}
              style={{ width: 200, height: 40, transform: [{ scale: 0.9 }] }}
            />
          </View>
        ),
        headerRight: () => (
          <TouchableOpacity
            onPress={() => navigation.navigate('/(settings)/')}
            style={{ marginRight: 10 }}
          >
            <Menu size={30} color={theme.colors.gray[400]} />
          </TouchableOpacity>
        ),
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
        name="(settings)"
        options={{
          title: t('settings'),
          tabBarIcon: ({ color, size }) => (
            <Settings size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="(project)"
        options={{
          tabBarItemStyle: {
            display: 'none',
          },
          title: t('settings'),
          tabBarIcon: ({ color, size }) => (
            <Settings size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
