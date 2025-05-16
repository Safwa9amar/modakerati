import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { validateThesis } from '@/utils/validationSchemas';

const STORAGE_KEY = 'home_store_state';

const saveState = async (state) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save home store state:', e);
  }
};

const loadState = async () => {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    return json ? JSON.parse(json) : undefined;
  } catch (e) {
    console.error('Failed to load home store state:', e);
    return undefined;
  }
};

export const useHomeStore = create((set, get) => ({
  // Step 1: Upload
  uploadType: null, // 'single' or 'multiple'
  files: [],
  setUploadType: (type) => {
    set({ uploadType: type });
    saveState({ ...get(), uploadType: type });
  },
  setFiles: (files) => {
    set({ files });
    saveState({ ...get(), files });
  },
  reorderFiles: (fromIndex, toIndex) => {
    set((state) => {
      const newFiles = [...state.files];
      const [movedFile] = newFiles.splice(fromIndex, 1);
      newFiles.splice(toIndex, 0, movedFile);
      saveState({ ...get(), files: newFiles });
      return { files: newFiles };
    });
  },
  removeFile: (fileToRemove) => {
    set((state) => {
      const updatedFiles = state.files.filter(
        (file) => file.name !== fileToRemove.name
      );
      saveState({ ...get(), files: updatedFiles });
      return { files: updatedFiles };
    });
  },
  renameFile: (fileToRename, newName) => {
    set((state) => {
      const updatedFiles = state.files.map(file => {
        if (file.id === fileToRename.id) {
          // Keep the original extension by extracting it from the old name
          const extension = fileToRename.name.split('.').pop();
          return { ...file, newName: `${newName}.${extension}` };
        }
        return file;
      });
      saveState({ ...get(), files: updatedFiles });
      return { files: updatedFiles };
    });
  },
  updateFileMetaData: (fileToUpdate, metadata) => {
    console.log("fileToUpdate : ", fileToUpdate)
    console.log("metadata : ", metadata)
    set((state) => {
      const updatedFiles = state.files.map(file => 
        file.id === fileToUpdate
          ? { ...file, ...metadata }
          : file
      );
      saveState({ ...get(), files: updatedFiles });
      return { files: updatedFiles };
    });
  },

  // Step 2: Thesis Details
  thesisDetails: {
    title: '',
    description: '',
    subject: '',
    supervisor: '',
    university: '',
    chaptersNumber: 0,
    notes: '',
  },
  setThesisDetails: (details) => {
    set((state) => {
      const newDetails = { ...state.thesisDetails, ...details };
      saveState({ ...get(), thesisDetails: newDetails });
      return { thesisDetails: newDetails };
    });
  },

  // Step 3: Services
  selectedServices: {},
  setSelectedServices: (services) => {
    set({ selectedServices: services });
    saveState({ ...get(), selectedServices: services });
  },

  // Step 4: Review/Confirm
  reviewConfirmed: false,
  setReviewConfirmed: (val) => {
    set({ reviewConfirmed: val });
    saveState({ ...get(), reviewConfirmed: val });
  },

  // Step 5: Processing
  processing: false,
  progress: 0,
  status: '',
  setProcessing: (processing) => {
    set({ processing });
    saveState({ ...get(), processing });
  },
  setProgress: (progress) => {
    set({ progress });
    saveState({ ...get(), progress });
  },
  setStatus: (status) => {
    set({ status });
    saveState({ ...get(), status });
  },

  // Step 6: Result
  resultFile: null,
  setResultFile: (file) => {
    set({ resultFile: file });
    saveState({ ...get(), resultFile: file });
  },

  // Step 7: Freelance Marketplace (optional)
  freelanceSuggested: false,
  setFreelanceSuggested: (val) => {
    set({ freelanceSuggested: val });
    saveState({ ...get(), freelanceSuggested: val });
  },

  reset: () => {
    const resetState = {
      uploadType: null,
      files: [],
      thesisDetails: { title: '', chapters: [], notes: '' },
      selectedServices: {},
      reviewConfirmed: false,
      processing: false,
      progress: 0,
      status: '',
      resultFile: null,
      freelanceSuggested: false,
    };
    set(resetState);
    saveState(resetState);
  },

  // Load state from AsyncStorage
  loadFromStorage: async () => {
    const loaded = await loadState();
    if (loaded) set(loaded);
  },

  // Get formatted data for API submission
  getApiPayload: () => {
    const state = get();
    return {
      files: state.files.map(file => ({
        uri: file.uri,
        name: file.name,
        type: file.type,
        size: file.size
      })),
      thesisDetails: state.thesisDetails,
      services: state.selectedServices,
      uploadType: state.uploadType
    };
  },

  // Validation
  errors: {},
  setErrors: (errors) => set({ errors }),
  clearErrors: () => set({ errors: {} }),

  validateThesisDetails: () => {
    const { thesisDetails, files } = get();
    const result = validateThesis(thesisDetails);
    if (!result.success) {
      set({ errors: result.errors });
      return false;
    }

    if (files.length === 0) {
      set({ errors: { files: 'At least one file is required' } });
      return false;
    }

    set({ errors: {} });
    return true;
  },
}));

// Optionally, you can call useHomeStore.getState().loadFromStorage() on app start to restore state.
