import { createHash, randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type JsonRecord = Record<string, unknown>;
type LooseObject = Record<string, any>;
type ToolType = 'function' | 'custom' | 'local_shell';

interface ToolMetadata {
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

function record(value: unknown, message = 'Expected a JSON object.'): LooseObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdapterError(message);
  return value;
}

function unsupported(message: string): never {
  throw new AdapterError(message, 'RESPONSES_ADAPTER_UNSUPPORTED_FEATURE', 400);
}

function wrapperName(type: ToolType, name: string, used: Set<string>): string {
  if (type === 'function' && /^[A-Za-z0-9_-]{1,64}$/.test(name) && !used.has(name)) {
    used.add(name);
    return name;
  }
  const stem = String(name || type).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 42) || 'tool';
  const hash = createHash('sha256').update(`${type}\0${name}`).digest('hex').slice(0, 10);
  let candidate = `fsr_${stem}_${hash}`.slice(0, 64);
  let suffix = 1;
  while (used.has(candidate)) candidate = `${candidate.slice(0, 60)}_${suffix++}`;
  used.add(candidate);
  return candidate;
}

function contentParts(value: unknown): string | LooseObject[] {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  const parts: LooseObject[] = [];
  for (const raw of value) {
    if (typeof raw === 'string') {
      parts.push({ type: 'text', text: raw });
      continue;
    }
    const part = record(raw, 'Invalid Responses content item.');
    if (part.type === 'input_text' || part.type === 'output_text') {
      parts.push({ type: 'text', text: String(part.text ?? '') });
    } else if (part.type === 'input_image') {
      if (part.file_id) unsupported('input_image file_id cannot be represented by Chat Completions.');
      const imageUrl = part.image_url;
      if (!imageUrl) throw new AdapterError('input_image requires image_url.');
      parts.push({ type: 'image_url', image_url: { url: String(imageUrl), ...(part.detail ? { detail: part.detail } : {}) } });
    } else if (part.type === 'input_audio') {
      const audio = record(part.input_audio ?? part, 'Invalid input_audio item.');
      parts.push({
        type: 'input_audio',
        input_audio: { data: String(audio.data ?? ''), format: String(audio.format ?? '') },
      });
    } else if (part.type === 'refusal') {
      parts.push({ type: 'text', text: String(part.refusal ?? '') });
    } else {
      unsupported(`Responses content type '${String(part.type)}' cannot be represented by Chat Completions.`);
    }
  }
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
  return parts;
}

function toolOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      const part = record(item, 'Invalid tool output.');
      return String(part.text ?? part.output_text ?? JSON.stringify(part));
    }).join('\n');
  }
  return JSON.stringify(value ?? '');
}

function convertInput(input: unknown, toolsByWrapper: Map<string, ToolMetadata>): LooseObject[] {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  if (!Array.isArray(input)) throw new AdapterError('Responses input must be a string or an array.');
  const messages: LooseObject[] = [];
  for (const raw of input) {
    const item = record(raw, 'Invalid Responses input item.');
    const type = String(item.type ?? 'message');
    if (type === 'message') {
      const role = String(item.role ?? 'user');
      if (!['system', 'developer', 'user', 'assistant'].includes(role)) {
        throw new AdapterError(`Unsupported message role '${role}'.`);
      }
      messages.push({ role: role === 'developer' ? 'system' : role, content: contentParts(item.content) });
    } else if (type === 'function_call' || type === 'custom_tool_call' || type === 'local_shell_call') {
      let name = String(item.name ?? (type === 'local_shell_call' ? 'local_shell' : 'tool'));
      const sourceToolType = type === 'custom_tool_call' ? 'custom' : type.replace('_call', '');
      const match = [...toolsByWrapper].find(([, metadata]) => metadata.type === sourceToolType && metadata.name === name);
      if (match) name = match[0];
      const argumentsValue = type === 'custom_tool_call'
        ? JSON.stringify({ input: String(item.input ?? '') })
        : typeof item.arguments === 'string'
          ? item.arguments
          : JSON.stringify(item.action ?? item.arguments ?? {});
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: String(item.call_id ?? item.id ?? `call_${randomUUID().replace(/-/g, '')}`),
          type: 'function',
          function: { name, arguments: argumentsValue },
        }],
      });
    } else if (type === 'function_call_output' || type === 'custom_tool_call_output' || type === 'local_shell_call_output') {
      messages.push({
        role: 'tool',
        tool_call_id: String(item.call_id ?? ''),
        content: toolOutput(item.output),
      });
    } else if (type === 'reasoning') {
      // Chat Completions has no encrypted reasoning-history item. The surrounding
      // user/assistant/tool items already carry the model-visible conversation.
      continue;
    } else {
      unsupported(`Responses input item '${type}' cannot be represented by Chat Completions.`);
    }
  }
  return messages;
}

