import { Request, Response, NextFunction } from 'express';
import { ZodType } from 'zod';

/**
 * Validates req.body against a zod schema.
 * On failure: 400 with a flattened list of field errors.
 * On success: replaces req.body with the parsed (typed, trimmed) data.
 */
export function validateBody(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'Request body failed validation',
        details: result.error.flatten().fieldErrors,
      });
      return;
    }

    req.body = result.data;
    next();
  };
}
