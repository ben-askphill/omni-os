import { describe, expect, it } from 'vitest';
import { deviceHint, threadTitle, windowTitle } from '../src/device.ts';

const here = { name: "Ben's MacBook Air", here: true };
const away = { name: "Ben's Mac mini", here: false };

describe('the device a browser tab reaches', () => {
  it('leaves the title alone on this Mac, or when the server does not say', () => {
    expect(windowTitle('Omni', here)).toBe('Omni');
    expect(windowTitle('Overview', here)).toBe('Overview · Omni');
    expect(windowTitle('#volero', here)).toBe('#volero · Omni');
    expect(windowTitle('Settings', undefined)).toBe('Settings · Omni');
  });

  it("leads with the other Mac's name when the tab is on another machine", () => {
    expect(windowTitle('Omni', away)).toBe("Ben's Mac mini · Omni");
    expect(windowTitle('#volero', away)).toBe("Ben's Mac mini · #volero · Omni");
    expect(deviceHint(away)).toBe("This browser is on another machine. Omni runs on Ben's Mac mini");
  });
});

describe('a thread window title', () => {
  it('names the thread, then its channel', () => {
    expect(threadTitle('Fix the cart drawer', 'Pink Gellac')).toBe('Fix the cart drawer · #Pink Gellac');
    expect(threadTitle('', 'conductor')).toBe('Untitled · Conductor');
  });
});
