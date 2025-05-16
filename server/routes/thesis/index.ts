import express from "express";
import { validateRequest } from "../../middlewares/validateRequest.js";
import { createThesisSchema } from "../../schemas/thesis-upload.js";
import { authMiddleware } from "../../middlewares/authMiddleware.js";

export const post = [
  authMiddleware,
  validateRequest(createThesisSchema),
  async (req: express.Request, res: express.Response) => {
    const files = req.body.files;
    const thesisDetails = req.body.uploadThesisDetails;
    console.log(files);
    console.log(thesisDetails);
    try {
      return res.json({ 
        message: 'Files uploaded successfully',
        files: req.body 
      });
    } catch (error) {
      
    }
  },
];

