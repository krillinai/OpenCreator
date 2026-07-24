export type ConnectionConfig = {
  baseUrl: string;
  token?: string;
};

export type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};
