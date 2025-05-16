import { useTranslation } from '@/localization/i18nProvider';
import { Alert, Platform, ToastAndroid } from 'react-native';

/**
 * Custom hook for handling API success responses with enhanced features
 * @param {Object} options - Configuration options
 * @param {Function} options.onSuccess - Custom success handler callback
 * @param {Object} options.customMessages - Custom success messages for specific status codes
 * @param {boolean} options.showToast - Whether to show toast notifications (default: true)
 * @param {boolean} options.showAlert - Whether to show alert dialogs (default: false)
 * @returns {Object} Success handling utilities
 */
export const useApiSuccess = (options = {}) => {
  const { t } = useTranslation();
  const {
    onSuccess,
    customMessages = {},
    showToast = true,
    showAlert = false,
  } = options;

  const showNotification = (title, message) => {
    if (Platform.OS === 'android' && showToast) {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else if (showAlert) {
      Alert.alert(title, message);
    }
  };

  const logSuccess = (response, context = {}) => {
    // You can integrate with your preferred analytics service here
    console.log('API Success:', {
      response,
      context,
      timestamp: new Date().toISOString(),
    });
  };

  const handleApiSuccess = (response, context = {}) => {
    // Log the success
    logSuccess(response, context);

    // Call custom success handler if provided
    if (onSuccess) {
      onSuccess(response, context);
    }

    const { status, data } = response;
    
    // Try to get message from server response first
    let message = data?.message || customMessages[status];
    
    if (!message) {
      switch (status) {
        case 200:
          message = t('success') || 'Operation completed successfully';
          break;
        case 201:
          message = t('created') || 'Resource created successfully';
          break;
        case 202:
          message = t('accepted') || 'Request accepted for processing';
          break;
        case 204:
          message = t('noContent') || 'Operation completed successfully';
          break;
        default:
          message = t('success') || 'Operation completed successfully';
      }
    }

    showNotification(t('success'), message);
  };

  return {
    handleApiSuccess,
    logSuccess,
  };
}; 