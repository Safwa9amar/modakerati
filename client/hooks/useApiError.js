import { useTranslation } from '@/localization/i18nProvider';
import { Alert, Platform, ToastAndroid } from 'react-native';

/**
 * Custom hook for handling API errors with enhanced features
 * @param {Object} options - Configuration options
 * @param {Function} options.onError - Custom error handler callback
 * @param {Object} options.customMessages - Custom error messages for specific status codes
 * @param {boolean} options.showToast - Whether to show toast notifications (default: true)
 * @param {boolean} options.showAlert - Whether to show alert dialogs (default: true)
 * @returns {Object} Error handling utilities
 */
export const useApiError = (options = {}) => {
  const { t } = useTranslation();
  const {
    onError,
    customMessages = {},
    showToast = true,
    showAlert = true,
  } = options;

  const showNotification = (title, message) => {
    if (Platform.OS === 'android' && showToast) {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else if (showAlert) {
      Alert.alert(title, message);
    }
  };

  const logError = (error, context = {}) => {
    // You can integrate with your preferred error logging service here
    console.error('API Error:', {
      error,
      context,
      timestamp: new Date().toISOString(),
    });
  };

  const handleApiError = (error, context = {}) => {
    // Log the error
    logError(error, context);

    // Call custom error handler if provided
    if (onError) {
      onError(error, context);
    }

    if (!error.response) {
      // Network error or no response
      const message = t('networkError') || 'Network error. Please check your connection.';
      showNotification(t('error'), message);
      return;
    }

    const { status, data } = error.response;
    
    // Try to get message from server response first
    let message = data?.message || data?.error || customMessages[status];
    if (!message) {
      switch (status) {
        case 400:
          message = t('badRequest') || 'Invalid request';
          break;
        case 401:
          message = t('unauthorized') || 'Please login to continue';
          break;
        case 403:
          message = t('forbidden') || 'You do not have permission to perform this action';
          break;
        case 404:
          message = t('notFound') || 'Resource not found';
          break;
        case 408:
          message = t('timeout') || 'Request timed out';
          break;
        case 409:
          message = t('conflict') || 'Resource conflict';
          break;
        case 422:
          message = t('validationError') || 'Validation error';
          break;
        case 429:
          message = t('tooManyRequests') || 'Too many requests';
          break;
        case 500:
          message = t('serverError') || 'Server error. Please try again later';
          break;
        case 502:
          message = t('badGateway') || 'Bad gateway';
          break;
        case 503:
          message = t('serviceUnavailable') || 'Service unavailable';
          break;
        case 504:
          message = t('gatewayTimeout') || 'Gateway timeout';
          break;
        default:
          message = t('unknownError') || 'An unknown error occurred';
      }
    }

    showNotification(t('error'), message);
  };

  return {
    handleApiError,
    logError,
  };
}; 