/**
 * Converts a file size in MB to bytes
 * @param sizeInMB - The size in megabytes
 * @returns The size in bytes
 */
export const mbToBytes = (sizeInMB: number): number => {
  return sizeInMB * 1024 * 1024;
};

/**
 * Converts bytes to MB
 * @param bytes - The size in bytes
 * @returns The size in megabytes
 */
export const bytesToMB = (bytes: number): number => {
  return bytes / (1024 * 1024);
}; 