import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_HOST } from '@/constants/api_endpoints';

const api = axios.create({
  baseURL: API_HOST,
  timeout: 10000,
});

// Request interceptor
api.interceptors.request.use(
  async (config) => {
    // Get token
    const token = await AsyncStorage.getItem('auth_token');
    
    // Add common headers
    config.headers = {
      ...config.headers,
      'Accept': 'application/json',
      'Accept-Language': 'en', // or get from your i18n provider
    };

    // Set Content-Type based on whether it's multipart form data
    if (config.data instanceof FormData) {
      config.headers['Content-Type'] = 'multipart/form-data';
    } else {
      config.headers['Content-Type'] = 'application/json';
    }

    // Add auth token
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Add request timestamp for caching
    config.metadata = { 
      startTime: new Date().getTime() 
    };

    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
api.interceptors.response.use(
  (response) => {
    // Calculate request duration
    const duration = new Date().getTime() - response.config.metadata.startTime;
    console.log(`Request to ${response.config.url} took ${duration}ms`);
    
    return response;
  },
  async (error) => {
    if (error.response) {
      switch (error.response.status) {
        case 401:
          // Handle unauthorized
          await AsyncStorage.removeItem('auth_token');
          // Redirect to login
          break;
        case 403:
          // Handle forbidden
          break;
        case 404:
          // Handle not found
          break;
        case 500:
          // Handle server error
          break;
      }
    }
    return Promise.reject(error);
  }
);

// Helper methods
export const apiClient = {
  get: (url, config = {}) => api.get(url, config),
  post: (url, data, config = {}) => api.post(url, data, config),
  put: (url, data, config = {}) => api.put(url, data, config),
  delete: (url, config = {}) => api.delete(url, config),
  // Add more methods as needed
};

export default apiClient; 