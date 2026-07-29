import { randomUUID } from 'node:crypto';
import {
  AdapterError,
  type AdapterContext,
  type JsonRecord,
  type LooseObject,
  type ToolMetadata,
  record,
} from './openai-responses-adapter-types';

export function responseBase(
  context: AdapterContext,
  id = `resp_${randomUUID().replace(/-/g, '')}`,
): LooseObject {
  return {
    id,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'in_progress',
    model: context.model,
    output: [],
    parallel_tool_calls: true,
    tool_choice: 'auto',
  };
}

export function usage(value: unknown): LooseObject | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const valueObject = value as LooseObject;
  const inputTokens = Number(valueObject.prompt_tokens ?? valueObject.input_tokens ?? 0);
  const outputTokens = Number(valueObject.completion_tokens ?? valueObject.output_tokens ?? 0);
  return {
    input_tokens: inputTokens,
    input_tokens_details: {
      cached_tokens: Number(valueObject.prompt_tokens_details?.cached_tokens ?? valueObject.input_tokens_details?.cached_tokens ?? 0),
    },
    output_tokens: outputTokens,
    output_tokens_details: {
      reasoning_tokens: Number(valueObject.completion_tokens_details?.reasoning_tokens ?? valueObject.output_tokens_details?.reasoning_tokens ?? 0),
    },
    total_tokens: Number(valueObject.total_tokens ?? inputTokens + outputTokens),
  };
}

export function parseWrappedArguments(
  text: string,
  metadata?: ToolMetadata,
): { arguments?: string; input?: string } {
  if (metadata?.type !== 'custom') return { arguments: text };
  try {
    const parsed = JSON.parse(text);
    return { input: String(parsed?.input ?? '') };
  } catch {
    return { input: text };
  }
}

export function parsedCustomInput(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed?.input === 'string' ? parsed.input : String(parsed?.input ?? '');
  } catch {
    return undefined;
  }
}

function outputTool(call: LooseObject, context: AdapterContext, index: number): LooseObject {
  const fn = call.function ?? {};
  const metadata = context.tools.get(String(fn.name ?? ''));
  const id = String(call.id ?? `call_${randomUUID().replace(/-/g, '')}`);
  const args = String(fn.arguments ?? '');
  if (metadata?.type === 'custom') {
    return {
      id: `ct_${randomUUID().replace(/-/g, '')}`,
      type: 'custom_tool_call',
      call_id: id,
      name: metadata.name,
      input: parseWrappedArguments(args, metadata).input,
      status: 'completed',
      index,
    };
  }
  if (metadata?.type === 'local_shell') {
    let action: LooseObject = {};
    try { action = JSON.parse(args); } catch { action = { command: args }; }
    return {
      id: `ls_${randomUUID().replace(/-/g, '')}`,
      type: 'local_shell_call',
      call_id: id,
      action,
      status: 'completed',
      index,
    };
  }
  return {
    id: `fc_${randomUUID().replace(/-/g, '')}`,
    type: 'function_call',
    call_id: id,
    name: metadata?.name ?? String(fn.name ?? ''),
    arguments: args,
    status: 'completed',
    index,
  };
}

export function convertChatResponse(value: unknown, context: AdapterContext): JsonRecord {
  const chat = record(value, 'Chat Completions response must be a JSON object.');
  const choice = Array.isArray(chat.choices) ? chat.choices[0] : undefined;
  if (!choice) throw new AdapterError('Chat Completions response has no choice.', 'RESPONSES_ADAPTER_UPSTREAM_PROTOCOL', 502);
  const message = record(choice.message ?? {}, 'Chat Completions response has no message.');
  const response: LooseObject = responseBase(
    context,
    chat.id ? `resp_${String(chat.id).replace(/^chatcmpl-/, '')}` : undefined,
  );
  response.created_at = Number(chat.created ?? response.created_at);
  const reasoningText = String(message.reasoning_content ?? message.reasoning ?? '');
  if (reasoningText) {
    response.output.push({
      id: `rs_${randomUUID().replace(/-/g, '')}`,
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: reasoningText }],
      status: 'completed',
    });
  }
  const text = typeof message.content === 'string'
    ? message.content
    : Array.isArray(message.content)
      ? message.content.map((part) => part?.text ?? '').join('')
      : '';
  if (text || message.refusal) {
    response.output.push({
      id: `msg_${randomUUID().replace(/-/g, '')}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: message.refusal
        ? [{ type: 'refusal', refusal: String(message.refusal) }]
        : [{ type: 'output_text', text, annotations: [], logprobs: [] }],
    });
  }
  for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    response.output.push(outputTool(call, context, response.output.length));
  }
  response.status = choice.finish_reason === 'length' ? 'incomplete' : 'completed';
  if (response.status === 'incomplete') response.incomplete_details = { reason: 'max_output_tokens' };
  response.usage = usage(chat.usage);
  return response;
}
