import { BadRequestException, ValidationError } from '@nestjs/common';
import { ErrorCodes } from '../constants/error-codes.constant';

function collectFieldErrors(
  errors: ValidationError[],
  parentPath = '',
): Record<string, string[]> {
  return errors.reduce<Record<string, string[]>>((acc, error) => {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;

    if (error.constraints) {
      acc[path] = Object.values(error.constraints);
    }

    if (error.children && error.children.length > 0) {
      Object.assign(acc, collectFieldErrors(error.children, path));
    }

    return acc;
  }, {});
}

/**
 * Turns class-validator's ValidationError[] into the platform's standard
 * error envelope, so a request with malformed/unexpected fields is rejected
 * with a structured, per-field breakdown rather than Nest's default shape.
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  return new BadRequestException({
    code: ErrorCodes.VALIDATION_ERROR,
    message: 'Validation failed',
    fields: collectFieldErrors(errors),
  });
}
