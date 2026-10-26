# Prototypes

Standalone experiments. Not npm workspaces, not part of `npm test` or the build, and nothing in `apps/` or `packages/` imports them.

- [activity-monitor](activity-monitor/): live token throughput and system resources. `node prototypes/activity-monitor/sampler.mjs`, then open http://127.0.0.1:4791.
