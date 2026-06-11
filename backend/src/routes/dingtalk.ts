import { Router } from 'express'
import crypto from 'crypto'
import fs from 'fs'
import { listNotificationChannels } from '../services/database'
import path from 'path'
import { DingTalkCallbackCrypto } from '../services/dingtalk-crypto'

const router = Router()

// ── Config ──

/** DingTalk robot secret (used for HTTP Bot header-signing mode) */
const DINGTALK_APP_SECRET = 'Gmwrz2a2xgP8M3MfVc9B0Ag-OAZYxZc-d77VFb550rZLCELYXUT9-JIjDUiymp9V'

/** DingTalk event-subscription callback crypto config */
const CALLBACK_TOKEN = process.env.DINGTALK_CALLBACK_TOKEN || 'ordertower123'
const CALLBACK_AES_KEY = process.env.DINGTALK_CALLBACK_AES_KEY || '4g5j64w5k7j8d2s3f4g5h6j7k8l9m1n2o3p4q5r6s7t'
const APP_KEY = 'ding7eo42jfnhrqzzfmu'  // OWNER_KEY for event subscription

const dingCrypto = new DingTalkCallbackCrypto(CALLBACK_TOKEN, CALLBACK_AES_KEY, APP_KEY)

// ── LLM config ──

interface LlmConfig {
  apiKey: string
  apiUrl: string
  model: string
}

function getLlmConfig(): LlmConfig | null {
  try {
    const configPath = path.join(__dirname, '..', '..', '..', 'agent-service', 'llm.config.json')
    const raw = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw)
    const provider = config.providers?.find((p: any) => p.name === 'DeepSeek')
    if (!provider?.apiKey) return null
    return {
      apiKey: provider.apiKey,
      apiUrl: provider.apiUrl,
      model: config.defaultModel || 'deepseek-chat',
    }
  } catch (err) {
    console.error('[DingTalk] Failed to load LLM config:', err)
    return null
  }
}

// ── HTTP Bot header-signing verification ──

function verifyHttpBotSign(timestamp: string, sign: string, secret: string): boolean {
  try {
    const stringToSign = `${timestamp}\n${secret}`
    const computed = crypto.createHmac('sha256', secret).update(stringToSign).digest('base64')
    return computed === sign
  } catch {
    return false
  }
}

// ── LLM call ──

async function callLlm(messages: Array<{ role: string; content: string }>): Promise<string> {
  const config = getLlmConfig()
  if (!config) {
    return '抱歉，AI 服务暂时不可用，请稍后重试。'
  }

  try {
    const res = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.7,
      }),
    })

    const data = await res.json() as any
    return data.choices?.[0]?.message?.content || '抱歉，我没有理解您的问题。'
  } catch (err) {
    console.error('[DingTalk] LLM call failed:', err)
    return '抱歉，AI 服务暂时不可用，请稍后重试。'
  }
}

// ── Reply via sessionWebhook ──

async function replyByWebhook(sessionWebhook: string, content: string): Promise<void> {
  try {
    const res = await fetch(sessionWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'text',
        text: { content },
      }),
    })
    console.log('[DingTalk] Webhook reply status:', res.status)
  } catch (err) {
    console.error('[DingTalk] Failed to reply via webhook:', err)
  }
}

// ── Call agent-service for intelligent response ──

