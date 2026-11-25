import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { apiError } from './errors.js';

const run = promisify(execFile);
const contentType = 'application/vnd.opencreator.omnivoice-reference';
const bodyLimit = 20 * 1024 * 1024;

export function registerOmniVoiceReference(server: FastifyInstance, dataDir: string, ffmpeg: string) {
  const dir = join(dataDir, 'omnivoice', 'recordings');
  server.addContentTypeParser(contentType, { parseAs: 'buffer', bodyLimit }, (_req, body, done) => done(null, body));
  server.post<{ Body: Buffer }>('/creator-services/tts/omnivoice/reference', { bodyLimit }, async (req, reply) => {
    const body = req.body;
    const format = Buffer.isBuffer(body) && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WAVE'
      ? 'wav' : Buffer.isBuffer(body) && (body.toString('ascii', 0, 3) === 'ID3' || (body[0] === 255 && ((body[1] ?? 0) & 224) === 224)) ? 'mp3' : undefined;
    if (!format) return reply.code(400).send(apiError('VALIDATION_FAILED', 'Select a valid WAV or MP3 reference recording.'));
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = await mkdtemp(join(dir, 'upload-'));
    try {
      const input = join(tmp, 'input.' + format);
      const output = join(tmp, 'voice.wav');
      await writeFile(input, body, { mode: 0o600 });
      try {
        await run(ffmpeg, ['-nostdin','-v','error','-xerror','-protocol_whitelist','file','-f',format,'-i',input,
          '-map','0:a:0','-vn','-map_metadata','-1','-ac','1','-ar','24000','-c:a','pcm_s16le','-t','61',output],
          { windowsHide: true, timeout: 60000 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
        return reply.code(400).send(apiError('VALIDATION_FAILED', 'Unable to decode the reference recording.'));
      }
      const wav = await readFile(output);
      if (wav.length < 4800 || wav.length > 60 * 48000 + 256) return reply.code(400).send(apiError('VALIDATION_FAILED', 'Select a recording between 0.1 and 60 seconds long.'));
      const path = join(dir, createHash('sha256').update(wav).digest('hex') + '.wav');
      await rename(output, path);
      return { path };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
}
