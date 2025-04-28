import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useTheme } from '@/components/ThemeProvider';
import { useTranslation } from '@/localization/i18nProvider';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Send } from 'lucide-react-native';

export default function Feedback() {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const styles = useStyles(theme);
  const isRTL = theme.isRTL;

  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: t('feedback'),
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
          <ArrowLeft
            size={28}
            color={theme.colors.black}
            onPress={() => navigation.goBack()}
          />
        </View>
      ),
    });
  }, [theme, navigation, t]);

  const handleSend = async () => {
    if (!message.trim()) return;
    setSending(true);
    setTimeout(() => {
      setSending(false);
      setSent(true);
      setMessage('');
      setTimeout(() => setSent(false), 2000);
    }, 1200);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, isRTL && { textAlign: 'right' }]}>{t('feedbackTitle') || t('feedback')}</Text>
        <Text style={[styles.subtitle, isRTL && { textAlign: 'right' }]}>{t('feedbackSubtitle') || 'We value your feedback! Please let us know your thoughts or suggestions below.'}</Text>
        <TextInput
          style={[styles.input, isRTL && { textAlign: 'right' }]}
          value={message}
          onChangeText={setMessage}
          placeholder={t('feedbackPlaceholder') || 'Type your feedback...'}
          placeholderTextColor={theme.colors.text.secondary}
          multiline
          numberOfLines={6}
          editable={!sending && !sent}
        />
        <TouchableOpacity
          style={[styles.button, (!message.trim() || sending) && styles.buttonDisabled]}
          onPress={handleSend}
          disabled={!message.trim() || sending}
          activeOpacity={0.8}
        >
          {sending ? (
            <ActivityIndicator color={theme.colors.white} />
          ) : (
            <>
              <Send size={20} color={theme.colors.white} style={{ marginEnd: 8 }} />
              <Text style={styles.buttonText}>{t('sendFeedback') || 'Send'}</Text>
            </>
          )}
        </TouchableOpacity>
        {sent && <Text style={styles.success}>{t('feedbackSent') || 'Thank you for your feedback!'}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = (theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background.main,
    },
    contentContainer: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: theme.spacing[5],
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
    input: {
      minHeight: 120,
      borderWidth: 1,
      borderColor: theme.colors.primary[200],
      backgroundColor: theme.colors.background.secondary,
      borderRadius: theme.radius.md,
      padding: theme.spacing[4],
      fontSize: theme.typography.fontSizes.md,
      color: theme.colors.text.main,
      marginBottom: theme.spacing[4],
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.primary[600],
      borderRadius: theme.radius.md,
      paddingVertical: theme.spacing[3],
      marginBottom: theme.spacing[2],
    },
    buttonDisabled: {
      backgroundColor: theme.colors.primary[200],
    },
    buttonText: {
      color: theme.colors.white,
      fontWeight: theme.typography.fontWeights.bold,
      fontSize: theme.typography.fontSizes.md,
    },
    success: {
      color: theme.colors.success[600] || theme.colors.primary[600],
      fontSize: theme.typography.fontSizes.md,
      textAlign: 'center',
      marginTop: theme.spacing[2],
      fontWeight: theme.typography.fontWeights.bold,
    },
  });
