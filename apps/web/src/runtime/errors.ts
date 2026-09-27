import type { OpenCreatorIssue, PublicErrorFacts } from '@opencreator/protocol';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly publicFacts?: PublicErrorFacts;
  readonly issue?: OpenCreatorIssue;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    publicFacts?: PublicErrorFacts;
    issue?: OpenCreatorIssue;
  }) {
    super(input.message);
    this.name = 'ApiClientError';
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
    this.publicFacts = input.publicFacts;
    this.issue = input.issue;
  }
}
