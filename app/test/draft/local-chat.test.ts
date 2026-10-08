import { describe, expect, it, vi } from 'vitest'
import {
  createLocalChat,
  localIdleTimeoutMs,
  localModelId,
  LocalReplyTruncatedError,
  resolveLocalTarget,
} from '../../src/draft/local-chat.js'
import { DEFAULT_CONFIG } from '../../src/config.js'

// A Response whose body arrives in the given chunks, so a test can split a
// line or an SSE event across two reads the way a socket does.
function streamed(chunks: string[], init: { status?: number } = {}): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(body, { status: init.status ?? 200 })
}

function fakeFetch(response: () => Response) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return response()
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}

const request = { system: 'sys', user: 'usr', schema: { type: 'object' }, schemaName: 'reply' }

describe('the Ollama transport', () => {
  const target = { kind: 'ollama' as const, baseUrl: 'http://localhost:11434/', model: 'qwen3.8:27b-mlx' }

  it('streams, and joins the message content across lines split between chunks', async () => {
    const { fetch, calls } = fakeFetch(() =>
      streamed(['{"message":{"content":"{\\"a\\""}}\n{"messa', 'ge":{"content":":1}"}}\n{"done":true,"done_reason":"stop"}\n']),
    )
    const text = await createLocalChat(target, { fetch })(request)
    expect(text).toBe('{"a":1}')
    expect(calls[0]!.url).toBe('http://localhost:11434/api/chat')
    // Node's fetch abandons a request after 300s without headers, and Ollama
    // sends none until generation ends unless it streams.
    expect(calls[0]!.body).toMatchObject({ model: 'qwen3.8:27b-mlx', stream: true, think: false, format: { type: 'object' } })
    expect(calls[0]!.body.options).toBeUndefined()
  })

  it('sends num_ctx only when a context length is configured', async () => {
    const { fetch, calls } = fakeFetch(() => streamed(['{"message":{"content":"{}"},"done":true}\n']))
    await createLocalChat({ ...target, contextLength: 16384 }, { fetch })(request)
    expect(calls[0]!.body.options).toEqual({ num_ctx: 16384 })
  })

  it('says the reply was cut off rather than failing to parse it', async () => {
    const { fetch } = fakeFetch(() => streamed(['{"message":{"content":"{\\"items\\":["}}\n{"done":true,"done_reason":"length"}\n']))
    await expect(createLocalChat(target, { fetch })(request)).rejects.toBeInstanceOf(LocalReplyTruncatedError)
  })

  it('reports a non-2xx answer', async () => {
    const { fetch } = fakeFetch(() => streamed(['model not found'], { status: 404 }))
    await expect(createLocalChat(target, { fetch })(request)).rejects.toThrow(/HTTP 404/)
  })
})

