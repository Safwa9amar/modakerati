import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useTranslation } from '@/localization/i18nProvider';
import { useTheme } from '@/components/ThemeProvider';

export default function AboutSettings() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isRTL = theme.isRTL;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.gray[50] }}
      contentContainerStyle={{ padding: 24, paddingVertical: 64 }}
    >
      <Text
        style={{
          fontSize: 24,
          fontWeight: 'bold',
          color: theme.colors.primary[800],
          marginBottom: 16,
          textAlign: "center",
        }}
      >
        {t('aboutTitle')}
      </Text>
     
      <View
        style={{
          backgroundColor: theme.colors.white,
          borderRadius: 16,
          padding: 20,
          marginBottom: 20,
          shadowColor: '#000',
          shadowOpacity: 0.04,
          shadowRadius: 8,
          elevation: 2,
        }}
      >
        <Text
          style={{
            fontSize: 16,
            color: theme.colors.gray[700],
            marginBottom: 12,
            lineHeight: 26,
            textAlign: isRTL ? 'right' : 'left',
          }}
        >
          {t('aboutIntro')}
        </Text>
        <Text
          style={{
            fontSize: 16,
            color: theme.colors.gray[700],
            marginBottom: 12,
            lineHeight: 26,
            textAlign: isRTL ? 'right' : 'left',
          }}
        >
          {t('aboutMission')}
        </Text>
        <Text
          style={{
            fontSize: 16,
            color: theme.colors.gray[700],
            marginBottom: 12,
            lineHeight: 26,
            textAlign: isRTL ? 'right' : 'left',
          }}
        >
          {t('aboutVision')}
        </Text>
      </View>
      <View
        style={{
          backgroundColor: theme.colors.primary[50],
          borderRadius: 14,
          padding: 18,
          marginBottom: 20,
        }}
      >
        <Text
          style={{
            fontSize: 20,
            fontWeight: 'bold',
            color: theme.colors.primary[800],
            marginBottom: 10,
            textAlign: isRTL ? 'right' : 'left',
          }}
        >
          {t('aboutValuesTitle')}
        </Text>
        <View style={{ gap: 6 }}>
          <Text
            style={{
              fontSize: 16,
              color: theme.colors.gray[800],
              textAlign: isRTL ? 'right' : 'left',
            }}
          >
            • {t('aboutValueSimplicity')}
          </Text>
          <Text
            style={{
              fontSize: 16,
              color: theme.colors.gray[800],
              textAlign: isRTL ? 'right' : 'left',
            }}
          >
            • {t('aboutValueQuality')}
          </Text>
          <Text
            style={{
              fontSize: 16,
              color: theme.colors.gray[800],
              textAlign: isRTL ? 'right' : 'left',
            }}
          >
            • {t('aboutValueCreativity')}
          </Text>
          <Text
            style={{
              fontSize: 16,
              color: theme.colors.gray[800],
              textAlign: isRTL ? 'right' : 'left',
            }}
          >
            • {t('aboutValueEmpowerment')}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'center', marginTop: 12 }}>
        <Text
          style={{
            fontSize: 18,
            fontWeight: 'bold',
            color: theme.colors.success[600],
            textAlign: isRTL ? 'right' : 'center',
            alignSelf: isRTL ? 'flex-end' : 'center',
            lineHeight: 28,
          }}
        >
          {t('aboutJoin')}
        </Text>
      </View>
    </ScrollView>
  );
}
