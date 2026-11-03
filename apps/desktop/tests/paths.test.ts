import { describe, expect, it } from 'vitest';
import { logsDir, serverLogFile } from '../src/paths.ts';

const base = { home: '/h', env: {}, userData: '/u/Omni', electronLogs: '/h/Library/Logs/Omni', customUserData: false };

describe('logsDir', () => {
  it("uses the installed app's logs folder on each OS", () => {
    expect(logsDir({ ...base, platform: 'darwin' })).toBe('/h/Library/Logs/Omni');
    expect(logsDir({ ...base, platform: 'linux' })).toBe('/h/.local/state/omni-os');
    expect(logsDir({ ...base, platform: 'linux', env: { XDG_STATE_HOME: '/s' } })).toBe('/s/omni-os');
  });

  it('moves the logs into a --user-data-dir, so a dev or QA run never writes the installed server.log', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const logs = logsDir({ ...base, platform, userData: '/tmp/qa/userdata', customUserData: true });
      expect(logs).toBe('/tmp/qa/userdata/logs');
      expect(serverLogFile({ platform, home: '/h', env: {}, userData: '/tmp/qa/userdata', logs })).toBe('/tmp/qa/userdata/logs/server.log');
    }
  });
});
