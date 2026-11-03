import { describe, expect, it } from 'vitest';
import { decideQuit, QUIT_CHOICES, quitAction, quitDialog, RESTART_CHOICES, restartDialog, UPDATE_CHOICES, updateAction, updateDialog } from '../src/quit.ts';

describe('quit', () => {
  it('quits at once from an attached server, which keeps running', () => {
    expect(decideQuit({ startedHere: false, runningTurns: 3 })).toEqual({ kind: 'quit', stopServer: false });
    expect(decideQuit({ startedHere: false, runningTurns: 0 })).toEqual({ kind: 'quit', stopServer: false });
  });

  it('stops a server it started when no turn runs, and asks when turns run', () => {
    expect(decideQuit({ startedHere: true, runningTurns: 0 })).toEqual({ kind: 'quit', stopServer: true });
    expect(decideQuit({ startedHere: true, runningTurns: 2 })).toEqual({ kind: 'ask', runningTurns: 2 });
  });

  it('asks when a server it started does not say how many turns run, rather than stop them', () => {
    expect(decideQuit({ startedHere: true, runningTurns: null })).toEqual({ kind: 'ask', runningTurns: null });
    expect(decideQuit({ startedHere: false, runningTurns: null })).toEqual({ kind: 'quit', stopServer: false });
    expect(quitDialog(null).message).toBe('Turns may still be running');
    expect(quitDialog(null).buttons).toEqual(quitDialog(1).buttons);
  });

  it('does what each choice says', () => {
    expect(quitAction('keep-server-running')).toEqual({ kind: 'quit', interruptTurns: false, stopServer: false });
    expect(quitAction('stop-and-quit')).toEqual({ kind: 'quit', interruptTurns: true, stopServer: true });
    expect(quitAction('cancel')).toEqual({ kind: 'stay-open' });
  });

  it('words the dialog as the SwiftUI app did, buttons in choice order', () => {
    expect(quitDialog(1).message).toBe('1 turn is still running');
    expect(quitDialog(4).message).toBe('4 turns are still running');
    expect(quitDialog(1).detail).toBe('Keep the server running in the background to let them finish, or stop them and quit.');
    expect(quitDialog(1).buttons).toEqual(['Keep Server Running', 'Stop Them and Quit', 'Cancel']);
    expect(QUIT_CHOICES).toEqual(['keep-server-running', 'stop-and-quit', 'cancel']);
  });
});

describe('Restart Server with turns running', () => {
  it('asks to wait for them, stop them, or cancel', () => {
    expect(RESTART_CHOICES).toEqual(['when-finished', 'stop-and-restart', 'cancel']);
    expect(restartDialog(1)).toMatchObject({ message: '1 turn is still running', buttons: ['Restart When They Finish', 'Stop Them and Restart', 'Cancel'] });
    expect(restartDialog(3).message).toBe('3 turns are still running');
    expect(restartDialog(null).message).toBe('Turns may still be running');
    expect(restartDialog(null).buttons).toEqual(restartDialog(2).buttons);
  });
});

describe('Relaunch to Update with turns running', () => {
  it('asks to wait for them, stop them, or cancel, and never offers to keep the server running', () => {
    expect(UPDATE_CHOICES).toEqual(['when-finished', 'stop-and-update', 'cancel']);
    expect(updateDialog(2)).toMatchObject({ message: '2 turns are still running', buttons: ['Update When They Finish', 'Stop Them and Update', 'Cancel'] });
    expect(updateDialog(null).message).toBe('Turns may still be running');
    expect(updateDialog(null).buttons).toEqual(updateDialog(1).buttons);
  });

  it('stops the server for every choice that goes on to update', () => {
    expect(updateAction('stop-and-update')).toEqual({ kind: 'quit', interruptTurns: true, stopServer: true });
    expect(updateAction('when-finished')).toEqual({ kind: 'wait-for-turns' });
    expect(updateAction('cancel')).toEqual({ kind: 'stay-open' });
  });
});
