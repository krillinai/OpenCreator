import type {
  CreatorArtifact,
  CreatorJob,
  CreatorStageRun,
  DownloadProbe
} from '@opencreator/protocol';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { extractDouyinShareUrl } from '@opencreator/protocol';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDownloadExecutor } from '../../src/creator/download/executor.js';
import { parseDownloadProbe } from '../../src/creator/download/probe-parser.js';
import type { CreatorExecutorInput } from '../../src/creator/executor.js';

let tempDir = '';

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator download executor', () => {
  it('recognizes a Pinterest video Pin and rejects non-Pin URLs', async () => {
    const sourceUrl = 'https://www.pinterest.com/pin/6544361954284154/';
    const probe = parseDownloadProbe({
      id: '6544361954284154', title: 'Video Pin', extractor_key: 'Pinterest',
      webpage_url: sourceUrl, duration: 43.017,
      formats: [{ format_id: 'http-1080', ext: 'mp4', width: 1080, height: 1920, vcodec: 'h264', acodec: 'aac' }]
    }, sourceUrl);
    expect(probe.platform).toBe('pinterest');
    expect(probe.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ mediaType: 'video', videoFormatId: 'http-1080' })
    ]));

    const executor = createDownloadExecutor(await fakeBinaries());
    const workdir = join(tempDir, 'pinterest');
    await mkdir(workdir, { recursive: true });
    await executor.run(stageInput({ workdir, stageId: 'probe', state: { sourceUrl } }));
    expect(JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8'))).toContain(sourceUrl);
    for (const invalidUrl of [
      'https://www.pinterest.com/creator/',
      'https://www.pinterest.com/pin/not-a-pin/',
      'https://notpinterest.com/pin/6544361954284154/'
    ]) {
      await expect(executor.run(stageInput({
        workdir, stageId: 'probe', state: { sourceUrl: invalidUrl }
      }))).rejects.toMatchObject({ code: 'unsupported_source' });
    }
  });

  it('recognizes a Xiaohongshu video note and its downloadable formats', () => {
    const sourceUrl = 'https://www.xiaohongshu.com/explore/6a9149f3000000001f01d20a?xsec_token=sample%3D&xsec_source=pc_feed';
    const probe = parseDownloadProbe({
      id: '6a9149f3000000001f01d20a',
      title: 'Public video note',
      extractor_key: 'XiaoHongShu',
      webpage_url: sourceUrl,
      duration: 173.454,
      formats: [{
        format_id: '0', ext: 'mp4', width: 1388, height: 720,
        vcodec: 'h264', acodec: 'aac'
      }]
    }, sourceUrl);
    expect(probe).toMatchObject({
      platform: 'xiaohongshu', requestedUrl: sourceUrl, duration: 173.454
    });
    expect(probe.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ mediaType: 'video', videoFormatId: '0' })
    ]));
  });

  it('preserves Xiaohongshu note tokens for probe and download but rejects profiles and lookalike hosts', async () => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    const workdir = join(tempDir, 'xiaohongshu');
    await mkdir(workdir, { recursive: true });
    const sourceUrl = 'https://www.xiaohongshu.com/explore/6a9149f3000000001f01d20a?xsec_token=sample%3D&xsec_source=pc_feed';
    await executor.run(stageInput({ workdir, stageId: 'probe', state: { sourceUrl } }));
    let args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
    expect(args).toContain(sourceUrl);

    const probe = { ...parsedProbe(), requestedUrl: sourceUrl, url: sourceUrl };
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    await executor.run(stageInput({
      workdir, stageId: 'download',
      state: { sourceUrl, mediaType: 'video', selectedOptionId: 'video-360-2' },
      inputArtifacts: [probeArtifact]
    }));
    args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
    expect(args).toContain(sourceUrl);

    for (const invalidUrl of [
      'https://www.xiaohongshu.com/user/profile/6a9149f3000000001f01d20a',
      'https://notxiaohongshu.com/explore/6a9149f3000000001f01d20a',
      'https://www.xiaohongshu.com/explore/not-a-note'
    ]) {
      await expect(executor.run(stageInput({
        workdir, stageId: 'probe', state: { sourceUrl: invalidUrl }
      }))).rejects.toMatchObject({ code: 'unsupported_source' });
    }
  });

  it('extracts a Douyin short link from copied share text', async () => {
    const shortUrl = 'https://v.douyin.com/aN88tM5tjyE/';
    const shareText = `2.53 jCu:/ AI复刻爆款短视频全流程！ ${shortUrl} 复制此链接，打开Dou音搜索，直接观看视频！`;
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    const workdir = join(tempDir, 'douyin-share-text');
    await mkdir(workdir, { recursive: true });
    const result = await executor.run(stageInput({
      workdir, stageId: 'probe', state: { sourceUrl: shareText }
    }));
    const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
    expect(args).toContain(shortUrl);
    expect(result.outputs[0]?.metadata?.requestedUrl).toBe(shortUrl);
    expect(extractDouyinShareUrl(`${shareText} (${shortUrl})`)).toBe(shortUrl);
    expect(extractDouyinShareUrl(`${shortUrl} 复制此链接，打开抖音观看`)).toBe(shortUrl);
    expect(extractDouyinShareUrl('https://notv.douyin.com/aN88tM5tjyE/')).toBe('https://notv.douyin.com/aN88tM5tjyE/');
    expect(extractDouyinShareUrl(`${shortUrl} https://v.douyin.com/other/`))
      .toBe(`${shortUrl} https://v.douyin.com/other/`);
  });

  it('lists separate formats for both videos in an X post', () => {
    const probe = xMultiVideoProbe();
    expect(probe).toMatchObject({
      id: 'post-123',
      platform: 'x',
      requestedUrl: 'https://x.com/creator/status/123'
    });
    expect(probe.options.filter(option => option.mediaType === 'video')).toEqual([
      expect.objectContaining({
        id: 'item-1-video-720-1', videoFormatId: 'first-video', playlistIndex: 1
      }),
      expect.objectContaining({
        id: 'item-2-video-1080-1', videoFormatId: 'second-video', playlistIndex: 2
      })
    ]);
  });

  it('downloads the selected second video instead of the entire X post', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'x-second-video');
    await mkdir(workdir, { recursive: true });
    const probe = xMultiVideoProbe();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const executor = createDownloadExecutor(binaries);
    await executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: 'item-2-video-1080-1'
      },
      inputArtifacts: [probeArtifact]
    }));
    const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
    expect(args.slice(args.indexOf('--playlist-items'), args.indexOf('--playlist-items') + 2))
      .toEqual(['--playlist-items', '2']);
    expect(args.slice(args.indexOf('-f'), args.indexOf('-f') + 2))
      .toEqual(['-f', 'second-video']);
  });

  it('recognizes X and legacy Twitter extractor results', () => {
    for (const extractor_key of ['Twitter', 'Twitter:Amplify', 'X']) {
      const probe = parseDownloadProbe({
        id: '123',
        title: 'Public post',
        webpage_url: 'https://x.com/creator/status/123',
        extractor_key,
        formats: [{
          format_id: 'hls-720', ext: 'mp4', width: 1280, height: 720,
          vcodec: 'avc1', acodec: 'mp4a'
        }]
      }, 'https://x.com/creator/status/123');
      expect(probe.platform).toBe('x');
      expect(probe.options).toEqual(expect.arrayContaining([
        expect.objectContaining({ mediaType: 'video', videoFormatId: 'hls-720' })
      ]));
    }
  });

  it('recognizes TikTok extractor formats', () => {
    for (const extractor_key of ['TikTok', 'TikTokVM']) {
      const probe = parseDownloadProbe({
        id: '123', title: 'Public TikTok',
        webpage_url: 'https://www.tiktok.com/@creator/video/123',
        extractor_key,
        formats: [{
          format_id: 'download', ext: 'mp4', width: 720, height: 1280,
          vcodec: 'h264', acodec: 'aac'
        }]
      }, 'https://vm.tiktok.com/abc123/');
      expect(probe).toMatchObject({ platform: 'tiktok', requestedUrl: 'https://vm.tiktok.com/abc123/' });
      expect(probe.options).toEqual(expect.arrayContaining([
        expect.objectContaining({ mediaType: 'video', videoFormatId: 'download' })
      ]));
    }
  });

  it('recognizes Douyin video formats even when a short link resolves through TikTok', () => {
    for (const [extractor_key, requestedUrl] of [
      ['Douyin', 'https://www.douyin.com/video/123'],
      ['TikTok', 'https://v.douyin.com/abc123/']
    ]) {
      const probe = parseDownloadProbe({
        id: '123', title: 'Public Douyin video',
        webpage_url: 'https://www.douyin.com/video/123', extractor_key,
        formats: [{
          format_id: 'download', ext: 'mp4', width: 720, height: 1280,
          vcodec: 'h264', acodec: 'aac'
        }]
      }, requestedUrl);
      expect(probe.platform).toBe('douyin');
      expect(probe.options).toEqual(expect.arrayContaining([
        expect.objectContaining({ mediaType: 'video', videoFormatId: 'download' })
      ]));
    }
  });

  it('recognizes Facebook video and reel extractor results', () => {
    for (const extractor_key of ['Facebook', 'Facebook:Reel']) {
      const probe = parseDownloadProbe({
        id: '123', title: 'Public reel',
        webpage_url: 'https://www.facebook.com/reel/123', extractor_key,
        formats: [{
          format_id: 'sd', ext: 'mp4', width: 640, height: 360,
          vcodec: 'h264', acodec: 'aac'
        }]
      }, 'https://fb.watch/abc123/');
      expect(probe.platform).toBe('facebook');
      expect(probe.options).toEqual(expect.arrayContaining([
        expect.objectContaining({ mediaType: 'video', videoFormatId: 'sd' })
      ]));
    }
  });

  it('passes Facebook videos, reels and short links to yt-dlp but rejects profiles and impostors', async () => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    for (const [index, url] of [
      'https://www.facebook.com/watch/?v=123',
      'https://m.facebook.com/reel/123',
      'https://facebook.com/videos/123',
      'https://www.facebook.com/creator/videos/123',
      'https://fb.watch/abc123/'
    ].entries()) {
      const workdir = join(tempDir, `facebook-${index}`);
      await mkdir(workdir, { recursive: true });
      await executor.run(stageInput({ workdir, stageId: 'probe', state: { sourceUrl: url } }));
      const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
      expect(args).toContain(url);
    }
    for (const url of [
      'https://www.facebook.com/creator',
      'https://www.facebook.com/watch/',
      'https://notfacebook.com/reel/123',
      'https://fb.watch/'
    ]) {
      await expect(executor.run(stageInput({
        workdir: tempDir, stageId: 'probe', state: { sourceUrl: url }
      }))).rejects.toMatchObject({ code: 'unsupported_source' });
    }
  });

  it('passes Douyin videos and short links to yt-dlp but rejects profiles and lookalike hosts', async () => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    for (const [index, url] of [
      'https://www.douyin.com/video/123',
      'https://douyin.com/video/123?modal_id=123',
      'https://v.douyin.com/abc123/'
    ].entries()) {
      const workdir = join(tempDir, `douyin-${index}`);
      await mkdir(workdir, { recursive: true });
      await executor.run(stageInput({ workdir, stageId: 'probe', state: { sourceUrl: url } }));
      const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
      expect(args).toContain(url);
    }
    for (const url of [
      'https://www.douyin.com/user/creator',
      'https://notdouyin.com/video/123',
      'https://v.douyin.com/'
    ]) {
      await expect(executor.run(stageInput({
        workdir: tempDir, stageId: 'probe', state: { sourceUrl: url }
      }))).rejects.toMatchObject({ code: 'unsupported_source' });
    }
  });

  it('converts a Douyin jingxuan modal link into a video URL for probing and downloading', async () => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    const workdir = join(tempDir, 'douyin-featured');
    await mkdir(workdir, { recursive: true });
    const sourceUrl = 'https://www.douyin.com/jingxuan?modal_id=7687030616353823355';
    const videoUrl = 'https://www.douyin.com/video/7687030616353823355';
    const result = await executor.run(stageInput({
      workdir, stageId: 'probe', state: { sourceUrl }
    }));
    expect(result.outputs[0]?.metadata?.requestedUrl).toBe(sourceUrl);
    let args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
    expect(args).toContain(videoUrl);
    expect(args).not.toContain(sourceUrl);

    const probe = { ...parsedProbe(), requestedUrl: sourceUrl, url: videoUrl };
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    await executor.run(stageInput({
      workdir, stageId: 'download',
      state: { sourceUrl, mediaType: 'video', selectedOptionId: 'video-360-2' },
      inputArtifacts: [probeArtifact]
    }));
    args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
    expect(args).toContain(videoUrl);
    expect(args).not.toContain(sourceUrl);
  });

  it('rejects a Douyin jingxuan page without a numeric modal id', async () => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    for (const sourceUrl of [
      'https://www.douyin.com/jingxuan',
      'https://www.douyin.com/jingxuan?modal_id=abc',
      'https://notdouyin.com/jingxuan?modal_id=123'
    ]) {
      await expect(executor.run(stageInput({
        workdir: tempDir, stageId: 'probe', state: { sourceUrl }
      }))).rejects.toMatchObject({ code: 'unsupported_source' });
    }
  });

  it('reports a missing fresh Douyin cookie as an access requirement', async () => {
    const binaries = await fakeBinaries({ failure: 'ERROR: Fresh cookies (not necessarily logged in) are needed' });
    const executor = createDownloadExecutor(binaries);
    await expect(executor.run(stageInput({
      workdir: tempDir, stageId: 'probe',
      state: { sourceUrl: 'https://www.douyin.com/jingxuan?modal_id=7687030616353823355' }
    }))).rejects.toMatchObject({ code: 'login_required' });
  });

  it('recognizes Instagram extractor formats', () => {
    for (const extractor_key of ['Instagram', 'Instagram:Story']) {
      const probe = parseDownloadProbe({
        id: 'abc123', title: 'Public reel',
        webpage_url: 'https://www.instagram.com/reel/abc123/',
        extractor_key,
        formats: [{
          format_id: 'dash-720', ext: 'mp4', width: 720, height: 1280,
          vcodec: 'h264', acodec: 'aac'
        }]
      }, 'https://www.instagram.com/reel/abc123/');
      expect(probe.platform).toBe('instagram');
      expect(probe.options).toEqual(expect.arrayContaining([
        expect.objectContaining({ mediaType: 'video', videoFormatId: 'dash-720' })
      ]));
    }
  });

  it('does not offer video formats for image-only Instagram posts', () => {
    const probe = parseDownloadProbe({
      id: 'image123', title: 'Image post', extractor_key: 'Instagram',
      webpage_url: 'https://www.instagram.com/p/image123/', formats: []
    }, 'https://www.instagram.com/p/image123/');
    expect(probe.platform).toBe('instagram');
    expect(probe.options).toEqual([]);
  });

  it('passes Instagram reels and posts to yt-dlp but rejects profiles and lookalike hosts', async () => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    for (const [index, url] of [
      'https://www.instagram.com/reel/abc123/',
      'https://instagram.com/p/abc123/',
      'https://www.instagram.com/tv/abc123/'
    ].entries()) {
      const workdir = join(tempDir, `instagram-${index}`);
      await mkdir(workdir, { recursive: true });
      await executor.run(stageInput({ workdir, stageId: 'probe', state: { sourceUrl: url } }));
      const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
      expect(args).toContain(url);
    }
    for (const url of [
      'https://www.instagram.com/creator/',
      'https://notinstagram.com/reel/abc123/',
      'https://www.instagram.com/stories/creator/123/'
    ]) {
      await expect(executor.run(stageInput({
        workdir: tempDir, stageId: 'probe', state: { sourceUrl: url }
      }))).rejects.toMatchObject({ code: 'unsupported_source' });
    }
  });

  it('passes TikTok video and short URLs to yt-dlp, but rejects profiles and lookalike hosts', async () => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    const urls = [
      'https://www.tiktok.com/@creator/video/123',
      'https://m.tiktok.com/@creator/video/123',
      'https://vm.tiktok.com/abc123/',
      'https://vt.tiktok.com/abc123/'
    ];
    for (const [index, url] of urls.entries()) {
      const workdir = join(tempDir, `tiktok-${index}`);
      await mkdir(workdir, { recursive: true });
      await executor.run(stageInput({ workdir, stageId: 'probe', state: { sourceUrl: url } }));
      const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
      expect(args).toContain(url);
    }
    for (const url of ['https://www.tiktok.com/@creator', 'https://not-tiktok.com/@creator/video/123']) {
      await expect(executor.run(stageInput({
        workdir: tempDir, stageId: 'probe', state: { sourceUrl: url }
      }))).rejects.toMatchObject({ code: 'unsupported_source' });
    }
  });

  it('passes X and Twitter post URLs to the existing yt-dlp probe', async () => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    for (const host of ['x.com', 'twitter.com']) {
      const workdir = join(tempDir, host);
      await mkdir(workdir, { recursive: true });
      const url = `https://${host}/creator/status/123`;
      await executor.run(stageInput({ workdir, stageId: 'probe', state: { sourceUrl: url } }));
      const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
      expect(args).toContain(url);
    }
  });

  it('normalizes real video and MP3 choices without exposing arbitrary state format ids', () => {
    const probe = parsedProbe();

    expect(probe).toMatchObject({
      requestedUrl: 'https://www.youtube.com/watch?v=demo',
      platform: 'youtube',
      uploader: 'OpenCreator',
      width: 1920,
      height: 1080
    });
    expect(probe.options).toEqual([
      expect.objectContaining({
        id: 'video-1080-1',
        mediaType: 'video',
        container: 'mp4',
        videoFormatId: '137',
        audioFormatId: '140',
        audioLanguage: 'und',
        estimatedBytes: 120
      }),
      expect.objectContaining({
        id: 'video-360-2',
        mediaType: 'video',
        videoFormatId: '18'
      }),
      expect.objectContaining({
        id: 'audio-mp3-320',
        mediaType: 'audio',
        bitrateKbps: 320,
        audioFormatId: '140',
        audioLanguage: 'und',
        transcode: 'mp3'
      }),
      expect.objectContaining({ id: 'audio-mp3-192' }),
      expect.objectContaining({ id: 'audio-mp3-128' })
    ]);
  });

  it('creates video and MP3 choices for each detected audio language', () => {
    const probe = multilingualParsedProbe();

    expect(probe.formats).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'audio-en',
        language: 'en',
        languagePreference: 10
      }),
      expect.objectContaining({
        id: 'audio-es',
        language: 'es',
        languagePreference: 5
      })
    ]));
    expect(probe.options.filter(option => option.mediaType === 'video')).toEqual([
      expect.objectContaining({
        id: 'video-1080-1-audio-en',
        videoFormatId: 'video-1080',
        audioFormatId: 'audio-en',
        audioLanguage: 'en'
      }),
      expect.objectContaining({
        id: 'video-1080-1-audio-es',
        videoFormatId: 'video-1080',
        audioFormatId: 'audio-es',
        audioLanguage: 'es'
      })
    ]);
    expect(probe.options.filter(option => option.mediaType === 'audio')).toHaveLength(6);
    expect(probe.options).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'audio-mp3-192-audio-en',
        audioFormatId: 'audio-en',
        audioLanguage: 'en'
      }),
      expect.objectContaining({
        id: 'audio-mp3-192-audio-es',
        audioFormatId: 'audio-es',
        audioLanguage: 'es'
      })
    ]));
  });

  it('offers MP3 extraction when the source only has a combined media format', () => {
    const probe = parseDownloadProbe({
      id: 'progressive-only',
      title: 'Progressive only',
      webpage_url: 'https://www.youtube.com/watch?v=progressive-only',
      extractor_key: 'Youtube',
      duration: 10,
      formats: [{
        format_id: '18',
        ext: 'mp4',
        width: 640,
        height: 360,
        tbr: 500,
        filesize: 30,
        vcodec: 'avc1',
        acodec: 'mp4a'
      }]
    }, 'https://www.youtube.com/watch?v=progressive-only');

    expect(probe.options).toEqual([
      expect.objectContaining({
        id: 'video-360-1',
        videoFormatId: '18'
      }),
      expect.objectContaining({
        id: 'audio-mp3-320',
        audioFormatId: '18',
        transcode: 'mp3'
      }),
      expect.objectContaining({ id: 'audio-mp3-192' }),
      expect.objectContaining({ id: 'audio-mp3-128' })
    ]);
  });

  it('accepts null metadata fields emitted by real yt-dlp probes', () => {
    const probe = parseDownloadProbe({
      id: 'nullable-fields',
      title: 'Nullable fields',
      webpage_url: 'https://www.youtube.com/watch?v=nullable-fields',
      extractor_key: 'Youtube',
      uploader: null,
      channel: null,
      thumbnail: null,
      width: null,
      height: null,
      formats: [{
        format_id: '18',
        ext: 'mp4',
        width: 640,
        height: 360,
        fps: null,
        tbr: null,
        abr: null,
        filesize: null,
        filesize_approx: null,
        vcodec: 'avc1',
        acodec: 'mp4a'
      }, {
        format_id: 'storyboard',
        ext: 'mhtml',
        width: null,
        height: null,
        fps: null,
        tbr: null,
        abr: null,
        filesize: null,
        filesize_approx: null,
        vcodec: null,
        acodec: null
      }]
    }, 'https://www.youtube.com/watch?v=nullable-fields');

    expect(probe).toMatchObject({
      uploader: null,
      thumbnailUrl: null,
      width: 640,
      height: 360
    });
    expect(probe.options).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'video-360-1',
        videoFormatId: '18'
      })
    ]));
  });

  it('estimates video size from duration and bitrate instead of using audio bytes alone', () => {
    const probe = parseDownloadProbe({
      id: 'estimated-size',
      title: 'Estimated size',
      webpage_url: 'https://www.youtube.com/watch?v=estimated-size',
      extractor_key: 'Youtube',
      duration: 100,
      formats: [{
        format_id: 'video',
        ext: 'mp4',
        width: 1920,
        height: 1080,
        tbr: 4_000,
        filesize: null,
        filesize_approx: null,
        vcodec: 'avc1',
        acodec: 'none'
      }, {
        format_id: 'audio',
        ext: 'm4a',
        abr: 128,
        filesize: 1_600_000,
        vcodec: 'none',
        acodec: 'mp4a'
      }]
    }, 'https://www.youtube.com/watch?v=estimated-size');

    expect(probe.options[0]).toMatchObject({
      id: 'video-1080-1',
      estimatedBytes: 51_600_000
    });
  });

  it('downloads the selected video option with bundled ffmpeg and emits verified metadata', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'video-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const reportProgress = vi.fn();
    const executor = createDownloadExecutor(binaries);

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: 'video-360-2'
      },
      progress: {
        optionId: 'video-1080-1',
        mediaType: 'video',
        sourceUrl: probe.requestedUrl
      },
      inputArtifacts: [probeArtifact],
      reportProgress
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '--encoding',
      'utf-8',
      '--proxy',
      'http://127.0.0.1:7897',
      '--ffmpeg-location',
      binaries.ffmpegPath,
      '--progress',
      '--progress-delta',
      '0.5',
      '-f',
      '137+140',
      '--merge-output-format',
      'mp4'
    ]));
    expect(result.outputs).toEqual([expect.objectContaining({
      kind: 'source_video',
      status: 'completed',
      metadata: expect.objectContaining({
        fileName: 'download.mp4',
        mimeType: 'video/mp4',
        size: 14,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        optionId: 'video-1080-1',
        selectedHeight: 1080,
        videoCodec: 'h264',
        audioCodec: 'aac',
        playbackCompatible: true,
        normalizedForPlayback: false
      })
    })]);
    const downloadPercents = reportProgress.mock.calls
      .map(([progress]) => progress)
      .filter(progress => progress.phase === 'downloading')
      .map(progress => Number(progress.percent));
    expect(downloadPercents).toHaveLength(3);
    expect(downloadPercents).toEqual(
      [...downloadPercents].sort((left, right) => left - right)
    );
    expect(downloadPercents[1]).toBeCloseTo(79.5, 1);
    expect(downloadPercents.at(-1)).toBeGreaterThan(downloadPercents[1]!);
    expect(reportProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'succeeded',
      phase: 'completed',
      percent: 100
    }));
  });

  it('downloads the audio track bound to the selected video language', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'multilingual-video-work');
    await mkdir(workdir, { recursive: true });
    const probe = multilingualParsedProbe();
    const option = probe.options.find(candidate => (
      candidate.mediaType === 'video'
      && candidate.audioLanguage === 'es'
    ));
    expect(option).toBeDefined();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const executor = createDownloadExecutor(binaries);

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: option!.id
      },
      inputArtifacts: [probeArtifact]
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '-f',
      'video-1080+audio-es'
    ]));
    expect(result.outputs[0]?.metadata).toEqual(expect.objectContaining({
      optionId: option!.id,
      audioLanguage: 'es'
    }));
  });

  it('converts VP9 MP4 downloads to H.264 for local playback', async () => {
    const binaries = await fakeBinaries({ videoCodec: 'vp9' });
    const workdir = join(tempDir, 'vp9-video-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const reportProgress = vi.fn();
    const executor = createDownloadExecutor(binaries);

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      inputArtifacts: [probeArtifact],
      reportProgress
    }));

    const ffmpegArgs = JSON.parse(
      await readFile(join(workdir, 'ffmpeg-args.json'), 'utf8')
    ) as string[];
    expect(ffmpegArgs).toEqual(expect.arrayContaining([
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart'
    ]));
    expect(result.outputs).toEqual([expect.objectContaining({
      kind: 'source_video',
      path: expect.stringMatching(/\.playable\.mp4$/),
      metadata: expect.objectContaining({
        fileName: 'download.mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        pixelFormat: 'yuv420p',
        playbackCompatible: true,
        normalizedForPlayback: true
      })
    })]);
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'normalizing_media',
      percent: 98
    }));
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'normalizing_media',
      percent: 98.5
    }));
  }, 20_000);

  it('extracts the selected audio option as an MP3 source artifact', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'audio-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const executor = createDownloadExecutor(binaries);

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'audio',
        selectedOptionId: 'audio-mp3-192'
      },
      inputArtifacts: [probeArtifact]
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '--proxy',
      'http://127.0.0.1:7897',
      '-f',
      '140',
      '--extract-audio',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '192K'
    ]));
    expect(result.outputs).toEqual([expect.objectContaining({
      kind: 'source_audio',
      metadata: expect.objectContaining({
        fileName: 'download.mp3',
        mimeType: 'audio/mpeg',
        mediaType: 'audio',
        selectedBitrateKbps: 192,
        hasAudio: true,
        hasVideo: false
      })
    })]);
  });

  it('downloads a YouTube source for stickman video without a probe artifact', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'stickman-source-work');
    await mkdir(workdir, { recursive: true });
    const reportProgress = vi.fn();
    const executor = createDownloadExecutor(binaries);

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'acquire-source',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=stickman-demo'
      },
      reportProgress
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '--proxy',
      'http://127.0.0.1:7897',
      '--ffmpeg-location',
      binaries.ffmpegPath,
      '-f',
      'bestvideo+bestaudio/best',
      '--merge-output-format',
      'mp4'
    ]));
    expect(result.outputs).toEqual([expect.objectContaining({
      kind: 'source_video',
      status: 'completed',
      metadata: expect.objectContaining({
        source: 'stickman-video',
        sourceUrl: 'https://www.youtube.com/watch?v=stickman-demo',
        mimeType: 'video/mp4',
        playbackCompatible: true
      })
    })]);
    expect(reportProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'succeeded',
      phase: 'completed',
      percent: 100
    }));
  });

  it('rejects a stale probe after the source URL changes', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'stale-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=changed',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      inputArtifacts: [probeArtifact]
    }))).rejects.toMatchObject({ code: 'download_probe_stale' });
  });

  it('routes probe requests through the configured media proxy', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'probe-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      }
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '--proxy',
      'http://127.0.0.1:7897',
      '--dump-single-json'
    ]));
  });

  it('passes portable runtime prefix arguments and environment to yt-dlp', async () => {
    const binaries = await fakeBinaries({ portableRuntime: true });
    const workdir = join(tempDir, 'portable-probe-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      }
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args[0]).toBe('--portable-runtime');
    expect(JSON.parse(
      await readFile(join(workdir, 'runtime-env.json'), 'utf8')
    )).toEqual({
      sslCertificateFile: '/runtime/cacert.pem'
    });
  });

  it('keeps probe progress indeterminate until video information is ready', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'probe-progress-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);
    const reportProgress = vi.fn();

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      },
      reportProgress
    }));

    expect(reportProgress.mock.calls.map(([progress]) => progress)).toEqual([
      expect.objectContaining({
        phase: 'validating',
        percent: null
      }),
      expect.objectContaining({
        phase: 'probing_source',
        percent: null
      }),
      expect.objectContaining({
        phase: 'completed',
        percent: 100
      })
    ]);
    expect(result.progress).toEqual(expect.objectContaining({
      phase: 'completed',
      percent: 100
    }));
  });

  it('reports the yt-dlp timeout cause and safe public facts', async () => {
    const binaries = await fakeBinaries({
      failure: "ERROR: Unable to download API page: Connection to www.youtube.com timed out."
    });
    const workdir = join(tempDir, 'network-failure-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      }
    }))).rejects.toMatchObject({
      code: 'network_unavailable',
      message: 'yt-dlp connection to the video platform timed out. Check the network or proxy settings.',
      publicFacts: { kind: 'timeout', provider: 'yt-dlp' }
    });
  });

  it('preserves a non-ASCII output filename split across stdout chunks', async () => {
    const fileName = 'clip-\u2019-test.mp4';
    const binaries = await fakeBinaries({ outputName: fileName, splitOutputUtf8: true });
    const workdir = join(tempDir, 'unicode-output-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const executor = createDownloadExecutor(binaries);
    const result = await executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: 'video-360-2'
      },
      inputArtifacts: [await writeProbeArtifact(workdir, probe)]
    }));

    expect(result.outputs[0]?.path).toBe(join(workdir, fileName));
    expect(result.outputs[0]?.metadata?.fileName).toBe(fileName);
    expect(JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')))
      .toEqual(expect.arrayContaining(['--encoding', 'utf-8']));
  });

  it('identifies a damaged reported filename rather than returning a generic ENOENT', async () => {
    const binaries = await fakeBinaries({
      outputName: 'clip-\u2019-test.mp4',
      reportedOutputName: 'clip-\uFFFD\uFFFD-test.mp4'
    });
    const workdir = join(tempDir, 'damaged-output-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: 'video-360-2'
      },
      inputArtifacts: [await writeProbeArtifact(workdir, probe)]
    }))).rejects.toMatchObject({
      code: 'download_output_encoding_invalid',
      publicFacts: { kind: 'invalid-response', provider: 'yt-dlp' }
    });
  });

  it('reports a missing yt-dlp output with a download-specific error', async () => {
    const binaries = await fakeBinaries({ reportedOutputName: 'other.mp4' });
    const workdir = join(tempDir, 'missing-output-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: 'video-360-2'
      },
      inputArtifacts: [await writeProbeArtifact(workdir, probe)]
    }))).rejects.toMatchObject({
      code: 'download_output_missing',
      publicFacts: { kind: 'not-found', provider: 'yt-dlp' }
    });
  });

  it('reports proxy refusal separately from a platform timeout', async () => {
    const binaries = await fakeBinaries({
      failure: 'ERROR: ProxyError: connection refused at http://user:secret@127.0.0.1:7897'
    });
    const workdir = join(tempDir, 'proxy-failure-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: { sourceUrl: 'https://www.youtube.com/watch?v=demo' }
    }))).rejects.toMatchObject({
      code: 'network_unavailable',
      message: expect.stringContaining('proxy connection was refused'),
      publicFacts: { kind: 'connection-refused', provider: 'yt-dlp' }
    });
  });

  it('reports an upstream HTTP status without leaking the request URL', async () => {
    const binaries = await fakeBinaries({
      failure: 'ERROR: Unable to download webpage: HTTP Error 403: Forbidden https://example.com/?token=secret'
    });
    const workdir = join(tempDir, 'http-failure-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: { sourceUrl: 'https://www.youtube.com/watch?v=demo' }
    }))).rejects.toMatchObject({
      code: 'download_http_error',
      message: 'The video platform returned HTTP 403 to yt-dlp.',
      publicFacts: { kind: 'unauthorized', provider: 'yt-dlp', httpStatus: 403 }
    });
  });

  it('keeps an unclassified yt-dlp cause while redacting links and tokens', async () => {
    const binaries = await fakeBinaries({
      failure: 'ERROR: Extractor returned an unexpected challenge at https://example.com/?token=secret token=private'
    });
    const workdir = join(tempDir, 'unknown-failure-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    try {
      await executor.run(stageInput({
        workdir,
        stageId: 'probe',
        state: { sourceUrl: 'https://www.youtube.com/watch?v=demo' }
      }));
      throw new Error('Expected yt-dlp to fail');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'download_failed',
        publicFacts: { kind: 'unknown', provider: 'yt-dlp' }
      });
      const message = (error as Error).message;
      expect(message).toContain('unexpected challenge');
      expect(message).not.toContain('example.com');
      expect(message).not.toContain('private');
      expect(message).not.toContain('secret');
    }
  });

  it('recommends updating yt-dlp when the platform extractor is outdated', async () => {
    const binaries = await fakeBinaries({
      failure: 'ERROR: Signature extraction failed. Please update to the latest version.'
    });
    const workdir = join(tempDir, 'outdated-extractor-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      }
    }))).rejects.toMatchObject({
      code: 'yt_dlp_update_recommended',
      message: 'yt-dlp could not extract this video; its platform extractor may be outdated.',
      publicFacts: { kind: 'unsupported', provider: 'yt-dlp' }
    });
  });

  it('rejects misleading domains that only end with a supported domain name', async () => {
    const config = createDefaultCreatorServicesConfig();
    const executor = createDownloadExecutor({
      configStore: { read: async () => config },
      ytDlpPath: '/missing/yt-dlp',
      ffmpegPath: '/missing/ffmpeg',
      ffprobePath: '/missing/ffprobe'
    });

    await expect(executor.run(stageInput({
      workdir: '/tmp',
      stageId: 'probe',
      state: {
        sourceUrl: 'https://notyoutube.com/watch?v=demo'
      }
    }))).rejects.toMatchObject({ code: 'unsupported_source' });

    await expect(executor.run(stageInput({
      workdir: '/tmp',
      stageId: 'probe',
      state: {
        sourceUrl: 'file://youtube.com/etc/passwd'
      }
    }))).rejects.toMatchObject({ code: 'unsupported_source' });
  });
});

