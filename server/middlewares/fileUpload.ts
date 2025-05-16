import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { Request, Response, NextFunction } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration interface
interface FileUploadConfig {
  maxFileSize?: number; // in bytes
}

// Default configuration
const DEFAULT_CONFIG: FileUploadConfig = {
  maxFileSize: 10 * 1024 * 1024, // 10MB default
};

// Configure storage
const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter function
const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  // Accept all file types
  cb(null, true);
};

// Create multer upload instance
const createUpload = (config: FileUploadConfig = {}) => {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  return multer({
    storage: storage,
    limits: {
      fileSize: finalConfig.maxFileSize,
    }
  });
};

// Middleware to handle multer errors
const handleMulterError = (err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `File size too large. Maximum size is ${DEFAULT_CONFIG.maxFileSize! / (1024 * 1024)}MB`
      });
    }
    return res.status(400).json({
      error: err.message
    });
  }
  if (err) {
    return res.status(400).json({
      error: err.message
    });
  }
  next();
};

// Create default upload instance
const upload = createUpload();

export { upload, handleMulterError, createUpload, FileUploadConfig }; 