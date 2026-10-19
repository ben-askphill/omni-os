// The bind address is the only check on /api. Loopback means this machine; anything else means
// whoever can open the port.

/** True for `localhost`, `::1`, and every address in 127.0.0.0/8. */
export function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '[::1]') return true;
  const parts = h.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((n) => n > 255)) return false;
  return octets[0] === 127;
}
