import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Text,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SquareStack, Upload, GripVertical } from 'lucide-react-native';
import { useTranslation } from '@/localization/i18nProvider';
import TimelineItem from '@/components/common/TimelineItem';
import { useTheme } from '@/components/ThemeProvider';
import { useHomeStore } from '@/store/useHomeStore';
import FileDisplay from '@/components/common/FileDisplay';
import { Button } from 'react-native-paper';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { useRouter, Link } from 'expo-router';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { API_ENDPOINTS } from '@/constants/api_endpoints';
import apiClient from '@/utils/api';
import { useApiError } from '@/hooks/useApiError';
import { uploadFile } from '@/services/uploadService';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import Animated, { FadeIn } from 'react-native-reanimated';
import ThesisTitle from './ThesisTitle';

export default function UploadThesis() {
  const theme = useTheme();
  const router = useRouter();
  const { t, isRTL } = useTranslation();
  const { handleApiError } = useApiError();
  const {
    files,
    setUploadType,
    uploadType,
    setFiles,
    removeFile,
    reorderFiles,
    thesisDetails,
    setThesisDetails,
    errors,
    validateThesisDetails,
    clearErrors,
  } = useHomeStore();
  const [isUploading, setIsUploading] = React.useState(false);

  const handleInputChange = useCallback(
    (field, value) => {
      setThesisDetails({
        ...thesisDetails,
        [field]: value,
      });
      clearErrors();
    },
    [thesisDetails, setThesisDetails, clearErrors]
  );

  const handleNumberInputChange = useCallback(
    (field, value) => {
      const numValue = parseInt(value) || 0;
      setThesisDetails({
        ...thesisDetails,
        [field]: numValue,
      });
      clearErrors();
    },
    [thesisDetails, setThesisDetails, clearErrors]
  );

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

  const handlePickDocument = async () => {
    try {
      setIsUploading(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        copyToCacheDirectory: true,
        multiple: uploadType === 'multiple' ? true : false,
      });
      const file = await uploadFile(result.assets[0]);
      if (!result['canceled'] && file.success) {
        const newFile = { ...file.file, id: uuidv4() };
        setFiles([...files, newFile]);
        clearErrors();
        router.push({
          pathname: '/project',
          params: {
            name: newFile.name,
            id: newFile.id,
          },
        });
      }
    } catch (error) {
      console.error('Document pick error:', error);
      handleApiError(error);
    } finally {
      setIsUploading(false);
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

  const renderItem = useCallback(({ item, drag, isActive }) => {
    return (
      <ScaleDecorator>
        <Animated.View entering={FadeIn}>
          <Pressable
            onLongPress={drag}
            disabled={isActive}
            style={[
              styles.fileItem,
              isActive && styles.fileItemActive
            ]}
          >
            <GripVertical 
              size={20} 
              color={theme.colors.gray[400]} 
              style={styles.dragHandle}
            />
            <Link
              href={{
                pathname: 'project',
                params: {
                  name: item.name,
                  id: item.id,
                },
              }}
              style={styles.fileLink}
            >
              <FileDisplay file={item} onRemove={() => showDialog(item)} />
            </Link>
          </Pressable>
        </Animated.View>
      </ScaleDecorator>
    );
  }, [theme.colors.gray, showDialog]);

  const styles = useStyles(theme);

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
        onButtonPress={async () => {
          if (!validateThesisDetails()) {
            return;
          }
          setIsUploading(true);
          try {
            await apiClient.post(API_ENDPOINTS.THESIS, {
              uploadThesisDetails: thesisDetails,
              files,
            });
          } catch (error) {
            console.log('error', error.response?.data);
            handleApiError(error, {
              413: t('fileTooLarge') || 'The file is too large to upload.',
              415:
                t('unsupportedFileType') || 'This file type is not supported.',
            });
          } finally {
            setIsUploading(false);
          }
        }}
      >
        <Text style={styles.uploadDescription}>{t('upload_file_desc')}</Text>
        {files.length > 0 && (
          <DraggableFlatList
            data={files}
            onDragEnd={({ from, to }) => reorderFiles(from, to)}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            containerStyle={styles.filesContainer}
          />
        )}

        <View style={styles.buttonContainer}>
          <Button
            onPress={handlePickDocument}
            style={styles.uploadButton}
            mode="contained"
            buttonColor={theme.colors.primary[500]}
            icon={
              isUploading ? () => <ActivityIndicator color="white" /> : 'upload'
            }
            disabled={isUploading}
          >
            {isUploading ? t('uploading') : t('select_file')}
          </Button>
        </View>
      </TimelineItem>

      <ConfirmDialog
        visible={visible}
        onDismiss={hideDialog}
        onConfirm={handleRemoveFile}
        title={t('remove_file')}
        message={t('remove_file_confirm')}
        confirmLabel={t('done')}
        cancelLabel={t('cancel')}
        isRTL={isRTL}
      />
    </>
  );
}

const useStyles = (theme) =>
  StyleSheet.create({
    uploadDescription: {
      color: theme.colors.text.main,
    },
    filesContainer: {
      width: '100%',
      flexDirection: 'column',
      gap: theme.spacing[3],
    },
    buttonContainer: {
      alignSelf: 'center',
      alignItems: 'center',
      marginTop: 16,
    },
    uploadButton: {
      width: 180,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    fileItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.white,
      borderRadius: theme.radius.md,
      marginBottom: theme.spacing[2],
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
    },
    fileItemActive: {
      backgroundColor: theme.colors.primary[50],
      borderColor: theme.colors.primary[200],
    },
    dragHandle: {
      padding: theme.spacing[3],
    },
    fileLink: {
      flex: 1,
    },
  });
