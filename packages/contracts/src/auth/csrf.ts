/**
 * Cookie-authenticated endpoints (refresh, logout) require this header on top of an allowed Origin.
 * A cross-site page cannot send it without a CORS preflight, which only the web origin passes.
 */
export const CSRF_HEADER_NAME = 'X-Requested-With';
export const CSRF_HEADER_VALUE = 'shanflow';
