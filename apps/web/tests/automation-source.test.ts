import { describe, expect, it } from 'vitest';
import { artifactChannels, describeArtifactSource, describeEvent, describeWebhookSource } from '../src/format.ts';

const names: Record<string, string> = { c1: 'acme', c2: 'ops' };
const name = (id: string) => names[id] ?? id;

describe('artifact automation labels', () => {
  it('names the trigger', () => {
    expect(describeEvent('artifact_published')).toBe('When a page is published');
  });

  it('lists the channels it listens to by name, or any channel', () => {
    expect(artifactChannels({ event: 'artifact_published', channels: ['c1', 'c2'], updates: false }, name)).toBe('#acme, #ops');
    expect(artifactChannels({ event: 'artifact_published', updates: false }, name)).toBeNull();
    expect(describeArtifactSource({ event: 'artifact_published', updates: false }, name)).toBe('any channel');
  });

  it('falls back to the id for a channel it cannot name, and says when updates fire too', () => {
    expect(describeArtifactSource({ event: 'artifact_published', channels: ['gone'], updates: true }, name)).toBe('#gone · updates too');
  });
});

describe('webhook automation labels', () => {
  it('names the trigger', () => {
    expect(describeEvent('github_webhook')).toBe('When GitHub sends a webhook');
  });

  it('shows the repo and the events it takes', () => {
    expect(describeWebhookSource({ event: 'github_webhook', repo: 'acme/shop', events: ['workflow_run', 'pull_request_review'] })).toBe('acme/shop · workflow_run, pull_request_review');
  });

  it('says when anyone can fire it', () => {
    expect(describeWebhookSource({ event: 'github_webhook', repo: 'acme/shop', events: ['workflow_run'], trust: 'any' })).toBe('acme/shop · workflow_run · anyone');
  });
});
