import { View, Text, StyleSheet, Switch, ScrollView } from 'react-native';
import { useState } from 'react';
import { useTranslation } from '@/localization/i18nProvider';
import { useAuth } from '@/hooks/useAuth';
import { createThemedStyles, useTheme } from '@/components/ThemeProvider';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { 
  LogOut, 
  Globe, 
  Bell, 
  User, 
  Moon, 
  HelpCircle, 
  MessageSquare, 
  Shield, 
  FileText,
  ChevronRight 
} from 'lucide-react-native';

export default function SettingsScreen() {
  const { t, locale, changeLanguage } = useTranslation();
  const { user, signOut } = useAuth();
  const theme = useTheme();
  const styles = useStyles();
  
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  
  const handleSignOut = () => {
    signOut();
  };
  
  const handleLanguageChange = () => {
    changeLanguage(locale === 'en' ? 'ar' : 'en');
  };
  
  const renderSettingItem = (icon, title, rightContent, onPress, showBorder = true) => (
    <View 
      style={[
        styles.settingItem, 
        showBorder && styles.settingItemBorder,
        theme.isRTL && { flexDirection: 'row-reverse' }
      ]}
    >
      <View style={[styles.settingIconTitle, theme.isRTL && { flexDirection: 'row-reverse' }]}>
        {icon}
        <Text style={styles.settingTitle}>{title}</Text>
      </View>
      
      {onPress ? (
        <View style={[styles.settingAction, theme.isRTL && { flexDirection: 'row-reverse' }]}>
          {rightContent}
          <ChevronRight 
            size={20} 
            color={theme.colors.gray[400]} 
            style={theme.isRTL ? { transform: [{ rotate: '180deg' }] } : null}
          />
        </View>
      ) : (
        <View style={styles.settingAction}>
          {rightContent}
        </View>
      )}
    </View>
  );
  
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('settings')}</Text>
      </View>
      
      <Card style={styles.userCard}>
        <View style={styles.userInfo}>
          <View style={styles.userAvatar}>
            <Text style={styles.userInitials}>
              {user ? user.name.substring(0, 2).toUpperCase() : 'G'}
            </Text>
          </View>
          <View style={styles.userDetails}>
            <Text style={styles.userName}>{user ? user.name : 'Guest User'}</Text>
            <Text style={styles.userEmail}>{user ? user.email : 'guest@example.com'}</Text>
          </View>
        </View>
      </Card>
      
      <Card style={styles.settingsCard}>
        {renderSettingItem(
          <Globe size={20} color={theme.colors.primary[600]} />,
          t('language'),
          <Text style={styles.settingValue}>{locale === 'en' ? 'English' : 'العربية'}</Text>,
          handleLanguageChange
        )}
        
        {renderSettingItem(
          <Bell size={20} color={theme.colors.secondary[600]} />,
          t('notification'),
          <Switch
            value={notifications}
            onValueChange={setNotifications}
            trackColor={{ false: theme.colors.gray[300], true: theme.colors.primary[500] }}
            thumbColor={theme.colors.white}
          />
        )}
        
        {renderSettingItem(
          <Moon size={20} color={theme.colors.secondary[600]} />,
          t('theme'),
          <Switch
            value={darkMode}
            onValueChange={setDarkMode}
            trackColor={{ false: theme.colors.gray[300], true: theme.colors.primary[500] }}
            thumbColor={theme.colors.white}
          />,
          null
        )}
        
        {renderSettingItem(
          <User size={20} color={theme.colors.accent[600]} />,
          t('account'),
          null,
          () => {},
          false
        )}
      </Card>
      
      <Card style={styles.settingsCard}>
        {renderSettingItem(
          <Shield size={20} color={theme.colors.primary[600]} />,
          t('privacyPolicy'),
          null,
          () => {}
        )}
        
        {renderSettingItem(
          <FileText size={20} color={theme.colors.primary[600]} />,
          t('termsOfService'),
          null,
          () => {}
        )}
        
        {renderSettingItem(
          <MessageSquare size={20} color={theme.colors.secondary[600]} />,
          t('feedback'),
          null,
          () => {}
        )}
        
        {renderSettingItem(
          <HelpCircle size={20} color={theme.colors.accent[600]} />,
          t('about'),
          <Text style={styles.versionText}>{t('version')} 1.0.0</Text>,
          () => {},
          false
        )}
      </Card>
      
      <Button
        title={t('logout')}
        leftIcon={<LogOut size={20} color={theme.colors.white} />}
        onPress={handleSignOut}
        variant="primary"
        style={styles.logoutButton}
      />
    </ScrollView>
  );
}

const useStyles = createThemedStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.gray[50],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[12],
    paddingBottom: theme.spacing[4],
  },
  headerTitle: {
    fontSize: theme.typography.fontSizes['2xl'],
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[900],
  },
  userCard: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },
  userInfo: {
    flexDirection: theme.isRTL ? 'row-reverse' : 'row',
    alignItems: 'center',
  },
  userAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.colors.primary[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.isRTL ? 0 : theme.spacing[4],
    marginLeft: theme.isRTL ? theme.spacing[4] : 0,
  },
  userInitials: {
    fontSize: theme.typography.fontSizes.xl,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.primary[700],
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: theme.typography.fontSizes.lg,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[900],
    marginBottom: theme.spacing[1],
    textAlign: theme.isRTL ? 'right' : 'left',
  },
  userEmail: {
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.gray[600],
    textAlign: theme.isRTL ? 'right' : 'left',
  },
  settingsCard: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[4],
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  settingItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.gray[200],
  },
  settingIconTitle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingTitle: {
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.gray[900],
    marginLeft: theme.isRTL ? 0 : theme.spacing[3],
    marginRight: theme.isRTL ? theme.spacing[3] : 0,
  },
  settingAction: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingValue: {
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.gray[600],
    marginRight: theme.isRTL ? 0 : theme.spacing[2],
    marginLeft: theme.isRTL ? theme.spacing[2] : 0,
  },
  versionText: {
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.gray[500],
    marginRight: theme.isRTL ? 0 : theme.spacing[2],
    marginLeft: theme.isRTL ? theme.spacing[2] : 0,
  },
  logoutButton: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[8],
  },
}));