import { describe, expect, it } from 'vitest';
import { logsDir, serverLogFile } from '../src/paths.ts';

describe('logsDir', () => {
  it("keeps Electron's logs folder for the installed app", () => {
    expect(logsDir({ userData: '/u/Omni', electronLogs: '/h/Library/Logs/Omni', customUserData: false })).toBe('/h/Library/Logs/Omni');
  });

  it('moves the logs into a --user-data-dir, so a dev or QA run never writes the installed server.log', () => {
    const logs = logsDir({ userData: '/tmp/qa/userdata', electronLogs: '/h/Library/Logs/Omni', customUserData: true });
    expect(logs).toBe('/tmp/qa/userdata/logs');
    expect(serverLogFile({ platform: 'darwin', home: '/h', env: {}, userData: '/tmp/qa/userdata', logs })).toBe('/tmp/qa/userdata/logs/server.log');
  });
});
