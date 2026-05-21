import { Router } from 'express'
import { mockOrders } from '../services/mockData'

const router = Router()

// GET /api/orders?customer=&salesperson=&shipMethod=&brand=&receiptStatus=&deliveryStatus=&isException=&page=&pageSize=
router.get('/', (req, res) => {
  let data = [...mockOrders]

  const {
    customer,
    salesperson,
    shipMethod,
    brand,
    receiptStatus,
    deliveryStatus,
    isException,
    page = '1',
    pageSize = '12',
  } = req.query

  if (customer && typeof customer === 'string') {
    data = data.filter((o) => o.customer.includes(customer))
  }
  if (salesperson && typeof salesperson === 'string') {
    data = data.filter((o) => o.salesperson.includes(salesperson))
  }
  if (brand && typeof brand === 'string') {
    data = data.filter((o) => o.brand.includes(brand))
  }
  if (shipMethod && typeof shipMethod === 'string') {
    data = data.filter((o) => o.shipMethod === shipMethod)
  }
  // receiptStatus: 未签收=0-30%, 部分签收=30-99%, 全部签收=100%
  if (receiptStatus && typeof receiptStatus === 'string') {
    if (receiptStatus === '未签收') data = data.filter((o) => o.receiptRatio < 30)
    else if (receiptStatus === '部分签收') data = data.filter((o) => o.receiptRatio >= 30 && o.receiptRatio < 100)
    else if (receiptStatus === '全部签收') data = data.filter((o) => o.receiptRatio >= 100)
  }
  // deliveryStatus: 待出库=0%, 已出库=100%, 部分出库=1-99%
  if (deliveryStatus && typeof deliveryStatus === 'string') {
    if (deliveryStatus === '待出库') data = data.filter((o) => o.shipmentRatio === 0)
    else if (deliveryStatus === '已出库') data = data.filter((o) => o.shipmentRatio >= 100)
    else if (deliveryStatus === '部分出库') data = data.filter((o) => o.shipmentRatio > 0 && o.shipmentRatio < 100)
  }
  if (isException !== undefined) {
    const flag = isException === 'true'
    data = data.filter((o) => o.isException === flag)
  }

  const total = data.length
  const p = Math.max(1, parseInt(page as string, 10))
  const ps = Math.max(1, parseInt(pageSize as string, 10))
  const start = (p - 1) * ps
  const pageData = data.slice(start, start + ps)

  res.json({ data: pageData, total, page: p, pageSize: ps })
})

// GET /api/orders/:id
router.get('/:id', (req, res) => {
  const order = mockOrders.find((o) => o.id === req.params.id)
  if (!order) {
    res.status(404).json({ error: 'Order not found' })
    return
  }
  res.json(order)
})

export default router
