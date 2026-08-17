/** Cross-cutting application constants. */
export const APP_CONSTANTS = {
  DEFAULT_PAGE: 1,
  DEFAULT_PER_PAGE: 10,
  MAX_PER_PAGE: 100,
} as const;

/** Metadata key for the response message set via @ResponseMessage(). */
export const RESPONSE_MESSAGE_KEY = 'response_message';
