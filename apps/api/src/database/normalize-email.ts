/** Canonical storage form from ADR-010. Provider-specific dot/+ rewriting is forbidden. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