async function callAgentService(userMessage: string, userId: string): Promise<string | null> {
  try {
    // Look up enabled dingtalk channels to find bound subagent
    const channels = listNotificationChannels() as any[]
    const dingtalkChannel = channels.find((c: any) =>
      (c.type === 'dingtalk' || c.type === 'dingtalk_app') && c.enabled === 1 && c.subagent_id
    )
    const subagentId = dingtalkChannel?.subagent_id || null

    const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://localhost:3002'
    const res = await fetch(`${AGENT_SERVICE_URL}/api/dingtalk-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMessage, userId, subagentId }),
    })
    if (!res.ok) {
      console.error('[DingTalk] Agent-service returned', res.status)
      return null
    }
    const data = await res.json() as any
    return data.content || null
  } catch (err) {
    console.error('[DingTalk] Agent-service call failed:', err)
    return null
  }
}

// ── Fallback: direct DeepSeek LLM call (when agent-service unavailable) ──

// ── Process incoming message ──

async function processMessage(userMessage: string, sessionWebhook: string, senderNick: string, userId: string): Promise<void> {
  if (!userMessage.trim()) {
    console.warn('[DingTalk] Empty message, skip')
    return
  }

  try {
    // Primary: call agent-service (with tools: fetch_orders, fetch_biz_data, etc.)
    let reply = await callAgentService(userMessage, userId)

    // Fallback: direct DeepSeek LLM (no tools)
    if (!reply) {
      console.log('[DingTalk] Agent-service unavailable, falling back to direct LLM')
      const config = getLlmConfig()
      if (config) {
        const systemPrompt = `你是「订单履约控制塔」的智能助手，可以帮助用户：
- 查询订单履约情况
- 分析异常订单
- 查看待办任务
- 回答系统使用问题
请用简洁、专业的中文回答。如果用户的问题超出你的能力范围，请礼貌地说明。`

        const messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage.trim() },
        ]
        reply = await callLlm(messages)
      } else {
        reply = '抱歉，AI 服务暂时不可用，请稍后重试。'
      }
    }

    console.log(`[DingTalk] Reply:`, reply.slice(0, 100))
    await replyByWebhook(sessionWebhook, reply)
    console.log(`[DingTalk] Reply sent to ${senderNick}`)
  } catch (err) {
    console.error('[DingTalk] Failed to process message:', err)
    await replyByWebhook(sessionWebhook, '抱歉，处理消息时出错了，请稍后重试。')
  }
}

// ── Callback handler ──
// Supports both:
//   1. Event-subscription encrypted mode (query params: signature/timestamp/nonce, body: {encrypt})
//   2. HTTP Bot header-signing mode (headers: timestamp/sign, body: plain JSON)

router.post('/dingtalk/callback', async (req, res) => {
  const { signature, timestamp: qTimestamp, nonce } = req.query as Record<string, string>
  const encryptedBody = req.body?.encrypt as string | undefined

  const hTimestamp = req.headers['timestamp'] as string | undefined
  const hSign = req.headers['sign'] as string | undefined

  console.log('[DingTalk] Callback hit!')
  console.log('[DingTalk]   Query:', { signature: signature?.slice(0, 20), timestamp: qTimestamp, nonce })
  console.log('[DingTalk]   Headers:', { timestamp: hTimestamp, sign: hSign?.slice(0, 30) })
  console.log('[DingTalk]   Body keys:', Object.keys(req.body))
  console.log('[DingTalk]   Body:', JSON.stringify(req.body).slice(0, 500))

  // ── Mode 1: Event-subscription encrypted callback ──
  if (encryptedBody && signature && qTimestamp && nonce) {
    console.log('[DingTalk] → Mode: Event-subscription (encrypted)')

    // Verify signature
    const computedSig = dingCrypto.getSignature(qTimestamp, nonce, encryptedBody)
    if (computedSig !== signature) {
      console.warn('[DingTalk] Signature mismatch:', { expected: computedSig.slice(0, 20), got: signature.slice(0, 20) })
      res.status(200).json({ success: false, error: 'Invalid signature' })
      return
    }
    console.log('[DingTalk] Signature verified ✓')

    try {
      // Decrypt the message
      const plainMsg = dingCrypto.decrypt(encryptedBody)
      console.log('[DingTalk] Decrypted:', plainMsg.slice(0, 500))

      // Check if it's a URL verification "check_url" or similar
      // DingTalk sends a verification event with EventType "check_url"
      let parsed: any = null
      try { parsed = JSON.parse(plainMsg) } catch { /* not JSON */ }

      if (parsed?.EventType === 'check_url') {
        // URL verification — return encrypted "success"
        console.log('[DingTalk] → URL verification request, returning encrypted "success"')
        const response = dingCrypto.buildResponse('success', qTimestamp, nonce)
        console.log('[DingTalk] Response:', JSON.stringify(response).slice(0, 200))
        res.status(200).json(response)
        return
      }

      // Actual event callback — extract message content
      const userMessage = parsed?.text?.content || parsed?.content || plainMsg
      const sessionWebhook = parsed?.sessionWebhook || parsed?.session_webhook || ''
      const senderNick = parsed?.senderNick || parsed?.sender_nick || '钉钉用户'
      const senderId = parsed?.senderId || parsed?.sender_id || 'unknown'

      console.log('[DingTalk] Extracted:', { userMessage, sessionWebhook: sessionWebhook?.slice(0, 50), senderNick, senderId })

      // Return encrypted "success" to acknowledge
      const ackResponse = dingCrypto.buildResponse('success', qTimestamp, nonce)
      res.status(200).json(ackResponse)

      // Async processing
      if (sessionWebhook && userMessage.trim()) {
        await processMessage(userMessage, sessionWebhook, senderNick, senderId)
      } else {
        console.warn('[DingTalk] Missing sessionWebhook or empty message')
      }
      return
    } catch (err) {
      console.error('[DingTalk] Decrypt/process error:', err)
      res.status(200).json({ success: false, error: 'Decrypt failed' })
      return
    }
  }

  // ── Mode 2: HTTP Bot header-signing (plain JSON) ──
  if (hTimestamp && hSign) {
    console.log('[DingTalk] → Mode: HTTP Bot (header signing)')

    if (!verifyHttpBotSign(hTimestamp, hSign, DINGTALK_APP_SECRET)) {
      console.warn('[DingTalk] HTTP Bot signature verification failed')
      res.status(200).json({ success: false, error: 'Invalid signature' })
      return
    }
    console.log('[DingTalk] HTTP Bot signature verified ✓')

    const body = req.body
    const userMessage = body.text?.content || body.content || ''
    const sessionWebhook = body.sessionWebhook || body.session_webhook || ''
    const senderNick = body.senderNick || body.sender_nick || '用户'
    const senderId = body.senderId || body.sender_id || body.senderStaffId || 'unknown'

    console.log('[DingTalk] Extracted:', { userMessage, sessionWebhook: sessionWebhook?.slice(0, 50), senderNick, senderId })

    res.status(200).json({ success: true })

    if (sessionWebhook && userMessage.trim()) {
      await processMessage(userMessage, sessionWebhook, senderNick, senderId)
    } else {
      console.warn('[DingTalk] Missing sessionWebhook or empty message')
    }
    return
  }

  // ── Mode 3: Unknown / test ──
  console.log('[DingTalk] → Mode: Unknown (no recognized auth params)')
  res.status(200).json({ success: true, message: 'No recognized auth — test mode' })
})

// ── Health check ──

router.get('/dingtalk/callback', (_req, res) => {
  res.json({ status: 'ok', message: 'DingTalk callback endpoint is ready' })
})

export default router
