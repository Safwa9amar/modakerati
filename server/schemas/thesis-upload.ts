import Joi from 'joi';

export const createThesisSchema = {
  body: Joi.object({
      title: Joi.string().required().messages({
        'any.required': 'Thesis title is required',
        'string.base': 'Title must be a string'
      }),
      description: Joi.string().required().messages({
        "string.empty" : "Thesis description is required",
        'string.base': 'Description must be a string'
      }),
      subject: Joi.string().required().messages({
        "string.empty" : "Subject is required",
        'any.required': 'Subject is required',
        'string.base': 'Subject must be a string'
      }),
      supervisor: Joi.string().required().messages({
        "string.empty" : "Supervisor name is required",
        'any.required': 'Supervisor name is required',
        'string.base': 'Supervisor must be a string'
      }),
      university: Joi.string().required().messages({
        "string.empty" : "University name is required",
        'any.required': 'University name is required',
        'string.base': 'University must be a string'
      }),
      chaptersNumber: Joi.number().required().messages({
        "string.empty" : "Number of chapters is required",
        'any.required': 'Number of chapters is required',
        'number.base': 'Chapters number must be a number'
      }),
      notes: Joi.string().allow('')
   
  })
}; 
