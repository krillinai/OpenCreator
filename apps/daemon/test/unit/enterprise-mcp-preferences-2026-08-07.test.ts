import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEnterpriseMcpPreferenceRepository
} from '../../src/enterprise/mcp-preferences-2026-08-07.js';
import { migrate } from '../../src/storage/migrations.js';

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe('enterprise MCP preferences', () => {
  it('separates preferences by enterprise origin and agent identity', () => {
    db = new Database(':memory:');
    migrate(db);
    const repository = createEnterpriseMcpPreferenceRepository(db);

    repository.upsert({
      enterpriseOrigin: 'https://enterprise-a.example',
      agentId: 'agent-a',
      upstreamId: 'crm-main',
      installed: true,
      enabled: false
    });
    repository.upsert({
      enterpriseOrigin: 'https://enterprise-b.example',
      agentId: 'agent-a',
      upstreamId: 'crm-main',
      installed: true,
      enabled: true
    });

    expect(repository.list(
      'https://enterprise-a.example',
      'agent-a'
    )).toMatchObject([{
      upstreamId: 'crm-main',
      installed: true,
      enabled: false
    }]);
    expect(repository.list(
      'https://enterprise-b.example',
      'agent-a'
    )).toMatchObject([{
      upstreamId: 'crm-main',
      installed: true,
      enabled: true
    }]);
  });
});
