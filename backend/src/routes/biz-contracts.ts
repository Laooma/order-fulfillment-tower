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

// GET /api/biz-contracts/materials/search?code=DLQ-001 — search material stock across all contracts
router.get('/materials/search', (req, res) => {
  try {
    const db = getDb()
    const code = req.query.code as string
    if (!code) { res.status(400).json({ error: 'code query param is required' }); return }

    // Try exact match first
    let materials = db.prepare(`
      SELECT bm.*, bp.package_name, bp.package_code, bp.planned_production, bp.status as pkg_status,
             bd.device_name, bd.device_code, bc.id as contract_id, bc.contract_no, bc.customer, bc.amount, bc.priority
      FROM biz_materials bm
      JOIN biz_packages bp ON bm.package_id = bp.id
      JOIN biz_devices bd ON bp.device_id = bd.id
      JOIN biz_contracts bc ON bd.contract_id = bc.id
      WHERE bm.material_code = ?
      ORDER BY bc.priority DESC, bm.current_stock DESC
    `).all(code) as any[]

    // If no exact match, try LIKE search on material_code and device_code
    if (materials.length === 0) {
      const likePattern = `%${code}%`
      materials = db.prepare(`
        SELECT bm.*, bp.package_name, bp.package_code, bp.planned_production, bp.status as pkg_status,
               bd.device_name, bd.device_code, bc.id as contract_id, bc.contract_no, bc.customer, bc.amount, bc.priority
        FROM biz_materials bm
        JOIN biz_packages bp ON bm.package_id = bp.id
        JOIN biz_devices bd ON bp.device_id = bd.id
        JOIN biz_contracts bc ON bd.contract_id = bc.id
        WHERE bm.material_code LIKE ? OR bd.device_code LIKE ?
        ORDER BY bc.priority DESC, bm.current_stock DESC
      `).all(likePattern, likePattern) as any[]
    }

    // If still nothing, try partial match on the first segment (e.g. "SDR" from "SDR-240")
    if (materials.length === 0 && code.includes('-')) {
      const firstSegment = code.split('-')[0]
      if (firstSegment.length >= 2) {
        const prefixPattern = `${firstSegment}%`
        materials = db.prepare(`
          SELECT bm.*, bp.package_name, bp.package_code, bp.planned_production, bp.status as pkg_status,
                 bd.device_name, bd.device_code, bc.id as contract_id, bc.contract_no, bc.customer, bc.amount, bc.priority
          FROM biz_materials bm
          JOIN biz_packages bp ON bm.package_id = bp.id
          JOIN biz_devices bd ON bp.device_id = bd.id
          JOIN biz_contracts bc ON bd.contract_id = bc.id
          WHERE bm.material_code LIKE ?
          ORDER BY bc.priority DESC, bm.current_stock DESC
        `).all(prefixPattern) as any[]
      }
    }

    const summary = {
      materialCode: code,
      totalContracts: materials.length,
      totalAvailableStock: materials.reduce((s: number, m: any) => s + m.current_stock, 0),
      totalInTransit: materials.reduce((s: number, m: any) => s + m.in_transit, 0),
      contracts: materials.map((m: any) => ({
        materialId: m.id,
        contractId: m.contract_id,
        contractNo: m.contract_no,
        customer: m.customer,
        amount: m.amount,
        priority: m.priority,
        currentStock: m.current_stock,
        inTransit: m.in_transit,
        requiredQty: m.required_qty,
        shortageQty: m.shortage_qty,
        surplus: m.current_stock + m.in_transit - m.required_qty,
        supplier: m.supplier,
        kitStatus: m.kit_status,
        packageName: m.package_name,
        deviceName: m.device_name,
        plannedProduction: m.planned_production,
      })),
    }

    // When no results, include suggestions of all available material codes
    if (materials.length === 0) {
      const allCodes = db.prepare(
        'SELECT DISTINCT material_code FROM biz_materials ORDER BY material_code'
      ).all() as any[]
      ;(summary as any).suggestedCodes = allCodes.map((r: any) => r.material_code)
    }

    res.json(summary)
  } catch (err) {
    console.error('[BizMaterials] Search error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/biz-contracts/materials/upsert — find or create material with contract chain
router.post('/materials/upsert', (req, res) => {
  try {
    const db = getDb()
    const { contractNo, materialCode, materialName, currentStock, requiredQty } = req.body
    if (!contractNo || !materialCode) {
      res.status(400).json({ error: 'contractNo and materialCode are required' })
      return
    }

    const stock = Number(currentStock) || 0
    const required = Number(requiredQty) || 0

    // Step 1: Find or create contract
    let contract = db.prepare('SELECT * FROM biz_contracts WHERE contract_no = ?').get(contractNo) as any
    if (!contract) {
      // Look up from analysis_orders for customer data
      const order = db.prepare('SELECT * FROM analysis_orders WHERE contract_number = ? LIMIT 1').get(contractNo) as any
      const contractId = `SC-${contractNo.replace(/[^A-Za-z0-9]/g, '-')}`
      const customer = order?.customer || '待确认客户'
      const amount = order?.amount ? parseFloat(order.amount) : 0
      db.prepare(
        'INSERT INTO biz_contracts (id, contract_no, customer, amount, priority) VALUES (?, ?, ?, ?, ?)'
      ).run(contractId, contractNo, customer, amount, '普通')
      contract = db.prepare('SELECT * FROM biz_contracts WHERE id = ?').get(contractId) as any
    }

    // Step 2: Find or create default device for this contract
    let device = db.prepare(
      'SELECT * FROM biz_devices WHERE contract_id = ? LIMIT 1'
    ).get(contract.id) as any
    if (!device) {
      const deviceId = `DEV-001-${contract.id}`
      db.prepare(
        'INSERT INTO biz_devices (id, contract_id, device_name, device_code) VALUES (?, ?, ?, ?)'
      ).run(deviceId, contract.id, '默认装置', 'DEF-1')
      device = db.prepare('SELECT * FROM biz_devices WHERE id = ?').get(deviceId) as any
    }

    // Step 3: Find or create default package for this device
    let pkg = db.prepare(
      'SELECT * FROM biz_packages WHERE device_id = ? LIMIT 1'
    ).get(device.id) as any
    if (!pkg) {
      const pkgId = `PKG-0001-${contract.id}`
      db.prepare(
        'INSERT INTO biz_packages (id, device_id, package_name, package_code, status) VALUES (?, ?, ?, ?, ?)'
      ).run(pkgId, device.id, '默认包', 'DEF-PKG', '待生产')
      pkg = db.prepare('SELECT * FROM biz_packages WHERE id = ?').get(pkgId) as any
    }

    // Step 4: Find or create/update material
    let material = db.prepare(
      'SELECT * FROM biz_materials WHERE package_id = ? AND material_code = ?'
    ).get(pkg.id, materialCode) as any
    if (!material) {
      const matCount = (db.prepare('SELECT COUNT(*) as c FROM biz_materials').get() as any).c
      const matId = `MAT-${String(matCount + 1).padStart(4, '0')}`
      const name = materialName || materialCode
      db.prepare(
        `INSERT INTO biz_materials (id, package_id, material_code, material_name, required_qty, current_stock, shortage_qty)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(matId, pkg.id, materialCode, name, required, stock, Math.max(0, required - stock))
      material = db.prepare('SELECT * FROM biz_materials WHERE id = ?').get(matId) as any
    } else {
      db.prepare(
        'UPDATE biz_materials SET current_stock = ?, required_qty = MAX(required_qty, ?), shortage_qty = MAX(0, required_qty - ? - in_transit) WHERE id = ?'
      ).run(stock, required, stock, material.id)
      // Recalculate
      db.prepare(`
        UPDATE biz_materials SET shortage_qty = MAX(0, required_qty - current_stock - in_transit)
        WHERE id = ?
      `).run(material.id)
      material = db.prepare('SELECT * FROM biz_materials WHERE id = ?').get(material.id) as any
    }

    res.json({
      success: true,
      created: !material,
      material: {
        id: material.id,
        materialCode: material.material_code,
        materialName: material.material_name,
        currentStock: material.current_stock,
        requiredQty: material.required_qty,
        shortageQty: material.shortage_qty,
        contractNo: contract.contract_no,
        contractId: contract.id,
      },
    })
  } catch (err) {
    console.error('[BizMaterials] Upsert error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// PUT /api/biz-contracts/materials/:id/update-stock
router.put('/materials/:id/update-stock', (req, res) => {
  try {
    const db = getDb()
    const { current_stock } = req.body
    if (current_stock === undefined || current_stock === null) {
      res.status(400).json({ error: 'current_stock is required' })
      return
    }
    const result = db.prepare(
      'UPDATE biz_materials SET current_stock = ? WHERE id = ?'
    ).run(Number(current_stock), req.params.id)
    if (result.changes === 0) {
      res.status(404).json({ error: 'Material not found' })
      return
    }
    // Recalculate shortage_qty
    db.prepare(`
      UPDATE biz_materials SET shortage_qty = MAX(0, required_qty - current_stock - in_transit)
      WHERE id = ?
    `).run(req.params.id)
    const updated = db.prepare('SELECT * FROM biz_materials WHERE id = ?').get(req.params.id) as any
    res.json({ success: true, id: req.params.id, current_stock: updated.current_stock, shortage_qty: updated.shortage_qty })
  } catch (err) {
    console.error('[BizMaterials] Update stock error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

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
