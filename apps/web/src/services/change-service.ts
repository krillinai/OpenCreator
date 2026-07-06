export type MockChangeCard = {
  id: string;
  title: string;
  path: string;
  delta: string;
  source: 'mock';
};

export function createMockChangeService() {
  return {
    createPromptChange(prompt: string, path: string): MockChangeCard {
      return {
        id: `change_${Date.now()}`,
        title: prompt.length > 0 ? '根据本次输入生成 mock 文件变更' : 'mock 文件变更',
        path,
        delta: '+1 -0',
        source: 'mock'
      };
    }
  };
}
