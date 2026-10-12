// Inlined at build time (NEXT_PUBLIC_ prefix). Must be the API origin without a trailing slash.
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
