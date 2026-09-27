import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { presentIssue } from './issue-catalog.js';
import { normalizePageIssue } from './page-issue-state.js';

describe('Agent error-code coverage', () => {
  it('shows every declared Runtime error code, including codes added later', () => {
    const file = resolve(process.cwd(), '../../packages/protocol/src/errors.ts');
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const alias = source.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === 'RuntimeErrorCode');
    expect(alias && ts.isTypeAliasDeclaration(alias) && ts.isUnionTypeNode(alias.type)).toBe(true);
    if (!alias || !ts.isTypeAliasDeclaration(alias) || !ts.isUnionTypeNode(alias.type)) return;
    const codes = alias.type.types.map(node => {
      expect(ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)).toBe(true);
      return ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal) ? node.literal.text : '';
    });
    expect(codes.length).toBeGreaterThan(150);
    for (const code of codes) {
      const issue = { ...normalizePageIssue('runtime', 'request', new Error('private'), '操作未完成。'), code,
        technicalDetail: 'Bearer private' };
      const text = presentIssue(issue).description;
      expect(text).toContain(`错误码：${code}`);
      expect(text).toContain('未提供更细的原因');
      expect(text).not.toContain('private');
    }
  });
});
