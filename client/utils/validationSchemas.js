import { z } from 'zod';

export const thesisSchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters'),
  
  description: z.string()
    .min(1, 'Description is required')
    .max(1000, 'Description must be less than 1000 characters'),
  
  subject: z.string()
    .min(1, 'Subject is required')
    .max(100, 'Subject must be less than 100 characters'),
  
  supervisor: z.string()
    .min(1, 'Supervisor is required')
    .max(100, 'Supervisor name must be less than 100 characters'),
  
  university: z.string()
    .min(1, 'University is required'),
  
  chaptersNumber: z.number()
    .int('Chapters must be a whole number')
    .positive('Chapters must be a positive number')
    .min(1, 'At least one chapter is required')
    .max(20, 'Maximum 20 chapters allowed'),
});

export const validateThesis = (data) => {
  try {
    return {
      success: true,
      data: thesisSchema.parse(data)
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        errors: error.errors.reduce((acc, curr) => {
          const field = curr.path[0];
          acc[field] = curr.message;
          return acc;
        }, {})
      };
    }
    throw error;
  }
};