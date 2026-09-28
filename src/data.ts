export const statuses = ['依頼受付', '支払い待ち', '支払い済み', '注文済み', '発送待ち', '発送済み', '到着', '受け渡し完了'] as const
export type Status = typeof statuses[number]

export type Order = {
  id: string
  productName: string
  amazonUrl: string
  price: number
  quantity: number
  fee: number
  total: number
  paymentDue: string
  status: Status
  notes: string
  createdAt: string
  updatedAt: string
}

export type Draft = Pick<Order, 'productName' | 'amazonUrl' | 'price' | 'quantity' | 'paymentDue' | 'notes'>

const key = 'picobuy-orders-v1'
export const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`
export const dateTime = (value: string) => value ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '未設定'
export const feeFor = (price: number, quantity: number) => Math.round(price * quantity * 0.1)
export const totalFor = (price: number, quantity: number) => price * quantity + feeFor(price, quantity)

export function loadOrders(): Order[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed.filter((value): value is Order => !!value && typeof value.id === 'string' && typeof value.productName === 'string') : []
  } catch { return [] }
}

export function saveOrders(orders: Order[]) {
  localStorage.setItem(key, JSON.stringify(orders))
}

export function createOrder(draft: Draft): Order {
  const now = new Date().toISOString()
  const stamp = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).replaceAll('-', '')
  return {
    ...draft,
    id: `PB-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
    fee: feeFor(draft.price, draft.quantity),
    total: totalFor(draft.price, draft.quantity),
    status: statuses[0],
    createdAt: now,
    updatedAt: now,
  }
}

export function isAmazonUrl(value: string) {
  try {
    const url = new URL(value)
    const domains = ['amazon.co.jp', 'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.ca', 'amazon.com.au', 'amazon.com.br', 'amazon.in', 'amazon.sg', 'amazon.nl', 'amazon.se', 'amazon.pl', 'amazon.ae', 'amazon.sa', 'amazon.com.mx']
    return url.protocol === 'https:' && domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
  } catch { return false }
}
