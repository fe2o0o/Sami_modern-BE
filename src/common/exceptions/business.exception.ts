import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base class for domain/business rule violations.
 *
 * Distinct from framework HTTP errors so the exception filter can format them
 * consistently and (optionally) attach a machine-readable `code`.
 */
export class BusinessException extends HttpException {
  readonly code?: string;

  constructor(
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    code?: string,
  ) {
    super({ message, code }, status);
    this.code = code;
  }
}

/** 404 — a requested resource does not exist. */
export class ResourceNotFoundException extends BusinessException {
  constructor(resource = 'Resource', code = 'RESOURCE_NOT_FOUND') {
    super(`${resource} not found`, HttpStatus.NOT_FOUND, code);
  }
}

/** 409 — the request conflicts with current state (e.g. duplicate). */
export class ConflictException extends BusinessException {
  constructor(message = 'Resource already exists', code = 'CONFLICT') {
    super(message, HttpStatus.CONFLICT, code);
  }
}
