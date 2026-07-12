import { describe, expect, it } from 'vitest';
import { createProductionServerInput } from '../../src/startup.js';

describe('daemon production startup', () => {
  it('enables scheduler autostart for the production server', () => {
    const input = createProductionServerInput({
      token: 'runtime-token'
    });

    expect(input).toMatchObject({
      token: 'runtime-token',
      schedulerAutostart: true
    });
  });
});
