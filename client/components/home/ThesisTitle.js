import React, { useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { University } from 'lucide-react-native';
import { useTranslation } from '@/localization/i18nProvider';
import TimelineItem from '@/components/common/TimelineItem';
import { useTheme } from '@/components/ThemeProvider';
import ThemedTextInput from '../common/ThemedTextInput';
import { Dropdown } from 'react-native-element-dropdown';
import universities from '@/utils/universities.json';
import { useHomeStore } from '@/store/useHomeStore';
import apiClient from '@/utils/api';
import { useAuthStore } from '@/store/useAuthStore';
import { API_ENDPOINTS } from '@/constants/api_endpoints';
import { Portal, Dialog, Button } from 'react-native-paper';

export default function ThesisTitle() {
  const theme = useTheme();
  const { t, isRTL } = useTranslation();
  const styles = useStyles(theme);
  const { idToken } = useAuthStore();
  const [dialogVisible, setDialogVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  
  const { thesisDetails, setThesisDetails, errors } = useHomeStore();

  const handleInputChange = (field, value) => {
    setThesisDetails({ [field]: value });
  };

  const handleNumberInputChange = (field, value) => {
    const numValue = value === '' ? 0 : parseInt(value, 10);
    if (!isNaN(numValue)) {
      setThesisDetails({ [field]: numValue });
    }
  };

  const showDialog = (message) => {
    setErrorMessage(message);
    setDialogVisible(true);
  };

  const hideDialog = () => {
    setDialogVisible(false);
  };

  const submit = async () => {
    try {
      const response = await apiClient.post(API_ENDPOINTS.THESIS, {
        title: thesisDetails.title,
        description: thesisDetails.description,
        subject: thesisDetails.subject,
        supervisor: thesisDetails.supervisor,
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': 'en',
          'Authorization': `Bearer ${idToken}`,
        },
      });
    } catch (error) {
      showDialog(error.message || 'An error occurred while submitting the thesis');
      console.error('Error submitting thesis:', error);
    }
  }

  return (
    <>
      <TimelineItem
        icon={<University size={32} color="#3B82F6" />}
        title={t('thesis_details')}
        description={t('thesis_details_desc')}
        showLine={true}
        active={true}
        buttonLabel={t('next')}
        onButtonPress={submit}
      >
        <View style={styles.formContainer}>
          <ThemedTextInput
            label={t('thesisTitle')}
            value={thesisDetails.title}
            onChangeText={(text) => handleInputChange('title', text)}
            mode="outlined"
            error={errors.title}
            errorText={errors.title}
          />
          <ThemedTextInput
            label={t('thesisDescription')}
            value={thesisDetails.description}
            onChangeText={(text) => handleInputChange('description', text)}
            mode="outlined"
            multiline
            error={errors.description}
            errorText={errors.description}
          />
          <ThemedTextInput
            label={t('thesisSubject')}
            value={thesisDetails.subject}
            onChangeText={(text) => handleInputChange('subject', text)}
            mode="outlined"
            error={errors.subject}
            errorText={errors.subject}
          />
          <ThemedTextInput
            label={t('thesisSupervisor')}
            value={thesisDetails.supervisor}
            onChangeText={(text) => handleInputChange('supervisor', text)}
            mode="outlined"
            error={errors.supervisor}
            errorText={errors.supervisor}
          />
          <ThemedTextInput
            label={t('chapters_number')}
            value={thesisDetails.chaptersNumber.toString()}
            onChangeText={(text) =>
              handleNumberInputChange('chaptersNumber', text)
            }
            mode="outlined"
            keyboardType="numeric"
            error={errors.chaptersNumber}
            errorText={errors.chaptersNumber}
          />
          <Dropdown
            onChange={(item) => {
              handleInputChange('university', item.UniversityName);
            }}
            data={universities}
            labelField="UniversityName"
            valueField="UniversityName"
            placeholder={t('select_university')}
            searchPlaceholder={t('search')}
            search
            style={[styles.dropdown, errors.university && styles.dropdownError]}
            placeholderStyle={styles.dropdownPlaceholder}
            selectedTextStyle={styles.dropdownSelectedText}
            itemTextStyle={styles.dropdownItemText}
            containerStyle={[
              styles.dropdownContainer,
              errors.university && styles.dropdownContainerError,
            ]}
            activeColor={theme.colors.primary[100]}
            renderLeftIcon={() => (
              <University
                size={20}
                color={theme.colors.primary[500]}
                style={styles.dropdownIcon}
              />
            )}
            rtl={isRTL}
          />
          {errors.university && (
            <Text style={styles.errorText}>{errors.university}</Text>
          )}
        </View>
      </TimelineItem>
      <Portal>
        <Dialog style={styles.dialog} visible={dialogVisible} onDismiss={hideDialog}>
          <Dialog.Title style={styles.dialogTitle}>Error</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogText} variant="bodyMedium">{errorMessage}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={hideDialog}>Done</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

const useStyles = (theme) =>
  StyleSheet.create({
    formContainer: {
      width: '100%',
      marginBottom: 16,
      flexDirection: 'column',
      gap: 16,
    },
    dropdown: {
      backgroundColor: theme.colors.white,
      borderColor: theme.colors.primary[400],
      borderWidth: 1,
      borderRadius: theme.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 10,
      color: theme.colors.text.main,
      fontSize: 16,
    },
    dropdownError: {
      borderColor: theme.colors.error,
    },
    dropdownPlaceholder: {
      color: theme.colors.gray[400],
      fontSize: 16,
      textAlign: 'left',
    },
    dropdownSelectedText: {
      color: theme.colors.text.main,
      fontSize: 16,
      textAlign: 'left',
    },
    dropdownItemText: {
      color: theme.colors.text.main,
      fontSize: 16,
      textAlign: 'left',
    },
    dropdownContainer: {
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.white,
      borderColor: theme.colors.primary[400],
      borderWidth: 1,
    },
    dropdownContainerError: {
      borderColor: theme.colors.error,
    },
    dropdownIcon: {
      marginRight: 8,
    },
    errorText: {
      color: theme.colors.error,
      fontSize: 12,
      marginTop: -8,
    },
    dialog: {
      backgroundColor: theme.colors.white,
    },
    dialogText: {
      color: theme.colors.text.main,
    },
    dialogTitle: {
      color: theme.colors.text.main,
    },
  });
