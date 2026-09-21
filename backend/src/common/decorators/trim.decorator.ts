import { Transform } from 'class-transformer';

/** Trims surrounding whitespace from string input before validation, so
 * "  Acme  " is stored as "Acme" and a whitespace-only value fails
 * @IsNotEmpty/@MinLength instead of slipping through. Non-strings pass
 * through untouched for the type validators to reject. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
