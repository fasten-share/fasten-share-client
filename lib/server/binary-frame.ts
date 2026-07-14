const MAGIC_0 = 0x4d; // M
const MAGIC_1 = 0x43; // C
import { WIRE_VERSION } from './protocol-version';
const HEADER_BYTES = 20;
const UUID_HEX = /^[0-9a-f]{32}$/i;

export const BinaryFrameType = {
  RequestChunk: 1,
  ResponseChunk: 2,
} as const;

export type BinaryFrameType = (typeof BinaryFrameType)[keyof typeof BinaryFrameType];

export interface BinaryFrame {
  type: BinaryFrameType;
  requestId: string;
  payload: Buffer;
}

export function encodeBinaryFrame(type: BinaryFrameType, requestId: string, payload: Uint8Array): Buffer {
  const hex = requestId.replaceAll('-', '');
  if (!UUID_HEX.test(hex)) throw new Error('invalid binary frame requestId');
  const frame = Buffer.allocUnsafe(HEADER_BYTES + payload.byteLength);
  frame[0] = MAGIC_0;
  frame[1] = MAGIC_1;
  frame[2] = WIRE_VERSION;
  frame[3] = type;
  Buffer.from(hex, 'hex').copy(frame, 4);
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(frame, HEADER_BYTES);
  return frame;
}

export function decodeBinaryFrame(raw: Buffer): BinaryFrame | undefined {
  if (
    raw.length <= HEADER_BYTES || raw[0] !== MAGIC_0 || raw[1] !== MAGIC_1 ||
    raw[2] !== WIRE_VERSION ||
    (raw[3] !== BinaryFrameType.RequestChunk && raw[3] !== BinaryFrameType.ResponseChunk)
  ) return undefined;
  const hex = raw.subarray(4, HEADER_BYTES).toString('hex');
  return {
    type: raw[3] as BinaryFrameType,
    requestId: [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-'),
    payload: raw.subarray(HEADER_BYTES),
  };
}
