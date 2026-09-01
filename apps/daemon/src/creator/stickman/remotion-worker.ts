import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';

type WorkerRequest = {
  timelinePath: string;
  outputPath: string;
  bundlePath: string;
  browserExecutable: string;
  workdir: string;
  jobRoot: string;
  runtimeRoot: string;
};

async function main(): Promise<void> {
  const requestPath = process.argv[2];
  const resultPath = process.argv[3];
  if (!requestPath || !resultPath) throw new Error('stickman_worker_arguments_missing');
  try {
    const request = JSON.parse(await readFile(resolve(requestPath), 'utf8')) as WorkerRequest;
    const workdir = resolve(request.workdir);
    const jobRoot = resolve(request.jobRoot);
    const runtimeRoot = resolve(request.runtimeRoot);
    assertInside(jobRoot, request.timelinePath, 'timeline');
    assertInside(workdir, request.outputPath, 'output');
    assertInside(workdir, requestPath, 'request');
    assertInside(workdir, resultPath, 'result');
    assertInside(runtimeRoot, request.bundlePath, 'bundle');
    assertInside(runtimeRoot, request.browserExecutable, 'browser');
    if (!existsSync(resolve(request.bundlePath)) || !statSync(resolve(request.bundlePath)).isDirectory()) {
      throw new Error('stickman_worker_bundle_missing');
    }
    if (!existsSync(resolve(request.browserExecutable)) || !statSync(resolve(request.browserExecutable)).isFile()) {
      throw new Error('stickman_worker_browser_missing');
    }
    const timeline = JSON.parse(await readFile(resolve(request.timelinePath), 'utf8')) as {
      totalFrames: number;
      fps: number;
      shots?: Array<{ imagePath?: string; audioPath?: string }>;
    };
    for (const shot of timeline.shots ?? []) {
      if (!shot.imagePath || !shot.audioPath) throw new Error('stickman_worker_timeline_path_missing');
      assertInside(jobRoot, shot.imagePath, 'image');
      assertInside(jobRoot, shot.audioPath, 'audio');
    }
    const assetServer = await startAssetServer(resolve(request.bundlePath), timeline.shots ?? []);
    try {
      const renderTimeline = {
        ...timeline,
        shots: (timeline.shots ?? []).map((shot, index) => ({
          ...shot,
          imagePath: `${assetServer.url}/media/${index}/image${extname(shot.imagePath!)}`,
          audioPath: `${assetServer.url}/media/${index}/audio${extname(shot.audioPath!)}`
        }))
      };
      const renderer = await import('@remotion/renderer');
      const composition = await renderer.selectComposition({
        serveUrl: assetServer.url,
        id: 'StickmanLandscape',
        inputProps: renderTimeline,
        browserExecutable: resolve(request.browserExecutable)
      });
      await renderer.renderMedia({
        composition: { ...composition, durationInFrames: timeline.totalFrames, fps: timeline.fps },
        serveUrl: assetServer.url,
        codec: 'h264',
        outputLocation: resolve(request.outputPath),
        inputProps: renderTimeline,
        browserExecutable: resolve(request.browserExecutable),
        concurrency: 1
      });
    } finally {
      await assetServer.close();
    }
    await writeFile(resolve(resultPath), JSON.stringify({ ok: true }), 'utf8');
  } catch (error) {
    await writeFile(resolve(resultPath), JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }), 'utf8');
    process.exitCode = 1;
  }
}

async function startAssetServer(
  bundleRoot: string,
  shots: Array<{ imagePath?: string; audioPath?: string }>
): Promise<{ url: string; close(): Promise<void> }> {
  const media = new Map<string, string>();
  for (const [index, shot] of shots.entries()) {
    media.set(`/media/${index}/image${extname(shot.imagePath!)}`, resolve(shot.imagePath!));
    media.set(`/media/${index}/audio${extname(shot.audioPath!)}`, resolve(shot.audioPath!));
  }
  const server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      const mediaPath = media.get(pathname);
      if (mediaPath !== undefined) {
        serveFile(request, response, mediaPath);
        return;
      }
      const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const bundlePath = resolve(bundleRoot, relativePath);
      const value = relative(bundleRoot, bundlePath);
      if (value.startsWith('..') || isAbsolute(value)) {
        respond(response, 403, 'Forbidden');
        return;
      }
      serveFile(request, response, bundlePath);
    } catch {
      respond(response, 400, 'Bad Request');
    }
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await new Promise<void>(resolvePromise => server.close(() => resolvePromise()));
    throw new Error('stickman_worker_asset_server_failed');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolvePromise, reject) => {
      server.close(error => error ? reject(error) : resolvePromise());
    })
  };
}

function serveFile(request: IncomingMessage, response: ServerResponse, path: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    respond(response, 404, 'Not Found');
    return;
  }
  const size = statSync(path).size;
  const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = range ? Number(range[1]) : 0;
  const requestedEnd = range?.[2] ? Number(range[2]) : size - 1;
  const end = Math.min(size - 1, requestedEnd);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    response.writeHead(416, { 'Content-Range': `bytes */${size}` });
    response.end();
    return;
  }
  response.writeHead(range ? 206 : 200, {
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    'Content-Type': mimeType(path),
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
  });
  createReadStream(path, { start, end }).pipe(response);
}

function respond(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(body);
}

function mimeType(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.woff2') return 'font/woff2';
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.wav') return 'audio/wav';
  if (extension === '.json') return 'application/json';
  return 'application/octet-stream';
}

function assertInside(root: string, child: string, label: string): void {
  const target = resolve(child);
  const value = relative(root, target);
  if (value.startsWith('..') || isAbsolute(value)) {
    throw new Error(`stickman_worker_${label}_path_escape`);
  }
}

void main();
