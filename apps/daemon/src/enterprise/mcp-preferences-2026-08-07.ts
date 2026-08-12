import type Database from 'better-sqlite3';
import { normalizeDatabaseTimestamp } from '../storage/database.js';

export type EnterpriseMcpPreference = {
  enterpriseOrigin: string;
  agentId: string;
  upstreamId: string;
  installed: boolean;
  enabled: boolean;
  updatedAt: string;
};

export type EnterpriseMcpPreferenceRepository = {
  get(
    enterpriseOrigin: string,
    agentId: string,
    upstreamId: string
  ): EnterpriseMcpPreference | undefined;
  list(
    enterpriseOrigin: string,
    agentId: string
  ): EnterpriseMcpPreference[];
  upsert(input: {
    enterpriseOrigin: string;
    agentId: string;
    upstreamId: string;
    installed: boolean;
    enabled: boolean;
  }): EnterpriseMcpPreference;
  delete(
    enterpriseOrigin: string,
    agentId: string,
    upstreamId: string
  ): boolean;
};

type EnterpriseMcpPreferenceRow = {
  enterprise_origin: string;
  agent_id: string;
  upstream_id: string;
  installed: number;
  enabled: number;
  updated_at: string;
};

export function createEnterpriseMcpPreferenceRepository(
  db: Database.Database
): EnterpriseMcpPreferenceRepository {
  const get = db.prepare(`
    SELECT *
    FROM enterprise_mcp_preferences
    WHERE enterprise_origin = ?
      AND agent_id = ?
      AND upstream_id = ?
  `);
  const list = db.prepare(`
    SELECT *
    FROM enterprise_mcp_preferences
    WHERE enterprise_origin = ?
      AND agent_id = ?
    ORDER BY updated_at DESC, upstream_id ASC
  `);
  const upsert = db.prepare(`
    INSERT INTO enterprise_mcp_preferences (
      enterprise_origin,
      agent_id,
      upstream_id,
      installed,
      enabled
    ) VALUES (
      @enterpriseOrigin,
      @agentId,
      @upstreamId,
      @installed,
      @enabled
    )
    ON CONFLICT(enterprise_origin, agent_id, upstream_id) DO UPDATE SET
      installed = excluded.installed,
      enabled = excluded.enabled,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `);
  const remove = db.prepare(`
    DELETE FROM enterprise_mcp_preferences
    WHERE enterprise_origin = ?
      AND agent_id = ?
      AND upstream_id = ?
  `);

  return {
    get(enterpriseOrigin, agentId, upstreamId) {
      const row = get.get(
        enterpriseOrigin,
        agentId,
        upstreamId
      ) as EnterpriseMcpPreferenceRow | undefined;
      return row === undefined ? undefined : mapRow(row);
    },
    list(enterpriseOrigin, agentId) {
      return (
        list.all(enterpriseOrigin, agentId) as EnterpriseMcpPreferenceRow[]
      ).map(mapRow);
    },
    upsert(input) {
      const row = upsert.get({
        ...input,
        installed: input.installed ? 1 : 0,
        enabled: input.enabled ? 1 : 0
      }) as EnterpriseMcpPreferenceRow;
      return mapRow(row);
    },
    delete(enterpriseOrigin, agentId, upstreamId) {
      return remove.run(enterpriseOrigin, agentId, upstreamId).changes > 0;
    }
  };
}

function mapRow(row: EnterpriseMcpPreferenceRow): EnterpriseMcpPreference {
  return {
    enterpriseOrigin: row.enterprise_origin,
    agentId: row.agent_id,
    upstreamId: row.upstream_id,
    installed: row.installed === 1,
    enabled: row.enabled === 1,
    updatedAt: normalizeDatabaseTimestamp(row.updated_at)
  };
}