function parsedProbe(): DownloadProbe {
  return parseDownloadProbe({
    id: 'demo',
    title: 'Creator Download',
    webpage_url: 'https://www.youtube.com/watch?v=demo',
    extractor_key: 'Youtube',
    uploader: 'OpenCreator',
    thumbnail: 'https://i.ytimg.com/vi/demo/hqdefault.jpg',
    duration: 12,
    width: 1920,
    height: 1080,
    formats: [
      {
        format_id: '137',
        ext: 'mp4',
        width: 1920,
        height: 1080,
        fps: 30,
        tbr: 4_500,
        filesize: 100,
        vcodec: 'avc1',
        acodec: 'none'
      },
      {
        format_id: '399',
        ext: 'mp4',
        width: 1920,
        height: 1080,
        fps: 30,
        tbr: 5_000,
        filesize: 120,
        vcodec: 'av01',
        acodec: 'none'
      },
      {
        format_id: '140',
        ext: 'm4a',
        abr: 128,
        filesize: 20,
        vcodec: 'none',
        acodec: 'mp4a'
      },
      {
        format_id: '18',
        ext: 'mp4',
        width: 640,
        height: 360,
        tbr: 500,
        filesize: 30,
        vcodec: 'avc1',
        acodec: 'mp4a'
      }
    ]
  }, 'https://www.youtube.com/watch?v=demo');
}

