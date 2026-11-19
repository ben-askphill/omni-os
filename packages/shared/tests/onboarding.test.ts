import { describe, expect, it } from 'vitest';
import { otherTools, toolLine, toolList, toolsAddOn, withOtherTools } from '../onboarding.ts';

describe('the tools line onboarding saves', () => {
  it('reads as a list: trimmed, each once whatever the case, empty ones dropped', () => {
    expect(toolList(' Email,, notion , Notion,Google  Drive ')).toEqual(['Email', 'notion', 'Google Drive']);
    expect(toolLine(['Email', ' Slack ', 'email'])).toBe('Email, Slack');
  });

  it('keeps what was typed under Others apart from the picked tools', () => {
    expect(otherTools('Email, Xero, HubSpot, Notion')).toBe('Xero, HubSpot');
    expect(withOtherTools('Email, Xero', 'Pipedrive, Xero')).toBe('Email, Pipedrive, Xero');
    expect(withOtherTools('Email, Xero', '')).toBe('Email');
  });

  it('GitHub opens the code add-on and Shopify the store; nothing else does', () => {
    expect(toolsAddOn('Email, github', 'code')).toBe(true);
    expect(toolsAddOn('Email, Notion', 'code')).toBe(false);
    expect(toolsAddOn('Shopify', 'store')).toBe(true);
    expect(toolsAddOn('GitHub', 'store')).toBe(false);
  });
});
