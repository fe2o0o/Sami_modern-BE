/**
 * Centralised, reusable validation message builders.
 * Keeps class-validator messages consistent across all DTOs.
 */
export const ValidationMessages = {
  required: (field: string) => `${field} is required`,
  mustBeString: (field: string) => `${field} must be a string`,
  mustBeNumber: (field: string) => `${field} must be a number`,
  mustBeBoolean: (field: string) => `${field} must be a boolean`,
  mustBeEmail: (field: string) => `${field} must be a valid email address`,
  mustBeUuid: (field: string) => `${field} must be a valid UUID`,
  mustBeEnum: (field: string) => `${field} has an invalid value`,
  minLength: (field: string, min: number) =>
    `${field} must be at least ${min} characters long`,
  maxLength: (field: string, max: number) =>
    `${field} must be at most ${max} characters long`,
  min: (field: string, min: number) => `${field} must not be less than ${min}`,
  max: (field: string, max: number) => `${field} must not be greater than ${max}`,
} as const;