function xMultiVideoProbe(): DownloadProbe {
  return parseDownloadProbe({
    _type: 'playlist', id: 'post-123', title: 'Two videos', extractor_key: 'Twitter',
    entries: [
      {
        id: 'media-1', title: 'Video 1', extractor_key: 'Twitter',
        formats: [{
          format_id: 'first-video', ext: 'mp4', width: 1280, height: 720,
          vcodec: 'h264', acodec: 'aac'
        }]
      },
      {
        id: 'media-2', title: 'Video 2', extractor_key: 'Twitter',
        formats: [{
          format_id: 'second-video', ext: 'mp4', width: 1920, height: 1080,
          vcodec: 'h264', acodec: 'aac'
        }]
      }
    ]
  }, 'https://x.com/creator/status/123');
}

function multilingualParsedProbe(): DownloadProbe {
  return parseDownloadProbe({
    id: 'multilingual-demo',
    title: 'Multilingual Download',
    webpage_url: 'https://www.youtube.com/watch?v=multilingual-demo',
    extractor_key: 'Youtube',
    duration: 30,
    formats: [
      {
        format_id: 'video-1080',
        ext: 'mp4',
        width: 1920,
        height: 1080,
        fps: 30,
        tbr: 4_500,
        filesize: 100,
        vcodec: 'avc1',
        acodec: 'none'
      },
      {
        format_id: 'audio-en-webm',
        ext: 'webm',
        abr: 96,
        filesize: 15,
        vcodec: 'none',
        acodec: 'opus',
        language: 'en',
        language_preference: 10
      },
      {
        format_id: 'audio-en',
        ext: 'm4a',
        abr: 128,
        filesize: 20,
        vcodec: 'none',
        acodec: 'mp4a',
        language: 'en',
        language_preference: 10
      },
      {
        format_id: 'audio-es',
        ext: 'm4a',
        abr: 128,
        filesize: 20,
        vcodec: 'none',
        acodec: 'mp4a',
        language: 'es',
        language_preference: 5
      }
    ]
  }, 'https://www.youtube.com/watch?v=multilingual-demo');
}

