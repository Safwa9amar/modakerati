import { createUpload } from "../../middlewares/fileUpload.js";
import express from "express";

const upload = createUpload({ maxFileSize: 100 * 1024 * 1024 });
export const post = [
  upload.single('file'),
  async (req: express.Request, res: express.Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      const file = req.file;
      return res.status(200).json({
        success: true,
        file: {
          originalname : file.originalname,
          name: file.filename,
          mimeType: file.mimetype,
          size: file.size,
        },
      });
    } catch (error) {
      console.error('File upload error:', error);
      return res.status(500).json({ error: 'Failed to upload file' });
    }
  },
];
