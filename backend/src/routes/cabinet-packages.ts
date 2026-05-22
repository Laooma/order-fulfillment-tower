import { Router } from 'express'
import { mockCabinetPackages } from '../services/mockData'

const router = Router()

router.get('/', (req, res) => {
  let data = [...mockCabinetPackages]

  const { status, factory, shipStatus, customer, page = '1', pageSize = '20' } = req.query

  if (status && typeof status === 'string') {
    data = data.filter((c) => c.status === status)
  }
  if (factory && typeof factory === 'string') {
    data = data.filter((c) => c.factory.includes(factory))
  }
  if (shipStatus && typeof shipStatus === 'string') {
    data = data.filter((c) => c.shipStatus === shipStatus)
  }
  if (customer && typeof customer === 'string') {
    data = data.filter((c) => c.customer.includes(customer))
  }

  const total = data.length
  const p = Math.max(1, parseInt(page as string, 10))
  const ps = Math.max(1, parseInt(pageSize as string, 10))
  const start = (p - 1) * ps
  const pageData = data.slice(start, start + ps)

  res.json({ data: pageData, total, page: p, pageSize: ps })
})

export default router