describe('the OpenAI-compatible transport', () => {
  const target = { kind: 'openai-compatible' as const, baseUrl: 'http://localhost:1234/v1', model: 'qwen/qwen3-8b' }
  const delta = (content: string, finish: string | null = null) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`

  it('streams SSE and joins the deltas, even when an event is split across reads', async () => {
    const whole = delta('{"a"') + delta(':1}', 'stop') + 'data: [DONE]\n\n'
    const { fetch, calls } = fakeFetch(() => streamed([whole.slice(0, 17), whole.slice(17)]))
    expect(await createLocalChat(target, { fetch })(request)).toBe('{"a":1}')
    // A base URL given with or without /v1 reaches the same endpoint.
    expect(calls[0]!.url).toBe('http://localhost:1234/v1/chat/completions')
    expect(calls[0]!.body).toMatchObject({
      model: 'qwen/qwen3-8b',
      stream: true,
      // LM Studio refuses json_object; llama.cpp and vLLM accept json_schema too.
      response_format: { type: 'json_schema', json_schema: { name: 'reply', schema: { type: 'object' } } },
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' },
      ],
    })
  })

  it('adds /v1 to a bare base URL', async () => {
    const { fetch, calls } = fakeFetch(() => streamed([delta('{}', 'stop'), 'data: [DONE]\n\n']))
    await createLocalChat({ ...target, baseUrl: 'http://localhost:8080' }, { fetch })(request)
    expect(calls[0]!.url).toBe('http://localhost:8080/v1/chat/completions')
  })

  it('says the reply was cut off when the server stopped on length', async () => {
    const { fetch } = fakeFetch(() => streamed([delta('{"items":[', 'length'), 'data: [DONE]\n\n']))
    await expect(createLocalChat(target, { fetch })(request)).rejects.toBeInstanceOf(LocalReplyTruncatedError)
  })

  it('reports a non-2xx answer with what the server said', async () => {
    const { fetch } = fakeFetch(() => streamed(['{"error":"no model loaded"}'], { status: 400 }))
    await expect(createLocalChat(target, { fetch })(request)).rejects.toThrow(/HTTP 400.*no model loaded/)
  })
})

describe('resolveLocalTarget', () => {
  it('reads the Ollama settings by default', () => {
    expect(resolveLocalTarget(DEFAULT_CONFIG)).toEqual({ kind: 'ollama', ...DEFAULT_CONFIG.ollama })
  })

  it('reads the OpenAI-compatible settings when that kind is chosen, and takes a per-run model', () => {
    const config = {
      ...DEFAULT_CONFIG,
      localServerKind: 'openai-compatible' as const,
      openaiCompatible: { baseUrl: 'http://localhost:1234', model: 'a', contextLength: 8192 },
    }
    expect(resolveLocalTarget(config)).toEqual({ kind: 'openai-compatible', baseUrl: 'http://localhost:1234', model: 'a', contextLength: 8192 })
    expect(resolveLocalTarget(config, 'b').model).toBe('b')
  })

  it('refuses an OpenAI-compatible target with no model, naming how to set one', () => {
    const config = { ...DEFAULT_CONFIG, localServerKind: 'openai-compatible' as const }
    expect(() => resolveLocalTarget(config)).toThrow(/openaiCompatible\.model/)
  })
})

describe('localModelId', () => {
  it('keeps the Ollama id as it always was, whatever the host', () => {
    expect(localModelId({ kind: 'ollama', baseUrl: 'http://box:11434', model: 'llama3.2' })).toBe('ollama:llama3.2')
  })

  it('folds the spellings of one OpenAI-compatible server together', () => {
    const a = localModelId({ kind: 'openai-compatible', baseUrl: 'http://LocalHost:1234/v1/', model: 'm' })
    const b = localModelId({ kind: 'openai-compatible', baseUrl: 'http://localhost:1234', model: 'm' })
    expect(a).toBe('openai-compatible:localhost:1234/m')
    expect(b).toBe(a)
  })
})

// A multibyte character can be cut between two reads; decoding each chunk on
// its own turns both halves into replacement characters.
function streamedBytes(parts: Uint8Array[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(p)
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

function splitInside(text: string, char: string): Uint8Array[] {
  const bytes = new TextEncoder().encode(text)
  const at = new TextEncoder().encode(text.slice(0, text.indexOf(char))).length + 1
  return [bytes.slice(0, at), bytes.slice(at)]
}

describe('the transports and multibyte text', () => {
  it('keeps a character split across reads on the Ollama stream', async () => {
    const line = '{"message":{"content":"Kapalı"}}\n{"done":true,"done_reason":"stop"}\n'
    const { fetch } = fakeFetch(() => streamedBytes(splitInside(line, 'ı')))
    const text = await createLocalChat({ kind: 'ollama', baseUrl: 'http://localhost:11434', model: 'm' }, { fetch })(request)
    expect(text).toBe('Kapalı')
  })

  it('keeps a character split across reads on the SSE stream', async () => {
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Kapalı' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
    const { fetch } = fakeFetch(() => streamedBytes(splitInside(sse, 'ı')))
    const text = await createLocalChat({ kind: 'openai-compatible', baseUrl: 'http://localhost:1234', model: 'm' }, { fetch })(request)
    expect(text).toBe('Kapalı')
  })
})

describe('the transports and how a stream ends', () => {
  const ollama = { kind: 'ollama' as const, baseUrl: 'http://localhost:11434', model: 'm' }
  const oai = { kind: 'openai-compatible' as const, baseUrl: 'http://localhost:1234', model: 'm' }
  const delta = (content: string, finish: string | null = null) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`

  it('throws the error an Ollama stream reports mid-way', async () => {
    const { fetch } = fakeFetch(() => streamed(['{"message":{"content":"{"}}\n{"error":"model runner has unexpectedly stopped"}\n']))
    await expect(createLocalChat(ollama, { fetch })(request)).rejects.toThrow('model runner has unexpectedly stopped')
  })

  it('throws the error an SSE stream reports mid-way', async () => {
    const { fetch } = fakeFetch(() => streamed([delta('{'), 'data: {"error":{"message":"context length exceeded"}}\n\n']))
    await expect(createLocalChat(oai, { fetch })(request)).rejects.toThrow('context length exceeded')
  })

  it('treats an Ollama stream that ends without done as cut off', async () => {
    const { fetch } = fakeFetch(() => streamed(['{"message":{"content":"{\\"items\\":"}}\n']))
    await expect(createLocalChat(ollama, { fetch })(request)).rejects.toBeInstanceOf(LocalReplyTruncatedError)
  })

  it('treats an SSE stream that ends without [DONE] as cut off', async () => {
    const { fetch } = fakeFetch(() => streamed([delta('{"items":')]))
    await expect(createLocalChat(oai, { fetch })(request)).rejects.toBeInstanceOf(LocalReplyTruncatedError)
  })

  it('ignores anything after [DONE]', async () => {
    const { fetch } = fakeFetch(() => streamed([delta('{}', 'stop'), 'data: [DONE]\n\n', delta('garbage'), 'data: {"error":"late"}\n\n']))
    expect(await createLocalChat(oai, { fetch })(request)).toBe('{}')
  })

  it('names no model itself, so a caller that prefixes one says it once', () => {
    expect(new LocalReplyTruncatedError().message).toMatch(/^the reply was cut off/)
  })
})

