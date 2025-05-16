import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

type ValidationSchema = {
  body?: Joi.ObjectSchema;
  query?: Joi.ObjectSchema;
  params?: Joi.ObjectSchema;
};

// Custom error types
enum ValidationErrorType {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_JSON = 'INVALID_JSON',
  MISSING_REQUIRED = 'MISSING_REQUIRED',
  INVALID_TYPE = 'INVALID_TYPE',
  INVALID_FORMAT = 'INVALID_FORMAT'
}

interface ValidationError {
  type: ValidationErrorType;
  field: string;
  message: string;
  location?: 'body' | 'query' | 'params';
}

export const validateRequest = (schema: ValidationSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const validationOptions = {
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: true,
    };

    const validationErrors: ValidationError[] = [];

    // Parse JSON strings in request body
    if (req.body) {
      Object.keys(req.body).forEach(key => {
        try {
          if (typeof req.body[key] === 'string' && req.body[key].trim().startsWith('{')) {
            req.body[key] = JSON.parse(req.body[key]);
          }
        } catch (e) {
          validationErrors.push({
            type: ValidationErrorType.INVALID_JSON,
            field: key,
            message: `Invalid JSON format for field: ${key}`,
            location: 'body'
          });
        }
      });
    }

    // Validate request body
    if (schema.body) {
      const { error } = schema.body.validate(req.body, validationOptions);
      if (error) {
        error.details.forEach(detail => {
          const errorType = detail.type === 'any.required' 
            ? ValidationErrorType.MISSING_REQUIRED
            : detail.type === 'string.base' || detail.type === 'number.base'
              ? ValidationErrorType.INVALID_TYPE
              : ValidationErrorType.VALIDATION_ERROR;
          validationErrors.push({
            type: errorType,
            field: detail.path.join('.'),
            message: detail.message,
            location: 'body'
          });
        });
      }
    }

    // Validate query parameters
    if (schema.query) {
      const { error } = schema.query.validate(req.query, validationOptions);
      if (error) {
        error.details.forEach(detail => {
          validationErrors.push({
            type: ValidationErrorType.VALIDATION_ERROR,
            field: detail.path.join('.'),
            message: detail.message,
            location: 'query'
          });
        });
      }
    }

    // Validate URL parameters
    if (schema.params) {
      const { error } = schema.params.validate(req.params, validationOptions);
      if (error) {
        error.details.forEach(detail => {
          validationErrors.push({
            type: ValidationErrorType.VALIDATION_ERROR,
            field: detail.path.join('.'),
            message: detail.message,
            location: 'params'
          });
        });
      }
    }

    // If there are any validation errors, return them with appropriate status code
    if (validationErrors.length > 0) {
      // Determine the most appropriate status code
      const statusCode = validationErrors.some(error => 
        error.type === ValidationErrorType.INVALID_JSON
      ) ? 400 : 422;
      console.log("validationErrors",validationErrors);
      return res.status(statusCode).json({
        status: 'error',
        code: statusCode,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    next();
  };
};

// Example usage:
/*
const userSchema = {
  body: Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
  }),
  query: Joi.object({
    role: Joi.string().valid('admin', 'user').optional(),
  }),
  params: Joi.object({
    id: Joi.string().required(),
  }),
};

router.post('/users/:id', validateRequest(userSchema), (req, res) => {
  // Your route handler here
});
*/