function convertTools(value: unknown): {
  tools?: LooseObject[];
  mapping: Map<string, ToolMetadata>;
} {
  if (value == null) return { tools: undefined, mapping: new Map<string, ToolMetadata>() };
  if (!Array.isArray(value)) throw new AdapterError('tools must be an array.');
  const mapping = new Map<string, ToolMetadata>();
  const used = new Set<string>();
  const tools: LooseObject[] = [];
  const appendTool = (raw: unknown, namespaceDescription?: string) => {
    const tool = record(raw, 'Invalid tool definition.');
    const type = String(tool.type ?? '');
    if (type === 'namespace') {
      if (!Array.isArray(tool.tools)) throw new AdapterError('namespace tools must be an array.');
      const description = [namespaceDescription, tool.description].filter(Boolean).join('\n\n');
      for (const child of tool.tools) appendTool(child, description);
      return;
    }
    if (['web_search', 'web_search_preview', 'file_search', 'computer_use_preview', 'computer_use',
      'code_interpreter', 'image_generation', 'mcp', 'tool_search', 'programmatic_tool_calling'].includes(type)) {
      unsupported(`Hosted Responses tool '${type}' is not available through a Chat Completions backend.`);
    }
    if (!['function', 'custom', 'local_shell'].includes(type)) {
      unsupported(`Responses tool '${type}' cannot be represented by Chat Completions.`);
    }
    const name = String(tool.name ?? (type === 'local_shell' ? 'local_shell' : 'tool'));
    const toolType = type as ToolType;
    const wrapper = wrapperName(toolType, name, used);
    mapping.set(wrapper, { type: toolType, name });
    let parameters: LooseObject;
    if (type === 'function') {
      parameters = tool.parameters && typeof tool.parameters === 'object'
        ? tool.parameters
        : { type: 'object', properties: {}, additionalProperties: true };
    } else if (type === 'custom') {
      parameters = {
        type: 'object',
        properties: { input: { type: 'string', description: String(tool.description ?? 'Free-form tool input.') } },
        required: ['input'],
        additionalProperties: false,
      };
    } else {
      parameters = {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeout_ms: { type: 'number' },
          working_directory: { type: 'string' },
        },
        required: ['command'],
        additionalProperties: true,
      };
    }
    tools.push({
      type: 'function',
      function: {
        name: wrapper,
        description: [namespaceDescription, tool.description ?? `${type} tool ${name}`]
          .filter(Boolean).join('\n\n'),
        parameters,
        ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
      },
    });
  };
  for (const raw of value) appendTool(raw);
  return { tools, mapping };
}

function mapToolChoice(
  value: unknown,
  mapping: Map<string, ToolMetadata>,
): string | LooseObject | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  const choice = record(value, 'Invalid tool_choice.');
  const type = String(choice.type ?? '');
  if (type === 'function' || type === 'custom') {
    const name = String(choice.name ?? '');
    const found = [...mapping].find(([, metadata]) => metadata.type === type && metadata.name === name);
    if (!found) throw new AdapterError(`tool_choice references unknown tool '${name}'.`);
    return { type: 'function', function: { name: found[0] } };
  }
  unsupported(`tool_choice type '${type}' cannot be represented by Chat Completions.`);
}

function mapText(value: unknown): LooseObject | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const text = value as LooseObject;
  const format = text.format;
  if (!format || typeof format !== 'object') return undefined;
  const formatObject = format as LooseObject;
  if (formatObject.type === 'text') return { type: 'text' };
  if (formatObject.type === 'json_object') return { type: 'json_object' };
  if (formatObject.type === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name: String(formatObject.name ?? 'response'),
        schema: formatObject.schema ?? {},
        ...(typeof formatObject.strict === 'boolean' ? { strict: formatObject.strict } : {}),
      },
    };
  }
  unsupported(`text.format '${String(formatObject.type)}' cannot be represented by Chat Completions.`);
}

