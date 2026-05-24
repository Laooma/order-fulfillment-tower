import { Router } from 'express'
import { getDb } from '../services/database'

const router = Router()

// ═══ Package routes (must be before /:id to avoid shadowing) ═══

// GET /api/biz-contracts/packages/:id
router.get('/packages/:id', (req, res) => {
  try {
    const db = getDb()
    const pkg = db.prepare(`
      SELECT bp.*, bd.device_name, bd.device_code, bd.contract_id
      FROM biz_packages bp
      JOIN biz_devices bd ON bp.device_id = bd.id
      WHERE bp.id = ?
    `).get(req.params.id) as any
    if (!pkg) { res.status(404).json({ error: 'Package not found' }); return }

    const materials = db.prepare('SELECT * FROM biz_materials WHERE package_id = ? ORDER BY id').all(pkg.id)
    res.json({ ...pkg, materials })
  } catch (err) {
    console.error('[BizPackages] Get error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// GET /api/biz-contracts/packages/:id/kit-check
router.get('/packages/:id/kit-check', (req, res) => {
  try {
    const db = getDb()
    const pkg = db.prepare(`
      SELECT bp.*, bd.device_name, bd.device_code, bd.contract_id
      FROM biz_packages bp
      JOIN biz_devices bd ON bp.device_id = bd.id
      WHERE bp.id = ?
    `).get(req.params.id) as any
    if (!pkg) { res.status(404).json({ error: 'Package not found' }); return }

    const materials = db.prepare('SELECT * FROM biz_materials WHERE package_id = ? ORDER BY id').all(pkg.id) as any[]

    const total = materials.length
    const ready = materials.filter((m: any) => m.kit_status === '已齐套').length
    const partial = materials.filter((m: any) => m.kit_status === '部分齐套').length
    const notReady = materials.filter((m: any) => m.kit_status === '未齐套').length
    const shortageMaterials = materials.filter((m: any) => m.shortage_qty > 0)
    const totalShortage = shortageMaterials.reduce((sum: number, m: any) => sum + m.shortage_qty, 0)

    // Get daily balance data for all materials
    const materialIds = materials.map((m: any) => m.id)
    let dailyBalances: any[] = []
    if (materialIds.length > 0) {
      const placeholders = materialIds.map(() => '?').join(',')
      dailyBalances = db.prepare(`
        SELECT * FROM biz_material_daily_balance
        WHERE material_id IN (${placeholders})
        ORDER BY material_id, date
      `).all(...materialIds)
    }

    const balancesByMaterial: Record<string, any[]> = {}
    for (const b of dailyBalances) {
      if (!balancesByMaterial[b.material_id]) balancesByMaterial[b.material_id] = []
      balancesByMaterial[b.material_id].push(b)
    }

    res.json({
      package: pkg,
      materials: materials.map((m: any) => ({
        ...m,
        dailyBalances: balancesByMaterial[m.id] || [],
      })),
      summary: {
        totalMaterials: total,
        readyCount: ready,
        partialCount: partial,
        notReadyCount: notReady,
        kitRate: total > 0 ? Math.round((ready / total) * 100) : 0,
        shortageMaterialCount: shortageMaterials.length,
        totalShortageQty: totalShortage,
      },
    })
  } catch (err) {
    console.error('[BizPackages] Kit-check error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ═══ Material routes (must be before /:id to avoid shadowing) ═══

// GET /api/biz-contracts/materials/:id
router.get('/materials/:id', (req, res) => {
  try {
    const db = getDb()
    const mat = db.prepare(`
      SELECT bm.*, bp.package_name, bp.package_code, bp.planned_production,
             bd.device_name, bd.device_code, bc.contract_no, bc.customer
      FROM biz_materials bm
      JOIN biz_packages bp ON bm.package_id = bp.id
      JOIN biz_devices bd ON bp.device_id = bd.id
      JOIN biz_contracts bc ON bd.contract_id = bc.id
      WHERE bm.id = ?
    `).get(req.params.id) as any
    if (!mat) { res.status(404).json({ error: 'Material not found' }); return }
    res.json(mat)
  } catch (err) {
    console.error('[BizMaterials] Get error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// GET /api/biz-contracts/materials/:id/daily-balance
router.get('/materials/:id/daily-balance', (req, res) => {
  try {
    const db = getDb()
    const mat = db.prepare('SELECT * FROM biz_materials WHERE id = ?').get(req.params.id) as any
    if (!mat) { res.status(404).json({ error: 'Material not found' }); return }

    const balances = db.prepare(
      'SELECT * FROM biz_material_daily_balance WHERE material_id = ? ORDER BY date'
    ).all(req.params.id)

    res.json({ material: mat, dailyBalances: balances })
  } catch (err) {
    console.error('[BizMaterials] Daily balance error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ═══ Contract list ═══

// GET /api/biz-contracts — contract list
router.get('/', (req, res) => {
  const { customer, status, page = '1', pageSize = '10' } = req.query
  try {
    const db = getDb()
    let where = 'WHERE 1=1'
    const params: any[] = []
    if (customer && typeof customer === 'string') {
      where += ' AND customer LIKE ?'
      params.push(`%${customer}%`)
    }
    if (status && typeof status === 'string') {
      where += ' AND status = ?'
      params.push(status)
    }
    const total = (db.prepare(`SELECT COUNT(*) as c FROM biz_contracts ${where}`).get(...params) as any)?.c || 0
    const p = Math.max(1, parseInt(page as string, 10))
    const ps = Math.max(1, parseInt(pageSize as string, 10))
    const data = db.prepare(`SELECT * FROM biz_contracts ${where} ORDER BY id LIMIT ? OFFSET ?`).all(...params, ps, (p - 1) * ps)
    res.json({ data, total, page: p, pageSize: ps })
  } catch (err) {
    console.error('[BizContracts] List error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ═══ Contract detail routes (/:id must come after /packages and /materials) ═══

// GET /api/biz-contracts/:id — contract with full tree
router.get('/:id', (req, res) => {
  try {
    const db = getDb()
    const contract = db.prepare('SELECT * FROM biz_contracts WHERE id = ?').get(req.params.id) as any
    if (!contract) { res.status(404).json({ error: 'Contract not found' }); return }

    const devices = db.prepare('SELECT * FROM biz_devices WHERE contract_id = ? ORDER BY id').all(contract.id) as any[]
    const result = {
      ...contract,
      devices: devices.map((dev: any) => {
        const packages = db.prepare('SELECT * FROM biz_packages WHERE device_id = ? ORDER BY id').all(dev.id) as any[]
        return {
          ...dev,
          packages: packages.map((pkg: any) => {
            const materials = db.prepare('SELECT * FROM biz_materials WHERE package_id = ? ORDER BY id').all(pkg.id) as any[]
            return { ...pkg, materials }
          }),
        }
      }),
    }
    res.json(result)
  } catch (err) {
    console.error('[BizContracts] Get error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// GET /api/biz-contracts/:id/devices
router.get('/:id/devices', (req, res) => {
  try {
    const db = getDb()
    const devices = db.prepare('SELECT * FROM biz_devices WHERE contract_id = ? ORDER BY id').all(req.params.id)
    res.json({ data: devices })
  } catch (err) {
    console.error('[BizContracts] Devices error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// GET /api/biz-contracts/:id/packages — all packages in contract (flat)
router.get('/:id/packages', (req, res) => {
  try {
    const db = getDb()
    const packages = db.prepare(`
      SELECT bp.*, bd.device_name, bd.device_code
      FROM biz_packages bp
      JOIN biz_devices bd ON bp.device_id = bd.id
      WHERE bd.contract_id = ?
      ORDER BY bp.id
    `).all(req.params.id)
    res.json({ data: packages })
  } catch (err) {
    console.error('[BizContracts] Packages error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// GET /api/biz-contracts/:id/kit-check — kitting check for entire contract
router.get('/:id/kit-check', (req, res) => {
  try {
    const db = getDb()
    const contract = db.prepare('SELECT * FROM biz_contracts WHERE id = ?').get(req.params.id) as any
    if (!contract) { res.status(404).json({ error: 'Contract not found' }); return }

    const materials = db.prepare(`
      SELECT bm.*, bp.package_name, bp.package_code, bp.planned_production, bp.status as pkg_status,
             bd.device_name, bd.device_code
      FROM biz_materials bm
      JOIN biz_packages bp ON bm.package_id = bp.id
      JOIN biz_devices bd ON bp.device_id = bd.id
      WHERE bd.contract_id = ?
      ORDER BY bd.id, bp.id, bm.id
    `).all(req.params.id) as any[]

    const total = materials.length
    const ready = materials.filter((m: any) => m.kit_status === '已齐套').length
    const partial = materials.filter((m: any) => m.kit_status === '部分齐套').length
    const notReady = materials.filter((m: any) => m.kit_status === '未齐套').length
    const shortageMaterials = materials.filter((m: any) => m.shortage_qty > 0)
    const totalShortage = shortageMaterials.reduce((sum: number, m: any) => sum + m.shortage_qty, 0)

    res.json({
      contract,
      materials,
      summary: {
        totalMaterials: total,
        readyCount: ready,
        partialCount: partial,
        notReadyCount: notReady,
        kitRate: total > 0 ? Math.round((ready / total) * 100) : 0,
        shortageMaterialCount: shortageMaterials.length,
        totalShortageQty: totalShortage,
      },
    })
  } catch (err) {
    console.error('[BizContracts] Kit-check error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

export default router
