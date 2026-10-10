// Preserve model output while replacing upstream operational errors with product-facing text.
export function officialEventStream(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder(); const encoder = new TextEncoder(); let buffered = '';
  function sanitize(frame: string) {
    return frame.split('\n').map(line => {
      if (!line.startsWith('data:')) return line;
      try {
        const value = JSON.parse(line.slice(5)) as { type?: string; message?: string; error?: unknown; response?: { error?: unknown; status?: string } };
        if (value.type === 'error') return `data: ${JSON.stringify({ type: 'error', error: { code: 'official_service_unavailable', message: '官方模型服务暂不可用' } })}`;
        if (value.error) value.error = { code: 'official_service_unavailable', message: '官方模型服务暂不可用' };
        if (value.response?.error) value.response.error = { code: 'official_service_unavailable', message: '官方模型服务暂不可用' };
        return `data: ${JSON.stringify(value)}`;
      } catch { return line; }
    }).join('\n');
  }
  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffered += decoder.decode(chunk, { stream: true });
      buffered = buffered.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffered.indexOf('\n\n')) >= 0) { controller.enqueue(encoder.encode(sanitize(buffered.slice(0, boundary)) + '\n\n')); buffered = buffered.slice(boundary + 2); }
      if (buffered.length > 1024 * 1024) throw new Error('Official event exceeds the supported size');
    },
    flush(controller) { buffered += decoder.decode(); if (buffered) controller.enqueue(encoder.encode(sanitize(buffered))); }
  }));
}