export function convertResponsesRequest(
  value: unknown,
  selectedModel: string,
): { body: JsonRecord; context: AdapterContext } {
  const input = record(value, 'Responses request must be a JSON object.');
  if (input.store === true) unsupported('store:true is not supported by the stateless Responses adapter.');
  if (input.previous_response_id != null) unsupported('previous_response_id is not supported by the stateless Responses adapter.');
  for (const field of ['conversation', 'background']) {
    if (input[field] != null && input[field] !== false) unsupported(`${field} is not supported by the Responses adapter.`);
  }
  const convertedTools = convertTools(input.tools);
  const messages = convertInput(input.input ?? '', convertedTools.mapping);
  if (typeof input.instructions === 'string' && input.instructions) {
    messages.unshift({ role: 'system', content: input.instructions });
  }
  const body: LooseObject = {
    model: selectedModel,
    messages,
    stream: input.stream === true,
  };
  if (convertedTools.tools?.length) body.tools = convertedTools.tools;
  const toolChoice = mapToolChoice(input.tool_choice, convertedTools.mapping);
  if (toolChoice != null) body.tool_choice = toolChoice;
  const responseFormat = mapText(input.text);
  if (responseFormat) body.response_format = responseFormat;
  const direct = ['temperature', 'top_p', 'service_tier', 'prompt_cache_key', 'safety_identifier',
    'user', 'seed', 'frequency_penalty', 'presence_penalty', 'stop', 'logprobs', 'top_logprobs'];
  for (const field of direct) if (input[field] != null) body[field] = input[field];
  if (input.parallel_tool_calls != null) body.parallel_tool_calls = input.parallel_tool_calls;
  if (input.max_output_tokens != null) body.max_completion_tokens = input.max_output_tokens;
  if (input.reasoning && typeof input.reasoning === 'object' && input.reasoning.effort != null) {
    body.reasoning_effort = input.reasoning.effort;
  }
  if (input.text && typeof input.text === 'object' && input.text.verbosity != null) {
    body.verbosity = input.text.verbosity;
  }
  if (body.stream) body.stream_options = { include_usage: true };
  return {
    body,
    context: { model: selectedModel, stream: body.stream, tools: convertedTools.mapping },
  };
}

