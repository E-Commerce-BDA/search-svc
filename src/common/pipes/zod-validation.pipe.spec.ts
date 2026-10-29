import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BadRequestException } from '@nestjs/common';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    name: z.string().min(2),
    count: z.number().int().positive(),
  });

  const pipe = new ZodValidationPipe(schema);

  it('passes valid input and returns parsed data', () => {
    const input = { name: 'Valid Item', count: 5 };
    const output = pipe.transform(input);
    expect(output).toEqual(input);
  });

  it('throws BadRequestException with VALIDATION_FAILED on invalid input', () => {
    const input = { name: 'x', count: -1 };
    expect(() => pipe.transform(input)).toThrow(BadRequestException);

    try {
      pipe.transform(input);
    } catch (err) {
      const response = (err as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: Array<{ field: string; message: string }>;
      };
      expect(response.code).toBe('VALIDATION_FAILED');
      expect(response.details).toHaveLength(2);
      expect(response.details[0].field).toBe('name');
      expect(response.details[1].field).toBe('count');
    }
  });
});

