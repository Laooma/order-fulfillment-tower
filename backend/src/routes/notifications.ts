import { Router } from 'express'
import {
  listNotificationChannels, getNotificationChannel, createNotificationChannel, updateNotificationChannel, deleteNotificationChannel,
  listNotificationTemplates, getNotificationTemplate, createNotificationTemplate, updateNotificationTemplate, deleteNotificationTemplate,
  insertNotificationLog, listNotificationLogs, getLastLogByChannel,
  listSubagents, getSubagent, createSubagent, updateSubagent, deleteSubagent,
} from '../services/database'

export const notificationsRouter = Router()

// ── Channel CRUD ──

notificationsRouter.get('/notification-channels', (_req, res) => {
  try {
    const channels = listNotificationChannels()
    res.json({ data: channels })
  } catch (err) {
    console.error('[Notifications] List error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

notificationsRouter.get('/notification-channels/:id', (req, res) => {
  try {
    const channel = getNotificationChannel(req.params.id)
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' })
      return
    }
    res.json({ data: channel })
  } catch (err) {
    console.error('[Notifications] Get error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

notificationsRouter.post('/notification-channels', (req, res) => {
  try {
    const { id, name, type, config, subagentId } = req.body
    if (!id || !name || !type) {
      res.status(400).json({ error: 'id, name, and type are required' })
      return
    }
    if (!['email', 'wecom', 'feishu', 'feishu_app', 'dingtalk', 'dingtalk_app'].includes(type)) {
      res.status(400).json({ error: 'type must be email, wecom, feishu, feishu_app, dingtalk, or dingtalk_app' })
      return
    }
    const result = createNotificationChannel({
      id,
      name,
      type,
      config_json: config ? JSON.stringify(config) : '{}',
      subagent_id: subagentId || null,
    })
    res.json(result)
  } catch (err) {
    console.error('[Notifications] Create error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

notificationsRouter.put('/notification-channels/:id', (req, res) => {
  try {
    const { name, config, enabled, subagentId } = req.body
    const data: any = {}
    if (name !== undefined) data.name = name
    if (config !== undefined) data.config_json = JSON.stringify(config)
    if (enabled !== undefined) data.enabled = enabled ? 1 : 0
    if (subagentId !== undefined) data.subagent_id = subagentId || null
    const result = updateNotificationChannel(req.params.id, data)
    if (!result.success) {
      res.status(404).json({ error: 'Channel not found or no changes' })
      return
    }
    res.json({ success: true })
  } catch (err) {
    console.error('[Notifications] Update error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

notificationsRouter.delete('/notification-channels/:id', (req, res) => {
  try {
    const result = deleteNotificationChannel(req.params.id)
    if (!result.success) {
      res.status(404).json({ error: 'Channel not found' })
      return
    }
    res.json({ success: true })
  } catch (err) {
    console.error('[Notifications] Delete error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ── Send notification ──

notificationsRouter.post('/notifications/send', async (req, res) => {
  try {
    const { channelId, to, subject, message, templateId } = req.body
    if (!channelId) {
      res.status(400).json({ error: 'channelId is required' })
      return
    }
    if (!message) {
      res.status(400).json({ error: 'message is required' })
      return
    }

    const channel = getNotificationChannel(channelId)
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' })
      return
    }
    if (!channel.enabled) {
      res.status(400).json({ error: 'Channel is disabled' })
      return
    }

    const config = JSON.parse(channel.config_json || '{}')
    const result = await sendNotification(channel.type, config, to, subject, message)
    // Auto-log
    insertNotificationLog({
      channel_id: channelId, channel_name: channel.name, channel_type: channel.type,
      send_to: to || '', subject: subject || '', message: message,
      success: result.success ? 1 : 0, detail: result.detail || '', error: result.error || '',
      template_id: templateId || '',
    })
    res.json(result)
  } catch (err) {
    console.error('[Notifications] Send error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ── Test notification ──

notificationsRouter.post('/notifications/test/:id', async (req, res) => {
  try {
    const channel = getNotificationChannel(req.params.id)
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' })
      return
    }

    const config = JSON.parse(channel.config_json || '{}')
    const testSubject = '【测试消息】通知渠道测试'
    const testMessage = `这是一条来自「订单履约控制塔」系统的测试消息。\n\n通知渠道: ${channel.name}\n渠道类型: ${channel.type}\n发送时间: ${new Date().toLocaleString('zh-CN')}\n\n如果您收到此消息，说明该通知渠道配置正确。`

    let testTo = 'test@example.com'
    if (channel.type === 'email') {
      testTo = config.user || config.from || testTo
    }
    if (channel.type === 'feishu_app') {
      testTo = config.receive_id || ''
    }
    if (channel.type === 'dingtalk') {
      testTo = ''
    }
    if (channel.type === 'dingtalk_app') {
      testTo = config.userid_list || ''
    }

    const result = await sendNotification(channel.type, config, testTo, testSubject, testMessage)
    insertNotificationLog({
      channel_id: channel.id, channel_name: channel.name, channel_type: channel.type,
      send_to: testTo, subject: testSubject, message: testMessage,
      success: result.success ? 1 : 0, detail: result.detail || '', error: result.error || '',
    })
    res.json(result)
  } catch (err) {
    console.error('[Notifications] Test error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ── Template CRUD ──

notificationsRouter.get('/notification-templates', (_req, res) => {
  try {
    const templates = listNotificationTemplates()
    // Auto-seed if empty
    if (templates.length === 0) {
      seedTemplates()
      const seeded = listNotificationTemplates()
      res.json({ data: seeded })
      return
    }
    res.json({ data: templates })
  } catch (err) {
    console.error('[Templates] List error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

notificationsRouter.get('/notification-templates/:id', (req, res) => {
  try {
    const t = getNotificationTemplate(req.params.id)
    if (!t) { res.status(404).json({ error: 'Template not found' }); return }
    res.json({ data: t })
  } catch (err) {
    console.error('[Templates] Get error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

notificationsRouter.post('/notification-templates', (req, res) => {
  try {
    const { id, name, subject, body, variables } = req.body
    if (!id || !name) { res.status(400).json({ error: 'id and name are required' }); return }
    createNotificationTemplate({ id, name, subject, body, variables: variables ? JSON.stringify(variables) : undefined })
    res.json({ success: true })
  } catch (err) {
    console.error('[Templates] Create error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

notificationsRouter.put('/notification-templates/:id', (req, res) => {
  try {
    const { name, subject, body, variables } = req.body
    const data: any = {}
    if (name !== undefined) data.name = name
    if (subject !== undefined) data.subject = subject
    if (body !== undefined) data.body = body
    if (variables !== undefined) data.variables = JSON.stringify(variables)
    const result = updateNotificationTemplate(req.params.id, data)
    if (!result.success) { res.status(404).json({ error: 'Template not found or no changes' }); return }
    res.json({ success: true })
  } catch (err) {
    console.error('[Templates] Update error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

notificationsRouter.delete('/notification-templates/:id', (req, res) => {
  try {
    const result = deleteNotificationTemplate(req.params.id)
    if (!result.success) { res.status(404).json({ error: 'Template not found' }); return }
    res.json({ success: true })
  } catch (err) {
    console.error('[Templates] Delete error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ── Log History ──

notificationsRouter.get('/notification-logs', (req, res) => {
  try {
    const { channelId, success, page, pageSize } = req.query
    const result = listNotificationLogs({
      channelId: channelId as string,
      success: success !== undefined ? Number(success) : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    })
    res.json(result)
  } catch (err) {
    console.error('[Logs] List error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ── Channel health ──

notificationsRouter.get('/notification-channels/:id/health', (req, res) => {
  try {
    const log = getLastLogByChannel(req.params.id)
    if (!log) { res.json({ status: 'unknown', lastTest: null }); return }
    res.json({
      status: log.success ? 'healthy' : 'error',
      lastTest: { success: !!log.success, detail: log.detail, error: log.error, time: log.created_at },
    })
  } catch (err) {
    res.status(500).json({ error: 'Internal error' })
  }
})

// ── Subagents CRUD ──

notificationsRouter.get('/subagents', (_req, res) => {
  try {
    const subagents = listSubagents()
    res.json({ data: subagents })
  } catch (err) {
    console.error('[Subagents] List error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

notificationsRouter.get('/subagents/:id', (req, res) => {
  try {
    const subagent = getSubagent(req.params.id)
    if (!subagent) { res.status(404).json({ error: 'Subagent not found' }); return }
    res.json(subagent)
  } catch (err) {
    console.error('[Subagents] Get error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

notificationsRouter.post('/subagents', (req, res) => {
  try {
    const { id, name, description, system_prompt, icon, color, enabled_skills, enabled_tools } = req.body
    if (!id || !name) { res.status(400).json({ error: 'id and name are required' }); return }
    const result = createSubagent({ id, name, description, system_prompt, icon, color, enabled_skills, enabled_tools })
    res.status(201).json(result)
  } catch (err) {
    console.error('[Subagents] Create error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

notificationsRouter.put('/subagents/:id', (req, res) => {
  try {
    const { name, description, system_prompt, icon, color, enabled_skills, enabled_tools } = req.body
    const result = updateSubagent(req.params.id, { name, description, system_prompt, icon, color, enabled_skills, enabled_tools })
    if (!result) { res.status(404).json({ error: 'Subagent not found' }); return }
    res.json(result)
  } catch (err) {
    console.error('[Subagents] Update error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

notificationsRouter.delete('/subagents/:id', (req, res) => {
  try {
    const result = deleteSubagent(req.params.id)
    if (!result.success) { res.status(404).json({ error: 'Subagent not found' }); return }
    res.json({ success: true })
  } catch (err) {
    console.error('[Subagents] Delete error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ── Seed templates ──

function seedTemplates() {
  const defaults = [
    {
      id: 'tpl_todo_reminder',
      name: '待办提醒',
      subject: '【待办提醒】订单履约待办通知',
      body: '您好！\n\n以下订单履约进度需要您关注：\n\n{{order_list}}\n\n请及时登录控制塔系统查看并处理。\n\n⏰ 统计时间：{{current_time}}',
      variables: JSON.stringify([
        { name: 'order_list', label: '订单列表', placeholder: '订单 HT2025XXXX 回款率仅4%...' },
        { name: 'current_time', label: '发送时间', placeholder: '2025-01-01 12:00:00' },
      ]),
    },
    {
      id: 'tpl_alert',
      name: '异常告警',
      subject: '【异常告警】订单履约异常通知',
      body: '⚠️ 系统检测到以下异常订单：\n\n{{alert_content}}\n\n请立即联系相关人员处理。',
      variables: JSON.stringify([
        { name: 'alert_content', label: '告警内容', placeholder: '订单 HT2025XXXX 超过交期未发货...' },
      ]),
    },
    {
      id: 'tpl_daily_report',
      name: '每日汇总',
      subject: '【每日汇总】{{report_date}} 履约日报',
      body: '📊 履约日报 - {{report_date}}\n\n今日订单总数：{{total_orders}} 单\n正常履约：{{normal_count}} 单\n异常订单：{{abnormal_count}} 单\n\n{{abnormal_detail}}\n\n以上为自动生成的履约日报。',
      variables: JSON.stringify([
        { name: 'report_date', label: '报告日期', placeholder: '2025-01-01' },
        { name: 'total_orders', label: '总订单数', placeholder: '60' },
        { name: 'normal_count', label: '正常履约数', placeholder: '45' },
        { name: 'abnormal_count', label: '异常订单数', placeholder: '15' },
        { name: 'abnormal_detail', label: '异常详情', placeholder: 'HT2025XXXX 回款率仅4%...' },
      ]),
    },
  ]
  for (const t of defaults) {
    try { createNotificationTemplate(t) } catch (_) { /* already seeded */ }
  }
}

// ── Sending logic ──

async function sendNotification(type: string, config: Record<string, any>, to: string, subject: string, message: string): Promise<{ success: boolean; error?: string; detail?: string }> {
  switch (type) {
    case 'email':
      return sendEmail(config, to, subject, message)
    case 'wecom':
      return sendWecomBot(config, subject, message)
    case 'feishu':
      return sendFeishuBot(config, subject, message)
    case 'feishu_app':
      return sendFeishuApp(config, to, subject, message)
    case 'dingtalk':
      return sendDingTalkBot(config, subject, message)
    case 'dingtalk_app':
      return sendDingTalkApp(config, to, subject, message)
    default:
      return { success: false, error: `Unknown channel type: ${type}` }
  }
}

async function sendEmail(config: Record<string, any>, to: string, subject: string, message: string): Promise<{ success: boolean; error?: string; detail?: string }> {
  try {
    const nodemailer = require('nodemailer')
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port || 587,
      secure: config.secure || false,
      auth: {
        user: config.user,
        pass: config.password,
      },
    })

    const info = await transporter.sendMail({
      from: config.from || config.user,
      to: to || config.user,
      subject,
      text: message,
    })

    return { success: true, detail: `Email sent, messageId: ${info.messageId}` }
  } catch (err) {
    const msg = (err as Error).message
    console.error('[Notifications] Email error:', msg)
    return { success: false, error: msg }
  }
}

async function sendWecomBot(config: Record<string, any>, _subject: string, message: string): Promise<{ success: boolean; error?: string; detail?: string }> {
  try {
    const webhookUrl = config.webhook_url
    if (!webhookUrl) {
      return { success: false, error: 'Missing webhook_url in config' }
    }

    const body = JSON.stringify({
      msgtype: 'markdown',
      markdown: {
        content: message,
      },
    })

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    const result = await response.json() as any
    if (result.errcode === 0) {
      return { success: true, detail: 'WeCom message sent' }
    }
    return { success: false, error: `WeCom error: ${result.errmsg || JSON.stringify(result)}` }
  } catch (err) {
    const msg = (err as Error).message
    console.error('[Notifications] WeCom error:', msg)
    return { success: false, error: msg }
  }
}

async function sendFeishuBot(config: Record<string, any>, _subject: string, message: string): Promise<{ success: boolean; error?: string; detail?: string }> {
  try {
    const webhookUrl = config.webhook_url
    if (!webhookUrl) {
      return { success: false, error: 'Missing webhook_url in config' }
    }

    const body = JSON.stringify({
      msg_type: 'text',
      content: {
        text: message,
      },
    })

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    const result = await response.json() as any
    if (result.code === 0) {
      return { success: true, detail: 'Feishu message sent' }
    }
    return { success: false, error: `Feishu error: ${result.msg || JSON.stringify(result)}` }
  } catch (err) {
    const msg = (err as Error).message
    console.error('[Notifications] Feishu error:', msg)
    return { success: false, error: msg }
  }
}

async function sendFeishuApp(config: Record<string, any>, to: string, _subject: string, message: string): Promise<{ success: boolean; error?: string; detail?: string }> {
  try {
    const appId = config.app_id
    const appSecret = config.app_secret
    // If 'to' looks like a valid Feishu ID (ou_/oc_/on_ prefix), use it; otherwise fallback to config default
    const isValidFeishuId = (id: string) => /^o[ucn]_/.test(id)
    const receiveIdType = isValidFeishuId(to) ? (config.receive_id_type || 'open_id') : (config.receive_id_type || 'chat_id')
    const receiveId = isValidFeishuId(to) ? to : (config.receive_id || to)

    if (!appId || !appSecret) {
      return { success: false, error: 'Missing app_id or app_secret in config' }
    }
    if (!receiveId) {
      return { success: false, error: 'Missing receive_id (recipient)' }
    }

    // Step 1: Get tenant_access_token
    const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    })
    const tokenData = await tokenRes.json() as any
    if (tokenData.code !== 0) {
      return { success: false, error: `Feishu auth error: ${tokenData.msg || JSON.stringify(tokenData)}` }
    }
    const token = tokenData.tenant_access_token

    // Step 2: Send message
    const msgRes = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text: message }),
      }),
    })
    const msgData = await msgRes.json() as any
    if (msgData.code === 0) {
      return { success: true, detail: `Feishu message sent, message_id: ${msgData.data?.message_id || 'unknown'}` }
    }
    return { success: false, error: `Feishu error: ${msgData.msg || JSON.stringify(msgData)}` }
  } catch (err) {
    const msg = (err as Error).message
    console.error('[Notifications] Feishu App error:', msg)
    return { success: false, error: msg }
  }
}

async function sendDingTalkBot(config: Record<string, any>, subject: string, message: string): Promise<{ success: boolean; error?: string; detail?: string }> {
  try {
    const webhookUrl = config.webhook_url
    if (!webhookUrl) {
      return { success: false, error: 'Missing webhook_url in config' }
    }

    let url = webhookUrl
    const secret = config.secret
    if (secret) {
      // Sign with HmacSHA256 + Base64, append timestamp and sign to URL
      const timestamp = Date.now()
      const signStr = `${timestamp}\n${secret}`
      const crypto = require('crypto')
      const sign = crypto.createHmac('sha256', secret).update(signStr).digest('base64')
      const sep = url.includes('?') ? '&' : '?'
      url = `${url}${sep}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`
    }

    const content = subject ? `${subject}\n\n${message}` : message
    const body = JSON.stringify({
      msgtype: 'text',
      text: { content },
    })

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    const result = await response.json() as any
    if (result.errcode === 0) {
      return { success: true, detail: 'DingTalk message sent' }
    }
    return { success: false, error: `DingTalk error: ${result.errmsg || JSON.stringify(result)}` }
  } catch (err) {
    const msg = (err as Error).message
    console.error('[Notifications] DingTalk error:', msg)
    return { success: false, error: msg }
  }
}

async function sendDingTalkApp(config: Record<string, any>, to: string, subject: string, message: string): Promise<{ success: boolean; error?: string; detail?: string }> {
  try {
    const appKey = config.app_key || config.client_id
    const appSecret = config.app_secret || config.client_secret
    const agentId = config.agent_id
    const useridList = to || config.userid_list || ''

    if (!appKey || !appSecret) {
      return { success: false, error: 'Missing app_key (client_id) or app_secret (client_secret) in config' }
    }
    if (!agentId) {
      return { success: false, error: 'Missing agent_id in config' }
    }
    if (!useridList) {
      return { success: false, error: 'Missing userid_list (recipient)' }
    }

    // Step 1: Get access_token
    const tokenRes = await fetch(`https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(appKey)}&appsecret=${encodeURIComponent(appSecret)}`)
    const tokenData = await tokenRes.json() as any
    if (tokenData.errcode !== 0) {
      return { success: false, error: `DingTalk auth error: ${tokenData.errmsg || JSON.stringify(tokenData)}` }
    }
    const accessToken = tokenData.access_token

    // Step 2: Send work notification
    const msg: Record<string, any> = subject
      ? {
          msgtype: 'markdown',
          markdown: { title: subject, text: message },
        }
      : {
          msgtype: 'text',
          text: { content: message },
        }

    const sendRes = await fetch(`https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: Number(agentId),
        userid_list: useridList,
        msg,
      }),
    })
    const sendData = await sendRes.json() as any
    if (sendData.errcode === 0) {
      return { success: true, detail: `DingTalk work notification sent, task_id: ${sendData.task_id || 'unknown'}` }
    }
    return { success: false, error: `DingTalk error: ${sendData.errmsg || JSON.stringify(sendData)}` }
  } catch (err) {
    const msg = (err as Error).message
    console.error('[Notifications] DingTalk App error:', msg)
    return { success: false, error: msg }
  }
}
