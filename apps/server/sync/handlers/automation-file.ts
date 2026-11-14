import { AUTOMATION_ID, ownFileText, removeOwnFileOnDisk, writeOwnFile } from '../../automation-store.ts';
import { claim, registerHandler } from '../apply.ts';

// The user's automation YAML files in data/automations/, by automation id: last writer wins on the whole file. Only a
// file the clients wrote (automation-files.ts) or deleted goes out; a hand edit stays on its machine until the next
// save in the editor. The file says which machine runs the automation, so every machine reads the same `machine:`.

registerHandler('automation_file', {
  serialize(id) {
    const yaml = ownFileText(id);
    return yaml === null ? null : { yaml };
  },
  apply(change) {
    // The id becomes a file name: anything but a plain id is dropped.
    if (!AUTOMATION_ID.test(change.entity_id) || !claim(change)) return false;
    if (change.op === 'delete') return removeOwnFileOnDisk(change.entity_id);
    const { yaml } = (change.data ?? {}) as { yaml?: unknown };
    if (typeof yaml !== 'string') return false;
    writeOwnFile(change.entity_id, yaml);
    return true;
  },
  notify() {
    // Reload after the transaction, so a catch-up run it starts never writes inside it. Clients refetch (bus.ts). Imported
    // here, not above: the scheduler pulls in the runner, which the sync worker must not load while it starts.
    void import('../../automations.ts').then((m) => m.schedule());
  },
});
