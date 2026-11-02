export type ServerStatus = 'checking' | 'ready' | 'unreachable' | 'incompatible';

export const STATUS_LABEL: Record<ServerStatus, string> = {
  checking: 'Checking',
  ready: 'Connected',
  unreachable: "Can't reach server",
  incompatible: 'Update needed',
};
