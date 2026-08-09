import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prepareEnterpriseDevelopmentConfig
} from '../src/enterprise/development-config-2026-08-09.js';

const daemonDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

prepareEnterpriseDevelopmentConfig({
  templatePath: resolve(daemonDir, '../../config/config.toml'),
  userPath: resolve(daemonDir, '.runtime/config.toml')
});
