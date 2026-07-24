export type BufferTruncation = {
  truncated: boolean;
  droppedItems: number;
  droppedBytes: number;
};

export class BoundedTextBuffer {
  private value = '';
  private droppedBytes = 0;

  constructor(private readonly maxBytes: number) {}

  append(chunk: string): void {
    const combined = Buffer.from(this.value + chunk);
    if (combined.byteLength <= this.maxBytes) {
      this.value = combined.toString('utf8');
      return;
    }
    this.droppedBytes += combined.byteLength - this.maxBytes;
    this.value = combined
      .subarray(combined.byteLength - this.maxBytes)
      .toString('utf8');
  }

  text(): string {
    return this.value;
  }

  truncation(): BufferTruncation {
    return {
      truncated: this.droppedBytes > 0,
      droppedItems: 0,
      droppedBytes: this.droppedBytes
    };
  }
}

export class BoundedLineBuffer {
  private readonly values: Array<{ line: string; bytes: number }> = [];
  private totalBytes = 0;
  private droppedItems = 0;
  private droppedBytes = 0;

  constructor(
    private readonly maxLines: number,
    private readonly maxBytes: number
  ) {}

  append(line: string): void {
    const bytes = Buffer.byteLength(line);
    this.values.push({ line, bytes });
    this.totalBytes += bytes;
    while (
      this.values.length > this.maxLines
      || this.totalBytes > this.maxBytes
    ) {
      const dropped = this.values.shift();
      if (dropped === undefined) break;
      this.totalBytes -= dropped.bytes;
      this.droppedItems += 1;
      this.droppedBytes += dropped.bytes;
    }
  }

  lines(): string[] {
    return this.values.map(value => value.line);
  }

  truncation(): BufferTruncation {
    return {
      truncated: this.droppedItems > 0,
      droppedItems: this.droppedItems,
      droppedBytes: this.droppedBytes
    };
  }
}

export class BoundedFrameBuffer {
  private buffer = '';
  private droppingFrame = false;
  private droppedItems = 0;
  private droppedBytes = 0;

  constructor(private readonly maxFrameBytes: number) {}

  push(chunk: string): string[] {
    let input = chunk;
    const lines: string[] = [];
    if (this.droppingFrame) {
      const newline = input.indexOf('\n');
      if (newline < 0) {
        this.droppedBytes += Buffer.byteLength(input);
        return lines;
      }
      this.droppedBytes += Buffer.byteLength(input.slice(0, newline + 1));
      input = input.slice(newline + 1);
      this.droppingFrame = false;
    }

    const frames = `${this.buffer}${input}`.split('\n');
    this.buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.endsWith('\r') ? frame.slice(0, -1) : frame;
      const bytes = Buffer.byteLength(line);
      if (bytes > this.maxFrameBytes) {
        this.droppedItems += 1;
        this.droppedBytes += bytes;
        continue;
      }
      lines.push(line);
    }
    const bufferedBytes = Buffer.byteLength(this.buffer);
    if (bufferedBytes > this.maxFrameBytes) {
      this.droppedItems += 1;
      this.droppedBytes += bufferedBytes;
      this.buffer = '';
      this.droppingFrame = true;
    }
    return lines;
  }

  flush(): string | undefined {
    if (this.droppingFrame || this.buffer.length === 0) return undefined;
    const value = this.buffer;
    this.buffer = '';
    return value;
  }

  truncation(): BufferTruncation {
    return {
      truncated: this.droppedItems > 0,
      droppedItems: this.droppedItems,
      droppedBytes: this.droppedBytes
    };
  }
}
