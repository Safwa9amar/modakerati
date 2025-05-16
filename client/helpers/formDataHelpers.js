/**
 * Helper function to append files to FormData
 * @param {FormData} formData - The FormData instance to append to
 * @param {Object|Array} files - Single file object or array of file objects
 * @param {string} fieldName - The field name to use when appending (defaults to 'files')
 * @returns {FormData} The modified FormData instance
 */
export const appendFilesToFormData = (formData, files, fieldName = 'files') => {
  if (Array.isArray(files)) {
    files.forEach((file) => {
      formData.append(fieldName, {
        uri: file.uri,
        type: file.mimeType,
        name: file.name,
      });
    });
  } else {
    formData.append(fieldName, {
      uri: files.uri,
      type: files.mimeType,
      name: files.name,
    });
  }
  return formData;
}; 