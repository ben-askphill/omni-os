// The CLI's version: the desktop app's, which apps/cli/scripts/bundle.ts writes into the bundle. "dev" from a checkout.
declare const __OMNI_CLI_VERSION__: string | undefined;

export const VERSION = typeof __OMNI_CLI_VERSION__ === 'string' ? __OMNI_CLI_VERSION__ : 'dev';
