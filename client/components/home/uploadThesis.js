import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect } from 'react';
import { View, StyleSheet, ScrollView, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SquareStack, University, Upload } from 'lucide-react-native';
import { useTranslation } from '@/localization/i18nProvider';
import TimelineItem from '@/components/common/TimelineItem';
import { useTheme } from '@/components/ThemeProvider';
import { useHomeStore } from '@/store/useHomeStore';
import FileDisplay from '@/components/common/FileDisplay';
import { Button, TextInput, ToggleButton } from 'react-native-paper';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { useRouter, Link } from 'expo-router';
import ThemedTextInput from '../common/ThemedTextInput';
import { Dropdown } from 'react-native-element-dropdown';
import universities from '@/utils/universities.json';
import "react-native-get-random-values"
import { v4 as uuidv4 } from 'uuid';
import { log } from '../../helpers/log';
export default function UploadThesis() {
  const theme = useTheme();
  const { t, isRTL } = useTranslation();
  const {
    files,
    setUploadType,
    uploadType,
    setFiles,
    removeFile,
    thesisDetails,
    setThesisDetails,
  } = useHomeStore();
  const [visible, setVisible] = React.useState(false);
  const [fileToRemove, setFileToRemove] = React.useState(null);
  const showDialog = (file) => {
    setFileToRemove(file);
    setVisible(true);
  };
  const hideDialog = () => {
    setVisible(false);
    setFileToRemove(null);
  };
  log(uuidv4());

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        copyToCacheDirectory: true,
        multiple: uploadType === 'multiple' ? true : false,
      });
      if (!result['canceled']) {
        setFiles([...files, { ...result.assets[0], id: uuidv4() }]);
      }
    } catch (error) {
      console.error('Document pick error:', error);
    }
  };

  useEffect(() => {
    if (files.length > 1) {
      setUploadType('multiple');
    } else {
      setUploadType('single');
    }
  }, [files]);

  const handleRemoveFile = () => {
    if (fileToRemove) {
      removeFile(fileToRemove);
    }
    hideDialog();
  };

  return (
    <>
      <TimelineItem
        key={1}
        icon={<Upload size={32} color="#3B82F6" />}
        title={t('upload_thesis')}
        description={t('upload_thesis_desc')}
        buttonLabel={t('select_file')}
        showLine={true}
        active={true}
      >
        <View
          style={{
            width: '100%',
            marginBottom: 16,
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <ThemedTextInput
            label={t('thesisTitle')}
            value={thesisDetails.title}
            onChangeText={(text) =>
              setThesisDetails({ ...thesisDetails, title: text })
            }
            mode="outlined"
          />
          <ThemedTextInput
            label={t('thesisDescription')}
            value={thesisDetails.description}
            onChangeText={(text) =>
              setThesisDetails({ ...thesisDetails, description: text })
            }
            mode="outlined"
            multiline
          />
          <ThemedTextInput
            label={t('thesisSubject')}
            value={thesisDetails.subject}
            onChangeText={(text) =>
              setThesisDetails({ ...thesisDetails, subject: text })
            }
            mode="outlined"
          />
          <ThemedTextInput
            label={t('thesisSupervisor')}
            value={thesisDetails.supervisor}
            onChangeText={(text) =>
              setThesisDetails({ ...thesisDetails, supervisor: text })
            }
            mode="outlined"
          />
          <ThemedTextInput
            label={t('chapters_number')}
            value={thesisDetails.chaptersNumber}
            onChangeText={(text) =>
              setThesisDetails({
                ...thesisDetails,
                chaptersNumber: parseInt(text),
              })
            }
            mode="outlined"
            keyboardType="numeric"
          />
          <Dropdown
            onChange={(item) => {
              setThesisDetails({
                ...thesisDetails,
                university: item.UniversityName,
              });
            }}
            data={universities}
            labelField="UniversityName"
            valueField="UniversityName"
            placeholder={t('select_university') || 'Select university'}
            searchPlaceholder={t('search') || 'Search...'}
            search
            style={{
              backgroundColor: theme.colors.white,
              borderColor: theme.colors.primary[400],
              borderWidth: 1,
              borderRadius: theme.radius.md,
              paddingHorizontal: 12,
              paddingVertical: 10,
              marginBottom: 10,
              color: theme.colors.text.main,
              fontSize: 16,
            }}
            placeholderStyle={{
              color: theme.colors.gray[400],
              fontSize: 16,
              textAlign: isRTL ? 'right' : 'left',
            }}
            selectedTextStyle={{
              color: theme.colors.text.main,
              fontSize: 16,
              textAlign: isRTL ? 'right' : 'left',
            }}
            itemTextStyle={{
              color: theme.colors.text.main,
              fontSize: 16,
              textAlign: isRTL ? 'right' : 'left',
            }}
            containerStyle={{
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.white,
              borderColor: theme.colors.primary[400],
              borderWidth: 1,
            }}
            activeColor={theme.colors.primary[100]}
            renderLeftIcon={() => (
              <University
                size={20}
                color={theme.colors.primary[500]}
                style={{ marginRight: 8 }}
              />
            )}
            rtl={isRTL}
          />
        </View>
        <Text>{t('upload_file_desc')}</Text>
        {files.length > 0 && (
          <View style={{ width: '100%', flexDirection :"column", gap:theme.spacing[3] }}>
            {files.map((file, index) => (
              <Link
                href={{
                  pathname: 'project',
                  params: {
                    id: file.id,
                  },
                }}
              >
                <FileDisplay
                  key={index}
                  file={file}
                  onRemove={() => showDialog(file)}
                />
              </Link>
            ))}
          </View>
        )}

        <View
          style={{ alignSelf: 'center', alignItems: 'center', marginTop: 16 }}
        >
          <Button
            onPress={handlePickDocument}
            style={{ width: 180 }}
            mode="contained"
            buttonColor={theme.colors.primary[500]}
            icon="upload"
          >
            {t('select_file')}
          </Button>
        </View>
      </TimelineItem>

      <ConfirmDialog
        visible={visible}
        onDismiss={hideDialog}
        onConfirm={handleRemoveFile}
        title={t('remove_file')}
        message={
          t('remove_file_confirm') ||
          'Are you sure you want to remove this file?'
        }
        confirmLabel={t('done') || 'Done'}
        cancelLabel={t('cancel') || 'Cancel'}
        isRTL={isRTL}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  header: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#3B82F6',
    marginBottom: 32,
    textAlign: 'center',
    letterSpacing: 1,
  },
  timeline: {
    width: '100%',
  },
});
