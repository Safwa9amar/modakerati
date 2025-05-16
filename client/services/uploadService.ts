import { API_ENDPOINTS } from '@/constants/api_endpoints';
import { appendFilesToFormData } from '@/helpers/formDataHelpers';
import apiClient from '@/utils/api';
import { AxiosError } from 'axios';

interface UploadResponse {
  success: boolean;
  file: {
    name: string;
    mimeType: string;
    size: number;
    path: string;
  };
}

export const uploadFile = async (file: File): Promise<UploadResponse> => {
  try {
    const formData = new FormData();
    appendFilesToFormData(formData, file, 'file');
    const response = await apiClient.post(
      API_ENDPOINTS.UPLOAD_FILE,
      formData
    );
    return response.data as UploadResponse;
  } catch (error) {
    if (error instanceof AxiosError && error.response) {
      console.log("error",error.response);
      throw new Error(error.response.data?.error || 'Failed to upload file');
    }
    throw error;
  }
}; 