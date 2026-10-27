import { AgentBrowserError } from './types.js';
import type { ViewportSize } from './types.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG IHDR. Screenshot responses use this so agents can map pixels. */
export function readPngSize(bytes: Buffer): ViewportSize {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new AgentBrowserError('screenshot was not a PNG');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
