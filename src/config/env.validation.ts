import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(4090),
  DATABASE_URL: Joi.string()
    .pattern(/^postgres(ql)?:\/\/.+/)
    .required()
    .messages({
      'any.required': 'DATABASE_URL is required',
      'string.pattern.base':
        'DATABASE_URL must start with postgresql:// or postgres://',
    }),
  REDIS_URL: Joi.string()
    .pattern(/^rediss?:\/\/.+/)
    .default('redis://localhost:6379'),
  KAFKA_BROKERS: Joi.string().default('localhost:9092'),
  INTERNAL_SERVICE_KEY: Joi.string()
    .min(16)
    .default('dev-internal-service-key-change-in-prod'),
});
