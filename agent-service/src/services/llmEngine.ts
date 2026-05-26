import type { VolcanoRequest } from '../types'

export interface LlmOptions {
  apiKey: string
  apiUrl: string
  model?: string
  signal?: AbortSignal
}

export interface StreamChunk {
  content: string
  reasoningContent?: string
  finishReason?: string
  toolCalls?: Array<{
    id: string
    type: string
    function: {
      name: string
      arguments: string
    }
  }>
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

export async function* streamChat(
  request: VolcanoRequest,
  options: LlmOptions,
): AsyncGenerator<StreamChunk, void, unknown> {
  const res = await fetch(options.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.apiKey}`,
    },
    signal: options.signal,
    body: JSON.stringify({
      model: request.model || options.model || '',
      messages: request.messages,
      stream: true,
      temperature: request.temperature ?? 0.7,
      tools: request.tools,
      stream_options: { include_usage: true },
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`LLM API error: ${res.status} ${text}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue

      const jsonStr = trimmed.slice(5).trim()
      if (jsonStr === '[DONE]') return

      try {
        const data = JSON.parse(jsonStr)
        const delta = data.choices?.[0]?.delta
        const finishReason = data.choices?.[0]?.finish_reason

        const chunk: StreamChunk = {
          content: delta?.content || '',
          reasoningContent: delta?.reasoning_content || undefined,
          finishReason,
          toolCalls: delta?.tool_calls,
        }

        // Capture usage from final chunk (some providers send it here)
        if (data.usage) {
          chunk.usage = {
            promptTokens: data.usage.prompt_tokens || 0,
            completionTokens: data.usage.completion_tokens || 0,
            totalTokens: data.usage.total_tokens || 0,
          }
        }

        yield chunk
      } catch {
        // Ignore malformed JSON in stream
      }
    }
  }
}

export async function chatCompletion(
  request: VolcanoRequest,
  options: LlmOptions,
): Promise<{ content: string; reasoningContent?: string; toolCalls?: StreamChunk['toolCalls']; usage?: StreamChunk['usage'] }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  try {
    const res = await fetch(options.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || options.model || '',
        messages: request.messages,
        stream: false,
        temperature: request.temperature ?? 0.7,
        tools: request.tools,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`LLM API error: ${res.status} ${text}`)
    }

    const data = await res.json()
    const message = data.choices?.[0]?.message
    return {
      content: message?.content || '',
      reasoningContent: message?.reasoning_content || undefined,
      toolCalls: message?.tool_calls,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
      } : undefined,
    }
  } catch (err: any) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      throw new Error('LLM API request timeout (30s)')
    }
    throw err
  }
}
