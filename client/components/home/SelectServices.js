import React from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { useTranslation } from '@/localization/i18nProvider';
import { useTheme } from '@/components/ThemeProvider';
import TimelineItem from '../common/TimelineItem';
import { Upload, Settings, CheckCircle, Loader, Download, Users } from 'lucide-react-native';

export default function SelectServices({ services, onChange, active = false }) {
  const { t} = useTranslation();
  
  const theme = useTheme();

  // Example services list (customize as needed)
  const availableServices = [
    { key: 'toc', label: t('service_toc') },
    { key: 'page_numbers', label: t('service_page_numbers') },
    { key: 'bibliography', label: t('service_bibliography') },
    { key: 'formatting', label: t('service_formatting') },
    { key: 'proofreading', label: t('service_proofreading') },
  ];

  return (
    <TimelineItem
      key={1}
      icon={<CheckCircle size={32} color={theme.colors.secondary[500]} />}
      title={t('select_services')}
      description={t('select_services_desc')}
      buttonLabel={t('confirm_services')} 
      onButtonPress={() => {}}
      showLine={true}
      active={active}
    >
      <View style={styles.container}>
        {availableServices.map((service) => (
          <View key={service.key} style={styles.row}>
            <Text style={styles.label}>{service.label}</Text>
            <Switch
              value={!!services[service.key]}
              onValueChange={(val) => onChange(service.key, val)}
              trackColor={{
                false: theme.colors.gray[300],
                true: theme.colors.primary[400],
              }}
              thumbColor={
                services[service.key]
                  ? theme.colors.primary[600]
                  : theme.colors.gray[400]
              }
            />
          </View>
        ))}
      </View>
    </TimelineItem>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
  },
});
