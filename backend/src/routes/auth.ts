import { Router } from 'express'
import { getDb } from '../services/database'
import { generateToken } from '../middleware/auth'
import crypto from 'crypto'

const router = Router()

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex')
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      res.status(400).json({ error: 'username and password are required' })
      return
    }

    const db = getDb()
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any

    if (!user) {
      res.status(401).json({ error: 'Invalid username or password' })
      return
    }

    if (!user.enabled) {
      res.status(401).json({ error: 'Account is disabled' })
      return
    }

    const hash = hashPassword(password)
    if (hash !== user.password_hash) {
      res.status(401).json({ error: 'Invalid username or password' })
      return
    }

    const token = generateToken({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
    })

    // Load full user with permissions
    const { loadCurrentUser } = require('../middleware/auth')
    const fullUser = loadCurrentUser(user.id)

    res.json({
      token,
      user: {
        id: fullUser.id,
        username: fullUser.username,
        displayName: fullUser.displayName,
        orgId: fullUser.orgId,
        roles: fullUser.roles,
        permissions: {
          menus: Array.from(fullUser.permissions.menus),
          operations: Array.from(fullUser.permissions.operations),
          dataScopes: fullUser.permissions.dataScopes,
          skills: Array.from(fullUser.permissions.skills),
        },
      },
    })
  } catch (err) {
    console.error('[Auth] Login error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// GET /api/auth/me
router.get('/me', (req, res) => {
  try {
    const user = (req as any).currentUser
    if (!user || !user.id) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      orgId: user.orgId,
      roles: user.roles,
      permissions: {
        menus: Array.from(user.permissions.menus),
        operations: Array.from(user.permissions.operations),
        dataScopes: user.permissions.dataScopes,
        skills: Array.from(user.permissions.skills),
      },
    })
  } catch (err) {
    console.error('[Auth] Me error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  res.json({ success: true })
})

export default router
