import type { CreatorYtDlpStatusResponse } from '@opencreator/protocol';

type ClientLike = {
  get(path: string): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
};

export function createRuntimeDependencyService(client: ClientLike) {
  return {
    getYtDlpStatus(): Promise<CreatorYtDlpStatusResponse> {
      return client.get('/creator/yt-dlp/status') as Promise<CreatorYtDlpStatusResponse>;
    },
    checkYtDlpUpdate(force = true): Promise<CreatorYtDlpStatusResponse> {
      return client.post(
        '/creator/yt-dlp/check',
        { force }
      ) as Promise<CreatorYtDlpStatusResponse>;
    },
    updateYtDlp(): Promise<CreatorYtDlpStatusResponse> {
      return client.post('/creator/yt-dlp/update') as Promise<CreatorYtDlpStatusResponse>;
    }
  };
}

export type RuntimeDependencyService = ReturnType<typeof createRuntimeDependencyService>;
