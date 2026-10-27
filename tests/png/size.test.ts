import { describe, expect, it } from 'vitest';
import { readPngSize } from '../../src/png.js';

describe('readPngSize', () => {
  it('reads IHDR width and height', () => {
    const bytes = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
    bytes.writeUInt32BE(1280, 16);
    bytes.writeUInt32BE(720, 20);
    expect(readPngSize(bytes)).toEqual({ width: 1280, height: 720 });
  });

  it('rejects a non-png', () => {
    expect(() => readPngSize(Buffer.from('not a png'))).toThrow(/PNG/);
  });
});
