import path from 'node:path';
import process from 'node:process';
import {
  compileCreatorPresets,
  validateCreatorPresets
} from '../src/creator/presets/compiler.js';

const command = process.argv[2];
const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const sourceRoot = path.resolve(
  process.env.OPENCREATOR_PRESET_SOURCE_ROOT ?? path.join(repositoryRoot, 'template')
);
const outputRoot = path.resolve(
  process.env.OPENCREATOR_PRESET_CATALOG_ROOT
    ?? path.join(repositoryRoot, '.runtime/generated/creator-presets')
);

try {
  if (command === 'validate') {
    const catalog = await validateCreatorPresets({ sourceRoot });
    process.stdout.write(`Validated ${catalog.presets.length} creator presets.\n`);
  } else if (command === 'compile') {
    const manifest = await compileCreatorPresets({ sourceRoot, outputRoot });
    process.stdout.write(
      `Compiled creator presets: catalog=${manifest.catalogHash} assets=${manifest.assetSetHash}\n`
    );
  } else {
    process.stderr.write('Usage: creator-presets.ts <validate|compile>\n');
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