async function fakeBinaries(input?: {
  failure?: string;
  videoCodec?: string;
  portableRuntime?: boolean;
  outputName?: string;
  reportedOutputName?: string;
  splitOutputUtf8?: boolean;
}): Promise<{
  configStore: {
    read(): Promise<ReturnType<typeof createDefaultCreatorServicesConfig>>;
  };
  ytDlpPath: string;
  ytDlpPrefixArgs?: string[];
  ytDlpEnv?: NodeJS.ProcessEnv;
  ffmpegPath: string;
  ffmpegPrefixArgs?: string[];
  ffprobePath: string;
  ffprobePrefixArgs?: string[];
}> {
  tempDir = await mkdtemp(join(tmpdir(), 'creator-download-executor-'));
  const ytDlpScriptPath = join(tempDir, 'yt-dlp.mjs');
  const ffmpegScriptPath = join(tempDir, 'ffmpeg.mjs');
  const ffprobeScriptPath = join(tempDir, 'ffprobe.mjs');
  const failure = input?.failure;
  const videoCodec = input?.videoCodec ?? 'h264';
  await writeExecutable(ytDlpScriptPath, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
writeFileSync(join(process.cwd(), 'args.json'), JSON.stringify(args));
writeFileSync(join(process.cwd(), 'runtime-env.json'), JSON.stringify({
  sslCertificateFile: process.env.SSL_CERT_FILE ?? null
}));
${failure === undefined ? '' : `process.stderr.write(${JSON.stringify(failure)} + '\\n'); process.exit(1);`}
if (args.includes('--dump-single-json')) {
  process.stdout.write(JSON.stringify({
    id: 'demo',
    title: 'Creator Download',
    webpage_url: 'https://www.youtube.com/watch?v=demo',
    extractor_key: 'Youtube',
    formats: [{
      format_id: '18',
      ext: 'mp4',
      width: 640,
      height: 360,
      vcodec: 'avc1',
      acodec: 'mp4a'
    }]
  }));
  process.exit(0);
}
const audio = args.includes('--extract-audio');
const output = join(process.cwd(), ${JSON.stringify(input?.outputName ?? null)} ?? (audio ? 'download.mp3' : 'download.mp4'));
const reportedOutput = join(process.cwd(), ${JSON.stringify(input?.reportedOutputName ?? null)} ?? ${JSON.stringify(input?.outputName ?? null)} ?? (audio ? 'download.mp3' : 'download.mp4'));
writeFileSync(output, audio ? 'download-audio' : 'download-video');
if (args.includes('--progress')) {
  process.stderr.write('[download] 42.0% of 100B\\n');
  if (!audio) {
    process.stderr.write('[download] 100% of 100B\\n');
    process.stderr.write('[download] 10.0% of 20B\\n');
  }
}
process.stderr.write(audio ? '[ExtractAudio] Destination\\n' : '[Merger] Merging formats\\n');
const outputBytes = Buffer.from(reportedOutput + '\\n', 'utf8');
if (${input?.splitOutputUtf8 === true}) {
  const split = outputBytes.indexOf(0xe2) + 1;
  process.stdout.write(outputBytes.subarray(0, split));
  setTimeout(() => process.stdout.write(outputBytes.subarray(split)), 10);
} else {
  process.stdout.write(outputBytes);
}
`);
  await writeExecutable(ffmpegScriptPath, `#!/usr/bin/env node
import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
writeFileSync(join(process.cwd(), 'ffmpeg-args.json'), JSON.stringify(args));
const inputIndex = args.indexOf('-i');
copyFileSync(args[inputIndex + 1], args.at(-1));
process.stderr.write('out_time=00:00:06.000000\\n');
`);
  await writeExecutable(ffprobeScriptPath, `#!/usr/bin/env node
const path = process.argv.at(-1) ?? '';
const audio = path.endsWith('.mp3');
const compatible = path.endsWith('.playable.mp4');
process.stdout.write(JSON.stringify({
  format: { duration: '12' },
  streams: audio
    ? [{ codec_type: 'audio', codec_name: 'mp3' }]
    : [
        {
          codec_type: 'video',
          codec_name: compatible ? 'h264' : ${JSON.stringify(videoCodec)},
          pix_fmt: 'yuv420p',
          width: 1920,
          height: 1080
        },
        { codec_type: 'audio', codec_name: 'aac' }
      ]
}));
`);
  const config = createDefaultCreatorServicesConfig();
  config.proxy = 'http://127.0.0.1:7897';
  return {
    configStore: { read: async () => config },
    ytDlpPath: process.execPath,
    ytDlpPrefixArgs: [
      ytDlpScriptPath,
      ...(input?.portableRuntime ? ['--portable-runtime'] : [])
    ],
    ...(input?.portableRuntime
      ? {
          ytDlpEnv: {
            SSL_CERT_FILE: '/runtime/cacert.pem'
          }
        }
      : {}),
    ffmpegPath: process.execPath,
    ffmpegPrefixArgs: [ffmpegScriptPath],
    ffprobePath: process.execPath,
    ffprobePrefixArgs: [ffprobeScriptPath]
  };
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}

async function writeProbeArtifact(
  workdir: string,
  probe: DownloadProbe
): Promise<CreatorArtifact> {
  const path = join(workdir, 'probe.json');
  await writeFile(path, JSON.stringify(probe));
  return {
    id: 'probe_artifact',
    jobId: 'download_job',
    kind: 'download_probe',
    version: 1,
    status: 'completed',
    path,
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: [],
    metadata: {},
    createdAt: '2026-08-30T00:00:00.000Z'
  };
}

function stageInput(input: {
  workdir: string;
  stageId: 'probe' | 'download' | 'acquire-source';
  state: CreatorJob['state'];
  progress?: CreatorStageRun['progress'];
  inputArtifacts?: CreatorArtifact[];
  reportProgress?: CreatorExecutorInput['reportProgress'];
}): CreatorExecutorInput {
  const createdAt = '2026-08-30T00:00:00.000Z';
  const job: CreatorJob = {
    id: 'download_job',
    projectId: 'project_1',
    templateId: input.stageId === 'acquire-source'
      ? 'stickman-video'
      : 'video-download',
    templateVersion: 2,
    status: 'running',
    revision: 1,
    presetOrigin: null,
    state: input.state,
    agentThreadId: null,
    stages: [],
    artifacts: input.inputArtifacts ?? [],
    providerRequests: [],
    activities: [],
    createdAt,
    updatedAt: createdAt
  };
  const stageRun: CreatorStageRun = {
    id: `stage_${input.stageId}`,
    jobId: job.id,
    stageId: input.stageId,
    executor: 'download',
    status: 'running',
    dispatchStatus: 'claimed',
    claimOwner: 'test',
    claimExpiresAt: null,
    attempt: 1,
    idempotencyKey: null,
    scopeKey: null,
    inputFingerprint: null,
    progress: input.progress ?? {},
    errorCode: null,
    errorMessage: null,
    startedAt: createdAt,
    finishedAt: null
  };
  return {
    stageRun,
    job,
    inputArtifacts: input.inputArtifacts ?? [],
    workdir: input.workdir,
    signal: new AbortController().signal,
    reportProgress: input.reportProgress ?? vi.fn()
  };
}
