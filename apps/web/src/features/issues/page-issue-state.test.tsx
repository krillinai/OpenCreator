import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../../runtime/errors.js';
import { buildIssueAgentPrompt, issueConversationText } from './issue-catalog.js';
import { normalizePageIssue, usePageIssueState } from './page-issue-state.js';

describe('usePageIssueState', () => {
  it('explains a confirmed template version mismatch without exposing an arbitrary server response', () => {
    const issue = normalizePageIssue(
      'creator-launch',
      'creator-launch.create-job',
      new ApiClientError({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Unknown creator template: stickman-video@1',
        issue: normalizePageIssue('runtime', 'create', new Error('failed'), '操作未完成，请稍后重试。')
      }),
      '无法创建创作任务。'
    );
    expect(issue.fallbackMessage).toContain('模板版本 1 不受本地服务支持');
    expect(issue.code).toBe('creator_template_version_mismatch');
    expect(issue.fallbackMessage).not.toContain('Unknown creator template');
  });

  it('keeps a sent operation failure until success or dismissal', () => {
    const { result } = renderHook(() => usePageIssueState('projects'));
    act(() => {
      result.current.captureOperationFailure('projects.archive', new Error('API key=secret'), '无法归档项目');
    });
    expect(result.current.issues).toHaveLength(1);
    expect(result.current.issues[0]).toMatchObject({
      scope: { kind: 'page', surface: 'projects' },
      operation: 'projects.archive',
      fallbackMessage: '无法归档项目'
    });
    act(() => result.current.resolveOperation('projects.archive'));
    expect(result.current.issues).toEqual([]);
  });

  it('preserves a normalized ApiClientError issue without storing raw details', () => {
    const { result } = renderHook(() => usePageIssueState('settings'));
    const error = new ApiClientError({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Authorization: Bearer secret',
      details: { stack: 'C:\\Users\\Mayn\\secret' }
    });
    act(() => result.current.captureOperationFailure('settings.save', error, '无法保存设置'));

    expect(JSON.stringify(result.current.issues)).not.toContain('Bearer secret');
    expect(JSON.stringify(result.current.issues)).not.toContain('Users');
  });

  it('passes only a sanitized error summary and registered identifiers to the Agent', () => {
    const issue = normalizePageIssue('projects', 'projects.create', new Error('secret'), '无法创建项目。Authorization: Bearer secret');
    const prompt = buildIssueAgentPrompt(issue, '如何修复？');
    expect(prompt).toContain('无法创建项目。');
    expect(prompt).toContain('如何修复？');
    expect(prompt).toContain('操作：projects.create');
    expect(prompt).not.toContain('Bearer secret');
    expect(prompt).not.toContain('new Error');
  });

  it('includes safe API facts and the business code in Agent text, without technical details', () => {
    const issue = normalizePageIssue('image-generation', 'image.generate', new ApiClientError({
      status: 502,
      code: 'IMAGE_GENERATION_UPSTREAM_ERROR',
      message: 'secret=private',
      publicFacts: { kind: 'rate-limited', provider: 'openai', httpStatus: 429, upstreamCode: 'quota_exceeded' }
    }), '图像生成失败。');
    issue.technicalDetail = 'Bearer private';
    const text = issueConversationText(issue).message;
    expect(text).toContain('IMAGE_GENERATION_UPSTREAM_ERROR');
    expect(text).toContain('HTTP 429');
    expect(text).toContain('quota_exceeded');
    expect(text).not.toContain('private');

    const unknown = normalizePageIssue('image-generation', 'image.generate', new Error('private'), '图像生成失败。');
    expect(issueConversationText({ ...unknown, publicFacts: { kind: 'unknown' } }).message)
      .toContain('尚未确认更细的原因');
  });

  it('preserves a local coded network failure but rejects a token-like code', () => {
    const network = normalizePageIssue('projects', 'projects.load',
      Object.assign(new Error('private host'), { code: 'ENOTFOUND' }), '无法连接服务。');
    expect(network).toMatchObject({
      code: 'ENOTFOUND', source: 'network', publicFacts: { kind: 'dns' }
    });
    const unsafe = normalizePageIssue('projects', 'projects.load',
      Object.assign(new Error('private'), { code: 'sk-private-secret' }), '无法连接服务。');
    expect(unsafe.code).toBe('CLIENT_OPERATION_FAILED');
  });
});
