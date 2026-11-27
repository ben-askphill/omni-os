// The environment an OpenCode process gets (spec docs/plans/2026-11-27-opencode-harness.md section 6).
// OpenCode turns a provider on whenever its key is in the environment: an OPENAI_API_KEY or a DEEPSEEK_API_KEY in a
// shell profile or a stored secret would move a thread from the free Zen models onto metered billing. Every other
// harness strips a short list of names. OpenCode's list would be long and out of date, so its base environment is an
// allow-list, and the secrets and the thread's own variables pass unless they look like a provider's credential.
import { harnessEnv } from '../env-guard.ts';

/** The names (and prefixes) of Omni's own environment that OpenCode needs to start and find its tools. */
const ALLOWED = [
  /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|TERM|COLORTERM|TZ|TMPDIR|TMP|TEMP|PWD|DISPLAY|WAYLAND_DISPLAY|NO_COLOR|FORCE_COLOR|CI)$/,
  /^LC_/,
  /^XDG_/,
  /^(SSL_CERT_FILE|SSL_CERT_DIR|NIX_SSL_CERT_FILE|NODE_EXTRA_CA_CERTS|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE)$/,
  /^(HTTP_PROXY|HTTPS_PROXY|NO_PROXY|ALL_PROXY)$/i,
  // `opencode` on a mise machine is a wrapper that runs `mise use -g opencode` first.
  /^(MISE|ASDF|VOLTA|NVM|FNM)_/,
  /^OMNI_/,
  // The scripted fake in tests (packages/test-fixtures/fake-opencode.mjs) reads its switches from the environment.
  /^FAKE_OPENCODE_/,
  /^OPENCODE_(DISABLE|EXPERIMENTAL|ENABLE)_/,
];

/** A name that would enable a metered provider in OpenCode (a key, a token, a gateway, a cloud account). */
const PROVIDER = /(?:^|_)(?:OPENCODE_API_KEY|OPENAI|ANTHROPIC|DEEPSEEK|OPENROUTER|GEMINI|GOOGLE_(?:API|GENERATIVE|APPLICATION|CLOUD)|VERTEX|MISTRAL|GROQ|XAI|CEREBRAS|TOGETHER|FIREWORKS|PERPLEXITY|COHERE|NVIDIA|HUGGINGFACE|HF_TOKEN|AZURE|AWS_(?:ACCESS|SECRET|SESSION|BEARER|PROFILE|REGION)|BEDROCK|CLOUDFLARE|HETZNER|AI_GATEWAY|VERCEL_AI|GITHUB_COPILOT|COPILOT|SAMBANOVA|DEEPINFRA|BASETEN|MOONSHOT|ZHIPU|MINIMAX|SCALEWAY|OVH|NEBIUS|VENICE|LLM_|LITELLM|OLLAMA|LMSTUDIO)(?:_|$)/i;

/**
 * The environment an OpenCode process gets: the allow-listed part of `base`, then the channel and global secrets and
 * the thread's own variables (`extra`), without anything that names a provider. Omni's harness guard runs last.
 */
export function opencodeEnv(extra: Record<string, string>, secrets: Record<string, string> = {}, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) if (ALLOWED.some((re) => re.test(k))) kept[k] = v;
  const own = Object.fromEntries(Object.entries({ ...secrets, ...extra }).filter(([k]) => !PROVIDER.test(k)));
  const env = harnessEnv('opencode', {}, own, kept);
  env.OPENCODE_DISABLE_AUTOUPDATE = '1';
  env.OPENCODE_DISABLE_CLAUDE_CODE = '1';
  delete env.OPENCODE_API_KEY;
  return env;
}
