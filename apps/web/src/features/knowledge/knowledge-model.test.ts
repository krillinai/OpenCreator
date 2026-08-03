import { describe, expect, it } from 'vitest';
import {
  createKnowledgeAnswer,
  getAccessibleKnowledgeScopes,
  getKnowledgeSuggestions,
  knowledgeProfiles,
  knowledgeScopes
} from './knowledge-model.js';

describe('enterprise knowledge conversation fixtures', () => {
  it('filters knowledge scopes by the active identity', () => {
    expect(getAccessibleKnowledgeScopes('employee').map(scope => scope.id)).toEqual([
      'scope-company-policy',
      'scope-product',
      'scope-customer-success'
    ]);
    expect(getAccessibleKnowledgeScopes('admin')).toHaveLength(knowledgeScopes.length);
  });

  it('does not disclose restricted knowledge in employee answers', () => {
    const answer = createKnowledgeAnswer('employee', 'Runtime 和 Desktop 如何通信？');

    expect(answer.text).toContain('当前权限范围内');
    expect(answer.text).not.toContain('研发知识');
    expect(answer.evidence).toEqual([]);
  });

  it('returns permission-filtered evidence for matched answers', () => {
    const employeeAnswer = createKnowledgeAnswer('employee', '客户退款需要谁审批？');
    expect(employeeAnswer.text).toContain('客户成功负责人');
    expect(employeeAnswer.evidence).toEqual([
      { scopeId: 'scope-customer-success', label: '客户成功知识域', count: 2 }
    ]);

    const adminAnswer = createKnowledgeAnswer('admin', 'Runtime 和 Desktop 如何通信？');
    expect(adminAnswer.text).toContain('Runtime API');
    expect(adminAnswer.evidence).toEqual([
      { scopeId: 'scope-engineering', label: '研发知识域', count: 2 }
    ]);
  });

  it('builds suggestions only from accessible scopes', () => {
    expect(getKnowledgeSuggestions('employee')).not.toContain('Runtime 和 Desktop 如何通信？');
    expect(getKnowledgeSuggestions('admin')).toContain('Runtime 和 Desktop 如何通信？');
  });

  it('uses stable profile and scope identifiers', () => {
    expect(knowledgeProfiles.map(profile => profile.id)).toEqual(['employee', 'admin']);
    expect(new Set(knowledgeScopes.map(scope => scope.id)).size).toBe(knowledgeScopes.length);
    expect(knowledgeScopes.every(scope => scope.id.startsWith('scope-'))).toBe(true);
  });
});
