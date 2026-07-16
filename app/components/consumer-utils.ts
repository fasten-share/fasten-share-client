import type { ToolId } from '@/lib/tool-support';
import { toolEndpoint } from '@/lib/tool-endpoint';

export interface ConsumerNodeRow {
  peerId: string;
  rttToServer: number;
  onlineMs: number;
  userId: string;
  username: string | null;
  followerCount: number;
  callCount: number;
  costMultiplier: number;
  following: boolean;
  rating: number;
  rated: boolean;
  myRating: number | null;
  supportedTools: ToolId[];
  versionPrefix: string;
}

export interface ConsumerRow { model: string; protocol: string; nodes: ConsumerNodeRow[] }
export interface CurlTarget { model: string; protocol: string; peerId: string; versionPrefix: string }
export type SearchScope = 'all' | 'following';
export const PAGE_SIZE = 20;

function b64url(value: string): string {
  const binary = String.fromCharCode(...new TextEncoder().encode(value));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function buildCurl(origin: string, target: CurlTarget, apiKey: string): string {
  const prefix = target.versionPrefix === '/' ? '' : target.versionPrefix;
  const base = `${origin}/${target.protocol}/${b64url(target.model)}/${target.peerId}${prefix}`;
  const auth = `  -H 'Authorization: Bearer ${apiKey}' \\\n`;
  const contentType = `  -H 'content-type: application/json' \\\n`;
  const data = (value: unknown) => `  -d '${JSON.stringify(value)}'`;
  if (target.protocol === 'anthropic') return `curl ${base}/messages \\\n${auth}${contentType}  -H 'anthropic-version: 2023-06-01' \\\n${data({ model: target.model, max_tokens: 1024, messages: [{ role: 'user', content: 'what is your model you are?' }] })}`;
  if (target.protocol === 'openai-response') return `curl ${base}/responses \\\n${auth}${contentType}${data({ model: target.model, input: 'what is your model you are?' })}`;
  if (target.protocol === 'gemini') return `curl ${base}/models/${target.model}:generateContent \\\n${auth}${contentType}${data({ contents: [{ parts: [{ text: 'what is your model you are?' }] }] })}`;
  if (target.protocol === 'azure-openai') return `curl '${base}/deployments/${target.model}/chat/completions?api-version=2024-10-21' \\\n${auth}${contentType}${data({ messages: [{ role: 'user', content: 'what is your model you are?' }] })}`;
  return `curl ${base}/chat/completions \\\n${auth}${contentType}${data({ model: target.model, messages: [{ role: 'user', content: 'what is your model you are?' }] })}`;
}

export function buildToolEndpoint(origin: string, target: CurlTarget, tool: Exclude<ToolId, 'curl'>): string {
  const routeBase = `${origin}/${target.protocol}/${b64url(target.model)}/${target.peerId}`;
  return toolEndpoint(routeBase, target.versionPrefix, tool, target.protocol);
}

export function rowKey(row: Pick<ConsumerRow, 'protocol' | 'model'>): string { return `${row.protocol} ${row.model}`; }
export function targetKey(target: CurlTarget): string { return `${target.protocol}\0${target.model}\0${target.peerId}`; }
export function formatMultiplier(value: number): string { return `${value.toFixed(6).replace(/\.?0+$/, '')}x`; }
