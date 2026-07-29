import { describe, expect, it } from 'vitest';
import {
  AdapterError,
  ChatSseToResponses,
  convertChatResponse,
  convertResponsesRequest,
} from '@/lib/adapter/openai-responses-adapter';

describe('OpenAI Responses compatibility adapter', () => {
  it('converts Codex-style instructions, custom tools, and tool outputs', () => {
    const converted = convertResponsesRequest({
      model: 'ignored',
      instructions: 'You are a coding agent.',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'inspect' }] },
        { type: 'custom_tool_call', call_id: 'call-1', name: 'exec', input: 'pwd' },
        { type: 'custom_tool_call_output', call_id: 'call-1', output: '/tmp' },
      ],
      tools: [{ type: 'custom', name: 'exec', description: 'Run a command' }],
      stream: true,
      store: false,
      reasoning: { effort: 'high' },
      text: { verbosity: 'low' },
    }, 'model-a');

    expect(converted.body).toEqual(expect.objectContaining({
      model: 'model-a',
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: 'high',
      verbosity: 'low',
    }));
    expect(converted.body.messages).toEqual(expect.arrayContaining([
      { role: 'system', content: 'You are a coding agent.' },
      { role: 'tool', tool_call_id: 'call-1', content: '/tmp' },
    ]));
    const wrapper = (converted.body.tools as Array<{ function: { name: string } }>)[0].function.name;
    expect(wrapper).toMatch(/^fsr_/);
    expect(converted.body.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [expect.objectContaining({ function: expect.objectContaining({ name: wrapper }) })],
      }),
    ]));
  });

  it('flattens deferred Codex tool namespaces into Chat Completions functions', () => {
    const converted = convertResponsesRequest({
      input: 'inspect',
      tools: [{
        type: 'namespace',
        name: 'workspace',
        description: 'Workspace operations',
        tools: [{
          type: 'function',
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
            additionalProperties: false,
          },
        }],
      }],
    }, 'model-a');

    expect(converted.body.tools).toEqual([{
      type: 'function',
      function: expect.objectContaining({
        name: 'read_file',
        description: 'Workspace operations\n\nRead a file',
      }),
    }]);
    expect(converted.context.tools.get('read_file')).toEqual({
      type: 'function',
      name: 'read_file',
    });
  });

  it.each([
    [{ input: 'hello', store: true }, 'store:true'],
    [{ input: 'hello', previous_response_id: 'resp_1' }, 'previous_response_id'],
    [{ input: 'hello', tools: [{ type: 'file_search' }] }, 'Hosted Responses tool'],
  ])('rejects unsupported state or hosted capabilities', (request, message) => {
    expect(() => convertResponsesRequest(request, 'model')).toThrowError(
      expect.objectContaining<Partial<AdapterError>>({ code: 'RESPONSES_ADAPTER_UNSUPPORTED_FEATURE', message: expect.stringContaining(message) }),
    );
  });

  it('omits optional hosted web search from Chat Completions requests', () => {
    const converted = convertResponsesRequest({
      input: 'hello',
      tools: [{ type: 'web_search' }, { type: 'web_search_preview' }],
      tool_choice: 'auto',
      parallel_tool_calls: true,
    }, 'model');

    expect(converted.body).not.toHaveProperty('tools');
    expect(converted.body).not.toHaveProperty('tool_choice');
    expect(converted.body).not.toHaveProperty('parallel_tool_calls');
  });

  it.each([
    [{ type: 'web_search' }, 'cannot be selected'],
    ['required', 'cannot be satisfied'],
  ])('rejects a required hosted web search tool choice', (toolChoice, message) => {
    expect(() => convertResponsesRequest({
      input: 'hello',
      tools: [{ type: 'web_search' }],
      tool_choice: toolChoice,
    }, 'model')).toThrowError(
      expect.objectContaining<Partial<AdapterError>>({
        code: 'RESPONSES_ADAPTER_UNSUPPORTED_FEATURE',
        message: expect.stringContaining(message),
      }),
    );
  });

  it('converts non-streaming text and function calls', () => {
    const request = convertResponsesRequest({
      input: 'hello',
      tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }],
    }, 'model-a');
    const response = convertChatResponse({
      id: 'chatcmpl-1',
      created: 10,
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: 'checking',
          tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"id":1}' } }],
        },
      }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    }, request.context);

    expect(response).toEqual(expect.objectContaining({ id: 'resp_1', status: 'completed' }));
    expect(response.output).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'message' }),
      expect.objectContaining({ type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{"id":1}' }),
    ]));
    expect(response.usage).toEqual(expect.objectContaining({ input_tokens: 4, output_tokens: 2 }));
  });

  it('parses arbitrarily split Chat SSE into Responses text and tool events', () => {
    const request = convertResponsesRequest({
      input: 'hello',
      stream: true,
      tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }],
    }, 'model-a');
    const converter = new ChatSseToResponses(request.context);
    const source = [
      'data: {"id":"chatcmpl-1","model":"model-a","choices":[{"delta":{"reasoning_content":"think"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":"hi","tool_calls":[{"index":0,"id":"call-1","function":{"name":"lookup","arguments":"{\\\\\\"id\\\\\\":"}}]},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const events: string[] = [];
    for (let offset = 0; offset < source.length; offset += 7) {
      events.push(...converter.push(source.slice(offset, offset + 7)));
    }
    events.push(...converter.finish());
    const text = events.join('');
    expect(text).toContain('response.reasoning_summary_text.delta');
    expect(text).toContain('response.output_text.delta');
    expect(text).toContain('response.function_call_arguments.delta');
    expect(text).toContain('response.completed');
    expect(text).toContain('"total_tokens":5');
  });

  it('uses the upstream response id from the first event and emits custom input once', () => {
    const request = convertResponsesRequest({
      input: 'hello',
      stream: true,
      tools: [{ type: 'custom', name: 'exec', description: 'Run a command' }],
    }, 'model-a');
    const wrapper = (request.body.tools as Array<{ function: { name: string } }>)[0].function.name;
    const converter = new ChatSseToResponses(request.context);
    const source = [
      `data: ${JSON.stringify({
        id: 'chatcmpl-custom',
        choices: [{
          delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: wrapper, arguments: '{"input":"' } }] },
          finish_reason: null,
        }],
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [{
          delta: { tool_calls: [{ index: 0, function: { arguments: 'pwd"}' } }] },
          finish_reason: 'tool_calls',
        }],
      })}\n\n`,
      'data: [DONE]\n\n',
    ].join('');
    const text = [...converter.push(source), ...converter.finish()].join('');
    const data = text.split('\n').filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; delta?: string; response?: { id?: string } });
    expect(data.find((event) => event.type === 'response.created')?.response?.id).toBe('resp_custom');
    expect(data.filter((event) => event.type === 'response.custom_tool_call_input.delta'))
      .toEqual([expect.objectContaining({ delta: 'pwd' })]);
  });
});
