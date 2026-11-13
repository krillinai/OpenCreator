export function creatorRuntimeReleases() {
  return {
    'darwin-arm64': creatorRuntimeRelease({
      mediaTarget: 'darwin-arm64',
      nodeSha256: '61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6',
      ffmpegSha256: 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
      ffprobeSha256: 'bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64',
      pythonAsset: 'cpython-3.13.15+20260825-aarch64-apple-darwin-install_only_stripped.tar.gz',
      pythonSha256: '149038dd0c194c25d4616d7e42a35f67f2edee96412788f74115819b6a4c8548'
    }),
    'darwin-x64': creatorRuntimeRelease({
      mediaTarget: 'darwin-x64',
      nodeSha256: '58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026',
      mediaVersion: '6.1.1',
      ffmpegSha256: 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894',
      ffprobeSha256: 'fa3add0ce901f7241abe0dfc0155d958fc834aca3f8ce61f87cc712ae669c1e0',
      pythonAsset: 'cpython-3.13.15+20260825-x86_64-apple-darwin-install_only_stripped.tar.gz',
      pythonSha256: 'd33d61f7f4982c94216e14a43599c75657b7d0839277fc72bc6dbac53e8229bc'
    }),
    'linux-arm64': creatorRuntimeRelease({
      mediaTarget: 'linux-arm64',
      nodeSha256: '013b59cfd2819703a6f4a14ab891fc46fc2a4e3f5bcd92de3fb4929b43e35b30',
      mediaVersion: '7.0.2',
      ffmpegSha256: '6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce',
      ffprobeSha256: 'd17ae9b4c297d48e2521ba14e417bb0537c6ff77c584cdbcd6bb0d8d0307a2e8',
      pythonAsset: 'cpython-3.13.15+20260825-aarch64-unknown-linux-gnu-install_only_stripped.tar.gz',
      pythonSha256: 'e5d0df1a6070a8614d808496e5ea28c727480e40ffcce1a94697a067f1690aa8'
    }),
    'linux-x64': creatorRuntimeRelease({
      mediaTarget: 'linux-x64',
      nodeSha256: 'b294a556e639d64338823920e5866c21c02741742d2e1529ee1a225c1ec9252a',
      mediaVersion: '7.0.2',
      ffmpegSha256: 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99',
      ffprobeSha256: '4f231a1960d83e403d08f7971e271707bec278a9ae18e21b8b5b03186668450d',
      pythonAsset: 'cpython-3.13.15+20260825-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz',
      pythonSha256: '8af9a8214c71b2dd698005e39fab87aad02a994330508857da4e6d1ba7e6ddb6'
    }),
    'win32-x64': creatorRuntimeRelease({
      mediaTarget: 'win32-x64',
      nodeSha256: '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97',
      mediaVersion: '6.1.1',
      ffmpegSha256: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
      ffprobeSha256: '3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4',
      pythonAsset: 'cpython-3.13.15+20260825-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
      pythonSha256: 'c1dc1e267f2a81493ce6e94837263f648f1eb6d0df73a1492469c1fed025ce8f',
      executableSuffix: '.exe'
    })
  };
}

function creatorRuntimeRelease(input) {
  const suffix = input.executableSuffix ?? '';
  const mediaVersion = input.mediaVersion ?? '6.0';
  const pythonRelease = '20260825';
  const pythonVersion = '3.13.15';
  const nodeVersion = '22.23.2';
  const nodeTarget = input.mediaTarget.replace('win32-', 'win-');
  const nodeExtension = suffix === '.exe' ? 'zip' : 'tar.gz';
  const encodedPythonAsset = input.pythonAsset.replace('+', '%2B');
  return {
    ffmpeg: {
      version: mediaVersion,
      fileName: `ffmpeg${suffix}`,
      url: `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-${input.mediaTarget}`,
      sha256: input.ffmpegSha256,
      executable: true,
      verify: ['-version'],
      expected: mediaVersionPattern('ffmpeg', mediaVersion)
    },
    ffprobe: {
      version: mediaVersion,
      fileName: `ffprobe${suffix}`,
      url: `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-${input.mediaTarget}`,
      sha256: input.ffprobeSha256,
      executable: true,
      verify: ['-version'],
      expected: mediaVersionPattern('ffprobe', mediaVersion)
    },
    pythonRuntime: {
      version: pythonVersion,
      fileName: 'python-runtime.tar.gz',
      url: `https://github.com/astral-sh/python-build-standalone/releases/download/${pythonRelease}/${encodedPythonAsset}`,
      sha256: input.pythonSha256
    },
    nodeRuntime: {
      version: nodeVersion,
      fileName: `node-runtime.${nodeExtension}`,
      url: `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-${nodeTarget}.${nodeExtension}`,
      sha256: input.nodeSha256
    },
    certificateBundle: {
      version: '2026.07.22',
      fileName: 'cacert.pem',
      url: 'https://raw.githubusercontent.com/certifi/python-certifi/2026.07.22/certifi/cacert.pem',
      sha256: '9cc2a774b5198dcff14d9be1e66091f538975d867ce029a96bce15a55dfd730f'
    }
  };
}

const ytDlpRepository = 'yt-dlp/yt-dlp-nightly-builds';

export function resolveYtDlpRelease({ readText, offline = false, cached }) {
  if (offline) {
    const asset = ytDlpAsset(cached?.version, cached?.sha256);
    if (cached?.path !== asset.fileName || cached?.source !== asset.url) {
      throw new Error('The offline yt-dlp cache has no valid release metadata');
    }
    return asset;
  }

  const release = JSON.parse(readText(
    `https://api.github.com/repos/${ytDlpRepository}/releases/latest`
  ));
  if (release.draft !== false || release.prerelease !== false) {
    throw new Error('The latest yt-dlp release is not a published nightly build');
  }
  const url = ytDlpDownloadUrl(release.tag_name);
  const download = release.assets?.find(candidate => candidate.name === 'yt-dlp');
  if (download?.browser_download_url !== url) {
    throw new Error('The latest yt-dlp release is missing its official download');
  }
  let sha256;
  if (download.digest != null) {
    sha256 = /^sha256:([a-f0-9]{64})$/i.exec(download.digest)?.[1];
  } else {
    const checksums = readText(url.replace(/\/yt-dlp$/, '/SHA2-256SUMS'));
    sha256 = /^([a-f0-9]{64})\s+\*?yt-dlp\r?$/im.exec(checksums)?.[1];
  }
  return ytDlpAsset(release.tag_name, sha256);
}

function ytDlpAsset(version, sha256) {
  const url = ytDlpDownloadUrl(version);
  if (!/^[a-f0-9]{64}$/i.test(sha256 ?? '')) {
    throw new Error('The yt-dlp release SHA-256 is missing or invalid');
  }
  return {
    version,
    fileName: 'yt-dlp',
    url,
    sha256: sha256.toLowerCase()
  };
}

function ytDlpDownloadUrl(version) {
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d{6}$/.test(version ?? '')) {
    throw new Error('The yt-dlp release version is missing or invalid');
  }
  return `https://github.com/${ytDlpRepository}/releases/download/${version}/yt-dlp`;
}

function mediaVersionPattern(tool, version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${tool} version ${escapedVersion}(?:[\\s-]|$)`, 'm');
}
