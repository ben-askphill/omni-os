import posthog from 'posthog-js';

const apiKey = import.meta.env.VITE_POSTHOG_KEY;
const apiHost = import.meta.env.VITE_POSTHOG_HOST;

if (!apiKey || !apiHost) {
  if (import.meta.env.DEV) {
    const missingVariable = apiKey ? 'VITE_POSTHOG_HOST' : 'VITE_POSTHOG_KEY';
    throw new Error(
      `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
    );
  }
} else {
  posthog.init(apiKey, {
    api_host: apiHost,
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    logs: {
      serviceName: 'omni-web',
      environment: import.meta.env.MODE,
    },
  });
  posthog.logger.info('PostHog browser log capture initialized', { environment: import.meta.env.MODE });
}

export { posthog };
