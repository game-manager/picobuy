export const statuses = ['依頼受付', '支払い待ち', '支払い済み', '注文済み', '発送待ち', '発送済み', '到着', '受け渡し完了'] as const
export type Status = typeof statuses[number]

export type Order = {
  id: string
  customerEmail?: string
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
  statusEvents?: { status: Status; createdAt: string }[]
}

export type Draft = Pick<Order, 'productName' | 'amazonUrl' | 'price' | 'quantity' | 'paymentDue' | 'notes'>

export const yen = (value: number) => `¥${value.toLocaleString('ja-JP')}`
export const dateTime = (value: string) => value ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '未設定'
export const feeFor = (price: number, quantity: number) => Math.round(price * quantity * 0.1)
export const totalFor = (price: number, quantity: number) => price * quantity + feeFor(price, quantity)

export function isAmazonUrl(value: string) {
  try {
    const url = new URL(value)
    const domains = ['amazon.co.jp', 'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.ca', 'amazon.com.au', 'amazon.com.br', 'amazon.in', 'amazon.sg', 'amazon.nl', 'amazon.se', 'amazon.pl', 'amazon.ae', 'amazon.sa', 'amazon.com.mx']
    return url.protocol === 'https:' && domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) && /\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}(?:\/|$)/i.test(url.pathname)
  } catch { return false }
}
