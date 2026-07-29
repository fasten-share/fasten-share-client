/* eslint-disable @typescript-eslint/no-explicit-any */

export type JsonRecord = Record<string, unknown>;
export type LooseObject = Record<string, any>;
export type ToolType = 'function' | 'custom' | 'local_shell';

export interface ToolMetadata {
  type: ToolType;
  name: string;
}

export interface AdapterContext {
  model: string;
  stream: boolean;
  tools: Map<string, ToolMetadata>;
}

export type AdapterErrorCode =
  | 'RESPONSES_ADAPTER_INVALID_REQUEST'
  | 'RESPONSES_ADAPTER_UNSUPPORTED_FEATURE'
  | 'RESPONSES_ADAPTER_UPSTREAM_PROTOCOL';

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly status: number;

  constructor(
    message: string,
    code: AdapterErrorCode = 'RESPONSES_ADAPTER_INVALID_REQUEST',
    status = 400,
  ) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    this.status = status;
  }
}

export function record(value: unknown, message = 'Expected a JSON object.'): LooseObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdapterError(message);
  return value;
}

export function unsupported(message: string): never {
  throw new AdapterError(message, 'RESPONSES_ADAPTER_UNSUPPORTED_FEATURE', 400);
}
