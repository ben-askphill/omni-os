import { OmniHttpError } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { describeFailure } from '../src/review/failure';

const http = (status: number, message = `status ${status}`) => new OmniHttpError({ kind: 'http', status, message, body: null, retryAfter: null });

describe('describeFailure', () => {
  it.each([
    ['no answer', new OmniHttpError({ kind: 'unreachable', detail: 'x' }), 'offline', true],
    ['a 401', http(401), 'signed-out', false],
    ['a 400', http(400, 'Unknown thread'), 'refused', false],
    ['a 404', http(404, 'No such turn'), 'refused', false],
    ['a 500', http(500), 'server', true],
    ['a page that is not JSON', new OmniHttpError({ kind: 'not-json', status: 200, contentType: 'text/html' }), 'server', true],
    ['a plain error', new Error('boom'), 'server', true],
  ] as const)('%s is %s', (_n, error, kind, retryable) => {
    expect(describeFailure(error)).toMatchObject({ kind, retryable });
  });

  it('keeps the server\'s words for a refusal', () => {
    expect(describeFailure(http(400, 'Unknown thread')).message).toBe('Unknown thread');
  });

  it('tells a revoked phone to pair again', () => {
    expect(describeFailure(http(401)).message).toMatch(/no longer accepts this phone/);
  });
});