function responseBase(
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

function usage(value: unknown): LooseObject | undefined {
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

function parseWrappedArguments(
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

function parsedCustomInput(text: string): string | undefined {
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

function sse(type: string, payload: LooseObject, sequence: number): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence, ...payload })}\n\n`;
}

interface StreamTextState {
  item: LooseObject;
  text: string;
  outputIndex: number;
}

interface StreamToolState {
  item: LooseObject;
  args: string;
  metadata?: ToolMetadata;
  outputIndex: number;
  customInput: string;
}

export class ChatSseToResponses {
  private readonly context: AdapterContext;
  private readonly decoder: TextDecoder;
  private buffer: string;
  private sequence: number;
  private readonly response: LooseObject;
  private started: boolean;
  private done: boolean;
  private message: StreamTextState | null;
  private reasoning: StreamTextState | null;
  private readonly tools: Map<number, StreamToolState>;
  private finishReason: string | null;

  constructor(context: AdapterContext) {
    this.context = context;
    this.decoder = new TextDecoder();
    this.buffer = '';
    this.sequence = 0;
    this.response = responseBase(context);
    this.started = false;
    this.done = false;
    this.message = null;
    this.reasoning = null;
    this.tools = new Map<number, StreamToolState>();
    this.finishReason = null;
  }

  private event(type: string, payload: LooseObject): string {
    return sse(type, payload, this.sequence++);
  }

  private start(): string[] {
    if (this.started) return [];
    this.started = true;
    return [
      this.event('response.created', { response: { ...this.response } }),
      this.event('response.in_progress', { response: { ...this.response } }),
    ];
  }

  private ensureMessage(): string[] {
    if (this.message) return [];
    const item = {
      id: `msg_${randomUUID().replace(/-/g, '')}`,
      type: 'message',
      role: 'assistant',
      status: 'in_progress',
      content: [],
    };
    const state = { item, text: '', outputIndex: this.response.output.length, partAdded: false };
    this.message = state;
    this.response.output.push(item);
    return [
      this.event('response.output_item.added', { output_index: state.outputIndex, item: { ...item } }),
      this.event('response.content_part.added', {
        item_id: item.id,
        output_index: state.outputIndex,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [], logprobs: [] },
      }),
    ];
  }

  private ensureReasoning(): string[] {
    if (this.reasoning) return [];
    const item = {
      id: `rs_${randomUUID().replace(/-/g, '')}`,
      type: 'reasoning',
      summary: [],
      status: 'in_progress',
    };
    const state = { item, text: '', outputIndex: this.response.output.length };
    this.reasoning = state;
    this.response.output.push(item);
    return [
      this.event('response.output_item.added', { output_index: state.outputIndex, item: { ...item } }),
      this.event('response.reasoning_summary_part.added', {
        item_id: item.id,
        output_index: state.outputIndex,
        summary_index: 0,
        part: { type: 'summary_text', text: '' },
      }),
    ];
  }

  private ensureTool(index: number, raw: LooseObject): string[] {
    if (this.tools.has(index)) return [];
    const fn = raw.function ?? {};
    const metadata = this.context.tools.get(String(fn.name ?? ''));
    const item = metadata?.type === 'custom'
      ? { id: `ct_${randomUUID().replace(/-/g, '')}`, type: 'custom_tool_call', call_id: String(raw.id ?? ''), name: metadata.name, input: '', status: 'in_progress' }
      : metadata?.type === 'local_shell'
        ? { id: `ls_${randomUUID().replace(/-/g, '')}`, type: 'local_shell_call', call_id: String(raw.id ?? ''), action: {}, status: 'in_progress' }
        : { id: `fc_${randomUUID().replace(/-/g, '')}`, type: 'function_call', call_id: String(raw.id ?? ''), name: metadata?.name ?? String(fn.name ?? ''), arguments: '', status: 'in_progress' };
    const state = { item, args: '', metadata, outputIndex: this.response.output.length, customInput: '' };
    this.tools.set(index, state);
    this.response.output.push(item);
    return [this.event('response.output_item.added', { output_index: state.outputIndex, item: { ...item } })];
  }

  private handle(json: LooseObject): string[] {
    if (json.id && this.response.id.startsWith('resp_')) this.response.id = `resp_${String(json.id).replace(/^chatcmpl-/, '')}`;
    if (json.model) this.response.model = json.model;
    if (json.created) this.response.created_at = Number(json.created);
    if (json.usage) this.response.usage = usage(json.usage);
    const output = this.start();
    for (const choice of Array.isArray(json.choices) ? json.choices : []) {
      const delta = choice.delta ?? {};
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === 'string' && reasoning) {
        output.push(...this.ensureReasoning());
        const reasoningState = this.reasoning!;
        reasoningState.text += reasoning;
        output.push(this.event('response.reasoning_summary_text.delta', {
          item_id: reasoningState.item.id,
          output_index: reasoningState.outputIndex,
          summary_index: 0,
          delta: reasoning,
        }));
      }
      if (typeof delta.content === 'string' && delta.content) {
        output.push(...this.ensureMessage());
        const messageState = this.message!;
        messageState.text += delta.content;
        output.push(this.event('response.output_text.delta', {
          item_id: messageState.item.id,
          output_index: messageState.outputIndex,
          content_index: 0,
          delta: delta.content,
          logprobs: delta.logprobs ?? [],
        }));
      }
      for (const raw of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        const index = Number(raw.index ?? 0);
        output.push(...this.ensureTool(index, raw));
        const state = this.tools.get(index)!;
        if (raw.id) {
          state.item.call_id = String(raw.id);
        }
        if (raw.function?.name) {
          const metadata = this.context.tools.get(String(raw.function.name));
          state.metadata = metadata;
          if (state.item.type === 'function_call') state.item.name = metadata?.name ?? String(raw.function.name);
        }
        const piece = String(raw.function?.arguments ?? '');
        if (piece) {
          state.args += piece;
          let eventDelta = piece;
          if (state.item.type === 'custom_tool_call') {
            const parsed = parsedCustomInput(state.args);
            if (parsed == null) continue;
            eventDelta = parsed.slice(state.customInput.length);
            state.customInput = parsed;
            if (!eventDelta) continue;
          }
          const eventType = state.item.type === 'function_call'
            ? 'response.function_call_arguments.delta'
            : state.item.type === 'custom_tool_call'
              ? 'response.custom_tool_call_input.delta'
              : 'response.local_shell_call_arguments.delta';
          output.push(this.event(eventType, {
            item_id: state.item.id,
            output_index: state.outputIndex,
            delta: eventDelta,
          }));
        }
      }
      if (choice.finish_reason) this.finishReason = choice.finish_reason;
    }
    return output;
  }

  private complete(): string[] {
    if (this.done) return [];
    this.done = true;
    const output: string[] = [];
    if (this.reasoning) {
      const state = this.reasoning;
      state.item.summary = [{ type: 'summary_text', text: state.text }];
      state.item.status = 'completed';
      output.push(this.event('response.reasoning_summary_text.done', {
        item_id: state.item.id, output_index: state.outputIndex, summary_index: 0, text: state.text,
      }));
      output.push(this.event('response.reasoning_summary_part.done', {
        item_id: state.item.id, output_index: state.outputIndex, summary_index: 0,
        part: { type: 'summary_text', text: state.text },
      }));
      output.push(this.event('response.output_item.done', { output_index: state.outputIndex, item: state.item }));
    }
    if (this.message) {
      const state = this.message;
      const part = { type: 'output_text', text: state.text, annotations: [], logprobs: [] };
      state.item.content = [part];
      state.item.status = 'completed';
      output.push(this.event('response.output_text.done', {
        item_id: state.item.id, output_index: state.outputIndex, content_index: 0, text: state.text, logprobs: [],
      }));
      output.push(this.event('response.content_part.done', {
        item_id: state.item.id, output_index: state.outputIndex, content_index: 0, part,
      }));
      output.push(this.event('response.output_item.done', { output_index: state.outputIndex, item: state.item }));
    }
    for (const state of this.tools.values()) {
      if (state.item.type === 'custom_tool_call') state.item.input = parseWrappedArguments(state.args, state.metadata).input;
      else if (state.item.type === 'local_shell_call') {
        try { state.item.action = JSON.parse(state.args); } catch { state.item.action = { command: state.args }; }
      } else state.item.arguments = state.args;
      state.item.status = 'completed';
      const eventType = state.item.type === 'function_call'
        ? 'response.function_call_arguments.done'
        : state.item.type === 'custom_tool_call'
          ? 'response.custom_tool_call_input.done'
          : 'response.local_shell_call_arguments.done';
      output.push(this.event(eventType, {
        item_id: state.item.id,
        output_index: state.outputIndex,
        ...(state.item.type === 'custom_tool_call' ? { input: state.item.input } : { arguments: state.args }),
      }));
      output.push(this.event('response.output_item.done', { output_index: state.outputIndex, item: state.item }));
    }
    this.response.status = this.finishReason === 'length' ? 'incomplete' : 'completed';
    if (this.response.status === 'incomplete') this.response.incomplete_details = { reason: 'max_output_tokens' };
    const type = this.response.status === 'completed' ? 'response.completed' : 'response.incomplete';
    output.push(this.event(type, { response: this.response }));
    return output;
  }

  private parseEvent(block: string): string[] {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data) return [];
    if (data.trim() === '[DONE]') return this.complete();
    let json: LooseObject;
    try { json = JSON.parse(data); } catch {
      throw new AdapterError('Malformed Chat Completions SSE event.', 'RESPONSES_ADAPTER_UPSTREAM_PROTOCOL', 502);
    }
    if (json.error) {
      throw new AdapterError(String(json.error.message ?? 'Upstream streaming error.'), 'RESPONSES_ADAPTER_UPSTREAM_PROTOCOL', 502);
    }
    return this.handle(json);
  }

  push(chunk: Uint8Array | string): string[] {
    if (this.done) return [];
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    const output: string[] = [];
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.buffer);
      if (!match) break;
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      output.push(...this.parseEvent(block));
    }
    return output;
  }

  finish(): string[] {
    if (this.done) return [];
    this.buffer += this.decoder.decode();
    const output: string[] = [];
    if (this.buffer.trim()) output.push(...this.parseEvent(this.buffer));
    this.buffer = '';
    output.push(...this.complete());
    return output;
  }
}
