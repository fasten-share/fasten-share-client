import { createHash, randomUUID } from 'node:crypto';
import {
  AdapterError,
  type AdapterContext,
  type JsonRecord,
  type LooseObject,
  type ToolMetadata,
  type ToolType,
  record,
  unsupported,
} from './openai-responses-adapter-types';

const OPTIONAL_WEB_SEARCH_TOOLS = new Set(['web_search', 'web_search_preview']);
const HOSTED_RESPONSES_TOOLS = new Set([
  ...OPTIONAL_WEB_SEARCH_TOOLS,
  'file_search',
  'computer_use_preview',
  'computer_use',
  'code_interpreter',
  'image_generation',
  'mcp',
  'tool_search',
  'programmatic_tool_calling',
]);

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
  omittedWebSearch: Set<string>;
} {
  if (value == null) {
    return {
      tools: undefined,
      mapping: new Map<string, ToolMetadata>(),
      omittedWebSearch: new Set<string>(),
    };
  }
  if (!Array.isArray(value)) throw new AdapterError('tools must be an array.');
  const mapping = new Map<string, ToolMetadata>();
  const omittedWebSearch = new Set<string>();
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
    // Codex can advertise web search as an optional hosted tool. A Chat
    // Completions backend cannot execute it, so degrade to the remaining tools.
    if (OPTIONAL_WEB_SEARCH_TOOLS.has(type)) {
      omittedWebSearch.add(type);
      return;
    }
    if (HOSTED_RESPONSES_TOOLS.has(type)) {
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
  return { tools, mapping, omittedWebSearch };
}

function mapToolChoice(
  value: unknown,
  mapping: Map<string, ToolMetadata>,
  omittedWebSearch: Set<string>,
): string | LooseObject | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    if (mapping.size === 0) {
      if (value === 'required' && omittedWebSearch.size > 0) {
        unsupported("tool_choice 'required' cannot be satisfied because web search is not available through a Chat Completions backend.");
      }
      if (value === 'auto' || value === 'none') return undefined;
    }
    return value;
  }
  const choice = record(value, 'Invalid tool_choice.');
  const type = String(choice.type ?? '');
  if (OPTIONAL_WEB_SEARCH_TOOLS.has(type)) {
    unsupported(`Hosted Responses tool '${type}' cannot be selected through a Chat Completions backend.`);
  }
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
  const toolChoice = mapToolChoice(input.tool_choice, convertedTools.mapping, convertedTools.omittedWebSearch);
  if (toolChoice != null) body.tool_choice = toolChoice;
  const responseFormat = mapText(input.text);
  if (responseFormat) body.response_format = responseFormat;
  const direct = ['temperature', 'top_p', 'service_tier', 'prompt_cache_key', 'safety_identifier',
    'user', 'seed', 'frequency_penalty', 'presence_penalty', 'stop', 'logprobs', 'top_logprobs'];
  for (const field of direct) if (input[field] != null) body[field] = input[field];
  if (input.parallel_tool_calls != null && convertedTools.tools?.length) {
    body.parallel_tool_calls = input.parallel_tool_calls;
  }
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
