import { randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import {
  AdapterError,
  type AdapterContext,
  type LooseObject,
  type ToolMetadata,
} from './openai-responses-adapter-types';
import {
  parseWrappedArguments,
  parsedCustomInput,
  responseBase,
  usage,
} from './openai-responses-response';

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
