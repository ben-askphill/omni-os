// Deno entry for the Supabase edge function. Deploy it with --no-verify-jwt (or verify_jwt = false in config.toml):
// Google's redirect carries no Supabase JWT. It needs no database and no service key, only BROKER_RETURN_ORIGINS.
// tsconfig.json leaves this file out of the Node typecheck, because it uses Deno's globals.
import { createBroker } from './handler.ts';

const returnOrigins = (Deno.env.get('BROKER_RETURN_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

Deno.serve(createBroker({ returnOrigins }));
