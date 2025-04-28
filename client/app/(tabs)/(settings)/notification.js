import React, { useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '@/components/ThemeProvider';
import { useTranslation } from '@/localization/i18nProvider';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Bell, BellOff, Mail } from 'lucide-react-native';

export default function NotificationSettings() {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const styles = useStyles(theme);
  const isRTL = theme.isRTL;

  // Dummy notification settings (replace with real state/store)
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [newsEnabled, setNewsEnabled] = useState(true);

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: t('notifications'),
      headerTitleStyle: {
        fontSize: theme.typography.fontSizes.xl,
        fontWeight: theme.typography.fontWeights.bold,
        color: theme.colors.text.main,
      },
      headerStyle: {
        backgroundColor: theme.colors.background.main,
      },
      headerTintColor: theme.colors.black,
      headerLeft: () => (
        <View style={{ paddingLeft: 16 }}>
          <ArrowLeft size={28} color={theme.colors.black} onPress={() => navigation.goBack()} />
        </View>
      ),
    });
  }, [theme, navigation, t]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={[styles.title, isRTL && { textAlign: 'right' }]}>{t('notificationSettingsTitle') || t('notifications')}</Text>
      <Text style={[styles.subtitle, isRTL && { textAlign: 'right' }]}>{t('notificationSettingsDesc') || 'Manage your notification preferences below.'}</Text>
      <View style={styles.settingRow}>
        <View style={styles.settingLabelRow}>
          <Bell size={20} color={theme.colors.primary[600]} style={{ marginEnd: 8 }} />
          <Text style={styles.settingLabel}>{t('pushNotifications')}</Text>
        </View>
        <Switch
          value={pushEnabled}
          onValueChange={setPushEnabled}
          trackColor={{ false: theme.colors.gray[200], true: theme.colors.primary[400] }}
          thumbColor={pushEnabled ? theme.colors.primary[600] : theme.colors.gray[400]}
        />
      </View>
      <View style={styles.settingRow}>
        <View style={styles.settingLabelRow}>
          <Mail size={20} color={theme.colors.primary[600]} style={{ marginEnd: 8 }} />
          <Text style={styles.settingLabel}>{t('emailNotifications')}</Text>
        </View>
        <Switch
          value={emailEnabled}
          onValueChange={setEmailEnabled}
          trackColor={{ false: theme.colors.gray[200], true: theme.colors.primary[400] }}
          thumbColor={emailEnabled ? theme.colors.primary[600] : theme.colors.gray[400]}
        />
      </View>
      <View style={styles.settingRow}>
        <View style={styles.settingLabelRow}>
          <BellOff size={20} color={theme.colors.primary[600]} style={{ marginEnd: 8 }} />
          <Text style={styles.settingLabel}>{t('newsNotifications')}</Text>
        </View>
        <Switch
          value={newsEnabled}
          onValueChange={setNewsEnabled}
          trackColor={{ false: theme.colors.gray[200], true: theme.colors.primary[400] }}
          thumbColor={newsEnabled ? theme.colors.primary[600] : theme.colors.gray[400]}
        />
      </View>
    </ScrollView>
  );
}

const useStyles = (theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background.main,
    },
    contentContainer: {
      padding: theme.spacing[5],
      paddingBottom: theme.spacing[10],
    },
    title: {
      fontSize: theme.typography.fontSizes['2xl'],
      fontWeight: theme.typography.fontWeights.bold,
      color: theme.colors.primary[700],
      marginBottom: theme.spacing[2],
    },
    subtitle: {
      fontSize: theme.typography.fontSizes.md,
      color: theme.colors.text.secondary,
      marginBottom: theme.spacing[4],
    },
    settingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.colors.background.secondary,
      borderRadius: theme.radius.md,
      paddingVertical: theme.spacing[3],
      paddingHorizontal: theme.spacing[4],
      marginBottom: theme.spacing[3],
      shadowColor: theme.colors.primary[100],
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 4,
      elevation: 1,
    },
    settingLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    settingLabel: {
      fontSize: theme.typography.fontSizes.md,
      color: theme.colors.text.main,
      fontWeight: theme.typography.fontWeights.medium,
    },
  });
