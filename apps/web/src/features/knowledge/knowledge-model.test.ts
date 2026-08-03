import { describe, expect, it } from 'vitest';
import { knowledgeDocuments, queryKnowledgeDocuments } from './knowledge-model.js';

describe('enterprise knowledge fixtures', () => {
  it('uses stable backend-ready fields for every document', () => {
    expect(new Set(knowledgeDocuments.map(item => item.id)).size).toBe(knowledgeDocuments.length);
    for (const item of knowledgeDocuments) {
      expect(item.id).toMatch(/^knowledge-/);
      expect(item.spaceId).toMatch(/^space-/);
      expect(item.updatedAt).toMatch(/^2026-/);
      expect(['synced', 'stale', 'processing']).toContain(item.syncStatus);
      expect(['all_employees', 'department', 'restricted']).toContain(item.visibility);
      expect(item.tags.length).toBeGreaterThan(0);
    }
  });

  it('combines normalized text search and category filtering', () => {
    expect(queryKnowledgeDocuments(knowledgeDocuments, '退款', 'all').map(item => item.title))
      .toEqual(['客户退款处理规范']);
    expect(queryKnowledgeDocuments(knowledgeDocuments, '', 'engineering').every(item => item.category === 'engineering')).toBe(true);
    expect(queryKnowledgeDocuments(knowledgeDocuments, '不存在', 'all')).toEqual([]);
  });
});

