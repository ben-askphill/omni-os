export function automationsDetail(count: number | null, error: string | null, serverName: string | null): string {
  if (count === null) return error ? 'Could not load' : 'Loading';
  if (count === 0) return 'None yet';
  return serverName ? `${count} on ${serverName}` : String(count);
}

export function versionLabel(version: string | null | undefined, build: string | null | undefined): string {
  if (!version) return 'Omni OS';
  return build ? `Omni OS ${version} (${build})` : `Omni OS ${version}`;
}
