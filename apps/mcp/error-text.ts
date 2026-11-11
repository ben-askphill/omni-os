/** The API's error string, or a status line when the body has none. */
export function errorMessage(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' && body.error) return body.error;
  return `HTTP ${status}`;
}
