// Every entity handler. Importing this registers them with apps/server/sync/apply.ts; add a line per new entity.
import './thread.ts';
import './event.ts';
import './channel.ts';
import './folder.ts';
import './artifact.ts';
import './automation-run.ts';
import './kv.ts';
import './needs-you.ts';
import './limit-stop.ts';
import './trigger-delivery.ts';