describe('resolveLocalTarget wording', () => {
  it('names the Ollama key when an Ollama model is blank', () => {
    expect(() => resolveLocalTarget(DEFAULT_CONFIG, '  ')).toThrow(/^ollama\.model is not set/)
  })
})

// A server that stalls mid-reply used to hang the run with no error: the
// stream stayed open and nothing arrived. The silence is now bounded, and
// reported as a cut-off reply, since a partial reply is what it left.
describe('a local server that goes silent', () => {
  // Sends `first`, then holds the stream open forever, honouring an abort the
  // way a real fetch does.
  function stalling(first: string[]) {
    const signals: AbortSignal[] = []
    const fn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal)
      const encoder = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const c of first) controller.enqueue(encoder.encode(c))
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
        },
      })
      return new Response(body, { status: 200 })
    })
    return { fetch: fn as unknown as typeof fetch, signals }
  }

  // Never answers at all, not even with headers.
  function silent() {
    const fn = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    return { fetch: fn as unknown as typeof fetch }
  }

  const ollama = { kind: 'ollama' as const, baseUrl: 'http://localhost:11434', model: 'qwen3.8:27b-mlx' }
  const compatible = { kind: 'openai-compatible' as const, baseUrl: 'http://localhost:1234', model: 'qwen/qwen3-8b' }

  it('gives up on an Ollama stream that stalls mid-reply, as a truncated reply naming the wait', async () => {
    const { fetch, signals } = stalling(['{"message":{"content":"{\\"a\\""}}\n'])
    const run = createLocalChat(ollama, { fetch, idleTimeoutMs: 30 })(request)
    await expect(run).rejects.toBeInstanceOf(LocalReplyTruncatedError)
    await expect(run).rejects.toThrow(/sent nothing for 0\.03s/)
    expect(signals[0]!.aborted).toBe(true)
  })

  it('gives up on an SSE stream that stalls mid-reply', async () => {
    const { fetch } = stalling([`data: ${JSON.stringify({ choices: [{ delta: { content: '{' } }] })}\n\n`])
    await expect(createLocalChat(compatible, { fetch, idleTimeoutMs: 30 })(request)).rejects.toBeInstanceOf(
      LocalReplyTruncatedError,
    )
  })

  it('gives up on a server that never sends headers', async () => {
    await expect(createLocalChat(ollama, { ...silent(), idleTimeoutMs: 30 })(request)).rejects.toBeInstanceOf(
      LocalReplyTruncatedError,
    )
  })

  // The limit is on silence, not on the whole reply: a slow model that keeps
  // talking is never cut off.
  it('lets a reply that keeps arriving take longer than the limit in total', async () => {
    const encoder = new TextEncoder()
    const parts = ['{"message":{"content":"{"}}\n', '{"message":{"content":"}"}}\n', '{"done":true,"done_reason":"stop"}\n']
    const fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            for (const p of parts) {
              await new Promise((r) => setTimeout(r, 25))
              controller.enqueue(encoder.encode(p))
            }
            controller.close()
          },
        }),
      )) as unknown as typeof globalThis.fetch
    expect(await createLocalChat(ollama, { fetch, idleTimeoutMs: 50 })(request)).toBe('{}')
  })

  it('defaults to three minutes of silence, set in seconds', () => {
    expect(DEFAULT_CONFIG.localIdleTimeout).toBe(180)
    expect(localIdleTimeoutMs(DEFAULT_CONFIG)).toBe(180_000)
    expect(localIdleTimeoutMs({ localIdleTimeout: 600 })).toBe(600_000)
  })
})
