import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';

// Helper to pick documents from the device
export const pickDocument = async () => {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      copyToCacheDirectory: true,
    });
    
    if (result.canceled) {
      return null;
    }
    
    const file = result.assets[0];
    return {
      name: file.name,
      uri: file.uri,
      size: file.size,
      mimeType: file.mimeType,
    };
  } catch (error) {
    console.error('Error picking document:', error);
    throw error;
  }
};

// Save document to project directory
export const saveDocumentToProject = async (projectId, document) => {
  try {
    // Ensure the project directory exists
    const projectDir = `${FileSystem.documentDirectory}projects/${projectId}`;
    await FileSystem.makeDirectoryAsync(projectDir, { intermediates: true });
    
    // Generate a unique filename
    const timestamp = Date.now();
    const filename = document.name.replace(/\s+/g, '_');
    const destinationUri = `${projectDir}/${timestamp}_${filename}`;
    
    // Copy the file
    await FileSystem.copyAsync({
      from: document.uri,
      to: destinationUri,
    });
    
    return {
      ...document,
      uri: destinationUri,
    };
  } catch (error) {
    console.error('Error saving document:', error);
    throw error;
  }
};

// In a real app, this would process the documents server-side
// or use a native module to handle Word document merging
export const mergeDocuments = async (projectId, documents, options) => {
  try {
    // This is a mock implementation
    // In a real app, you would:
    // 1. Upload the documents to a server
    // 2. Process and merge them using a library like docx or python-docx
    // 3. Download the merged result
    
    // For now, we'll simulate a delay and return a success message
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Return a mock result
    return {
      success: true,
      message: "Documents merged successfully",
      // In a real implementation, this would be the URI to the merged document
      mergedDocumentUri: null,
    };
  } catch (error) {
    console.error('Error merging documents:', error);
    throw new Error('Failed to merge documents. Please try again.');
  }
};

// Mock function to generate a table of contents
export const generateTableOfContents = async (projectId, documents) => {
  // In a real app, this would analyze the documents and extract headings
  return {
    success: true,
    message: "Table of contents generated successfully",
  };
};

// Mock function to format document with headers, footers, etc.
export const formatDocument = async (documentUri, formattingOptions) => {
  // In a real app, this would apply formatting to the document
  return {
    success: true,
    message: "Document formatted successfully",
  };
};