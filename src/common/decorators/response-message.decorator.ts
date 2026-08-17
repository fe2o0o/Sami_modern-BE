import { SetMetadata } from '@nestjs/common';
import { RESPONSE_MESSAGE_KEY } from '../constants/app.constants';

/**
 * Override the default success message in the unified response envelope.
 *
 * Usage:
 *   @ResponseMessage('Invoice created successfully')
 *   @Post() create() { ... }
 */
export const ResponseMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);
