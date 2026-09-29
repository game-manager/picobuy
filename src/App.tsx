import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, Bell, Check, CheckCircle2, ChevronRight, CircleHelp, ClipboardList, Clock3, CreditCard, FileText, Home, LayoutDashboard, LogIn, LogOut, Menu, Package, PackageCheck, Plus, Search, ShieldAlert, ShoppingBag, Sparkles, Truck, X } from 'lucide-react'
import { authApi, orderApi, ApiError, type Invoice, type User } from './api'
import { dateTime, feeFor, isAmazonUrl, statuses, totalFor, yen, type Draft, type Order, type Status } from './data'

const initialDraft: Draft = { productName: '', amazonUrl: '', price: 0, quantity: 1, paymentDue: '', notes: '' }
const draftKey = 'picobuy-draft-v1'
const iconBase = import.meta.env.BASE_URL

function route() { return decodeURIComponent(location.hash.slice(1) || '/') }
function go(path: string) { location.hash = path; window.scrollTo({ top: 0, behavior: 'smooth' }) }
function readDraft(): Draft { try { return { ...initialDraft, ...JSON.parse(sessionStorage.getItem(draftKey) || '{}') } } catch { return initialDraft } }

function Logo({ compact = false }: { compact?: boolean }) {
  return <button className="brand" onClick={() => go('/')} aria-label="PicoBuy ホーム">
    <span className="brand-symbol"><img src={`${iconBase}picobuy-mark.png`} alt="" /></span>
    {!compact && <span className="brand-name">Pico<span>Buy</span></span>}
  </button>
}

function Button({ children, onClick, variant = 'primary', type = 'button', disabled = false, className = '' }: { children: ReactNode, onClick?: () => void, variant?: 'primary' | 'secondary' | 'ghost', type?: 'button' | 'submit', disabled?: boolean, className?: string }) {
  return <button type={type} className={`button button-${variant} ${className}`} onClick={onClick} disabled={disabled}>{children}</button>
}

function Badge({ status }: { status: Status }) {
  const index = statuses.indexOf(status)
  return <span className={`status-badge ${index === 7 ? 'done' : index < 2 ? 'pending' : 'active'}`}><span className="badge-dot" />{status}</span>
}

function App() {
  const [path, setPath] = useState(route)
  const [orders, setOrders] = useState<Order[]>([])
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [ordersOpen, setOrdersOpen] = useState(false)
  const [serviceError, setServiceError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const idempotencyKey = useRef<string | null>(null)
  const [draft, setDraft] = useState<Draft>(readDraft)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => { const handler = () => { setPath(route()); setMenuOpen(false) }; window.addEventListener('hashchange', handler); return () => window.removeEventListener('hashchange', handler) }, [])
  useEffect(() => {
    let active = true
    authApi.completeGoogleLogin().catch(() => { if (active) setActionError('Googleログインを完了できませんでした。もう一度お試しください。') }).then(() => authApi.health()).then(result => {
      if (!active) return
      if (!result.ready) { setServiceError('サービスの設定中です。公開までしばらくお待ちください。'); setAuthReady(true); return }
      setOrdersOpen(result.ordersOpen)
      authApi.me().then(({ user: current }) => { if (!active) return; setUser(current); return orderApi.list().then(({ orders: items }) => { if (active) setOrders(items) }) })
        .catch(cause => { if (active && (!(cause instanceof ApiError) || cause.status !== 401)) setServiceError('サービスに接続できません。時間をおいて再試行してください。') })
        .finally(() => { if (active) setAuthReady(true) })
    }).catch(() => { if (active) { setServiceError('サービスに接続できません。時間をおいて再試行してください。'); setAuthReady(true) } })
    return () => { active = false }
  }, [])
  useEffect(() => { try { sessionStorage.setItem(draftKey, JSON.stringify(draft)) } catch { /* Draft persistence is optional. */ } }, [draft])
  useEffect(() => { idempotencyKey.current = null }, [draft])
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timeout) }, [notice])
  useEffect(() => {
    if (!user) return
    const parts = path.split('/').filter(Boolean)
    const id = parts[0] === 'admin' && parts[1] === 'order' ? parts[2] : ['order', 'document'].includes(parts[0]) ? parts[1] : null
    if (!id || (parts[0] === 'admin' && user.role !== 'admin')) return
    let active = true
    orderApi.get(id).then(({ order }) => { if (active) setDetailOrder(order) }).catch(() => { if (active) setDetailOrder(null) })
    return () => { active = false }
  }, [path, user])
  useEffect(() => {
    if (!user) return
    let active = true
    const refresh = async () => {
      if (document.hidden) return
      try {
        const parts = path.split('/').filter(Boolean)
        const detailId = parts[0] === 'admin' && parts[1] === 'order' ? parts[2] : ['order', 'document'].includes(parts[0]) ? parts[1] : null
        const [{ orders: latest }, detail] = await Promise.all([orderApi.list(), detailId ? orderApi.get(detailId) : Promise.resolve(null)])
        if (active) {
          setOrders(latest)
          if (detail) setDetailOrder(detail.order)
        }
      } catch (cause) {
        if (active && cause instanceof ApiError && cause.status === 401) {
          setUser(null); setOrders([]); setDetailOrder(null)
        }
      }
    }
    const interval = window.setInterval(refresh, 120000)
    document.addEventListener('visibilitychange', refresh)
    return () => { active = false; window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh) }
  }, [user, path])
  useEffect(() => {
    const parts = path.split('/').filter(Boolean)
    if (!user || parts[0] !== 'document' || parts[2] !== 'invoice' || !parts[1]) return
    let active = true
    setInvoiceLoading(true); setInvoice(null)
    orderApi.invoice(parts[1]).then(({ invoice: value }) => { if (active) setInvoice(value) }).catch(() => { if (active) setInvoice(null) }).finally(() => { if (active) setInvoiceLoading(false) })
    return () => { active = false }
  }, [path, user])

  const login = async (current: User) => {
    setUser(current)
    const { orders: items } = await orderApi.list()
    setOrders(items)
    setActionError('')
    if (path === '/login') go('/history')
  }
  const logout = async () => {
    try {
      await authApi.logout()
      setUser(null); setOrders([]); setDetailOrder(null); go('/')
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'ログアウトできませんでした。通信状態を確認してください。')
    }
  }
  const create = async () => {
    if (busy) return
    setBusy(true); setActionError('')
    try {
      idempotencyKey.current ||= crypto.randomUUID()
      const { order } = await orderApi.create({ ...draft, paymentDue: new Date(draft.paymentDue).toISOString() }, idempotencyKey.current)
      setOrders(previous => [order, ...previous.filter(item => item.id !== order.id)])
      setDetailOrder(order); setDraft(initialDraft); sessionStorage.removeItem(draftKey); idempotencyKey.current = null
      go(`/order/${order.id}`); setNotice('注文依頼を受け付けました')
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : '注文を保存できませんでした。') }
    finally { setBusy(false) }
  }
  const changeStatus = async (id: string, status: Status) => {
    setActionError('')
    try {
      const { order } = await orderApi.status(id, status)
      setOrders(previous => previous.map(item => item.id === id ? order : item)); setDetailOrder(order); setNotice('ステータスを更新しました')
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'ステータスを更新できませんでした。') }
  }
  const issueInvoice = async (id: string) => {
    if (!window.confirm('注文内容と金額を確認しましたか？ 請求書は発行後に変更できません。')) return
    setActionError('')
    try {
      const { invoice: issued } = await orderApi.issueInvoice(id)
      setInvoice(issued)
      const { order: updated } = await orderApi.get(id)
      setOrders(previous => previous.map(item => item.id === id ? updated : item)); setDetailOrder(updated)
      go(`/document/${id}/invoice`); setNotice('請求書を発行しました')
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : '請求書を発行できませんでした。') }
  }

  const segments = path.split('/').filter(Boolean)
  const order = detailOrder?.id === segments[1] ? detailOrder : orders.find(item => item.id === segments[1])
  let page: ReactNode
  const adminRoute = segments[0] === 'admin'
  const protectedRoute = path !== '/' && path !== '/login'
  if (!authReady) page = <div className="page-wrap container"><div className="empty-state standalone"><h1>読み込み中...</h1></div></div>
  else if (serviceError) page = <ServiceUnavailablePage message={serviceError} />
  else if (path === '/login' || (protectedRoute && !user)) page = <LoginPage onLogin={login} />
  else if ((path === '/request' || path === '/confirm') && !ordersOpen) page = <ServiceUnavailablePage message="注文受付は準備中です。公開までしばらくお待ちください。" />
  else if (adminRoute && user?.role !== 'admin') page = <AccessDeniedPage />
  else if (path === '/') page = <HomePage orders={orders} user={user} />
  else if (path === '/request') page = <RequestPage draft={draft} setDraft={setDraft} />
  else if (path === '/confirm') page = <ConfirmPage draft={draft} onConfirm={create} busy={busy} />
  else if (path === '/history') page = <HistoryPage orders={orders} />
  else if (segments[0] === 'order' && segments.length === 2) page = order ? <OrderPage order={order} /> : <MissingPage />
  else if (path === '/admin') page = <AdminPage orders={orders} />
  else if (segments[0] === 'admin' && segments[1] === 'order' && segments.length === 3) {
    const adminOrder = detailOrder?.id === segments[2] ? detailOrder : orders.find(item => item.id === segments[2])
    page = adminOrder ? <AdminOrderPage order={adminOrder} changeStatus={changeStatus} issueInvoice={issueInvoice} /> : <MissingPage />
  }
  else if (segments[0] === 'document' && segments.length === 3) {
    const docOrder = detailOrder?.id === segments[1] ? detailOrder : orders.find(item => item.id === segments[1])
    page = !docOrder ? <MissingPage /> : segments[2] === 'estimate' ? <DocumentPage order={docOrder} /> : segments[2] === 'invoice' ? invoice?.orderId === docOrder.id ? <InvoiceDocumentPage invoice={invoice} /> : invoiceLoading ? <div className="page-wrap container"><p>請求書を読み込んでいます...</p></div> : <InvoicePendingPage /> : <MissingPage />
  }
  else page = <MissingPage />

  return <div className="app-shell">
    <header className="site-header"><div className="header-inner">
      <Logo />
      <nav className="desktop-nav" aria-label="メインナビゲーション">
        <button className={path === '/' ? 'nav-active' : ''} onClick={() => go('/')}>ホーム</button>
        <button className={path === '/history' || path.startsWith('/order/') ? 'nav-active' : ''} onClick={() => go('/history')}>注文履歴</button>
        {user?.role === 'admin' && <button className={path.startsWith('/admin') ? 'nav-active' : ''} onClick={() => go('/admin')}>管理画面</button>}
      </nav>
      <div className="header-actions">{user ? <button className="account-link" onClick={logout} title={`${user.email} からログアウト`}><LogOut size={16} /> ログアウト</button> : <button className="account-link" onClick={() => go('/login')}>ログイン</button>}<Button onClick={() => go('/request')} className="header-cta">商品を依頼する <ArrowRight size={16} /></Button><button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="メニュー" aria-expanded={menuOpen}>{menuOpen ? <X /> : <Menu />}</button></div>
    </div></header>
    {menuOpen && <nav className="mobile-menu" aria-label="モバイルナビゲーション"><button onClick={() => go('/')}>ホーム</button><button onClick={() => go('/request')}>商品を依頼する</button><button onClick={() => go('/history')}>注文履歴</button>{user?.role === 'admin' && <button onClick={() => go('/admin')}>管理画面</button>}{user ? <button onClick={logout}>ログアウト</button> : <button onClick={() => go('/login')}>ログイン</button>}</nav>}
    {actionError && <div className="error-banner" role="alert">{actionError}</div>}
    <main>{page}</main>
    {notice && <div className="toast" role="status"><CheckCircle2 size={18} />{notice}</div>}
    <footer className="site-footer"><div className="footer-inner"><div><Logo /><p>欲しいを、もっと手軽に。</p></div><div className="footer-links"><button onClick={() => go('/request')}>商品依頼</button><button onClick={() => go('/history')}>注文履歴</button>{user?.role === 'admin' && <button onClick={() => go('/admin')}>管理画面</button>}</div><small>© {new Date().getFullYear()} PicoBuy<br />Amazon公式または提携サービスではありません。</small></div></footer>
  </div>
}

function PageHead({ eyebrow, title, subtitle, back }: { eyebrow: string, title: string, subtitle?: string, back?: string }) {
  return <div className="page-head">{back && <button className="back-link" onClick={() => go(back)}><ArrowLeft size={16} /> 戻る</button>}<span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
}

function ServiceNote({ admin = false }: { admin?: boolean }) {
  return <div className="service-note"><ShieldAlert size={19} /><p><strong>{admin ? '管理者専用' : 'ご利用前に'}</strong> {admin ? '注文と進捗はサーバーに保存され、利用者にも反映されます。支払い確認後にステータスを変更してください。' : '商品情報はご自身で確認して入力してください。注文受付後、担当者が内容を確認します。オンライン決済には対応していません。'}</p></div>
}

function LoginPage({ onLogin }: { onLogin: (user: User) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const submit = async () => {
    setErrorMessage(''); setBusy(true)
    try {
      const result = await authApi.loginWithGoogle()
      if (result) await onLogin(result.user)
    } catch (cause) { setErrorMessage(cause instanceof Error ? cause.message : 'ログインできませんでした。') }
    finally { setBusy(false) }
  }
  return <div className="page-wrap container auth-wrap"><PageHead eyebrow="SECURE SIGN IN" title="Googleでログイン" subtitle="Googleアカウントで本人確認を行い、注文履歴を管理します。" back="/" /><div className="panel auth-card"><div className="auth-icon"><LogIn size={24} /></div><h2>ログインして始める</h2><p>Googleアカウントが必要です。ログイン後、注文依頼と進捗確認ができます。</p><Button onClick={submit} disabled={busy}>{busy ? '接続中...' : 'Googleでログイン'} <ArrowRight size={17} /></Button>{errorMessage && <p className="auth-error" role="alert">{errorMessage}</p>}</div></div>
}

function ServiceUnavailablePage({ message }: { message: string }) { return <div className="page-wrap container"><div className="empty-state standalone"><div className="empty-icon"><ShieldAlert size={32} /></div><h1>現在ご利用いただけません</h1><p>{message}</p></div></div> }
function AccessDeniedPage() { return <div className="page-wrap container"><div className="empty-state standalone"><div className="empty-icon"><ShieldAlert size={32} /></div><h1>管理者権限が必要です</h1><p>このページは管理者アカウントだけが利用できます。</p><Button onClick={() => go('/')}>ホームへ戻る</Button></div></div> }

function HomePage({ orders, user }: { orders: Order[], user: User | null }) {
  return <><section className="hero"><div className="hero-orb hero-orb-one" /><div className="hero-orb hero-orb-two" /><div className="hero-inner"><div className="hero-content"><div className="hero-pill"><Sparkles size={14} /> 購入依頼を、シンプルに</div><h1>欲しいを、<br /><em>もっと手軽に。</em></h1><p>Amazonで見つけた商品を、かんたんに依頼。<br className="desktop-break" />お申し込みから受け渡しまで、ひとつの画面で見渡せます。</p><div className="hero-buttons"><Button onClick={() => go('/request')}>商品を依頼する <ArrowRight size={18} /></Button><Button variant="secondary" onClick={() => go('/history')}>注文を確認する</Button></div><div className="hero-caption"><span className="avatar-stack"><span>P</span><span>B</span><span>✓</span></span><span>Googleログインで、注文を安全に管理</span></div></div><div className="hero-visual"><div className="visual-glow" /><div className="floating-label label-top"><span className="mini-icon cyan"><ShoppingBag size={18} /></span><span>かんたん商品依頼<small>数ステップで完了</small></span><CheckCircle2 size={18} className="green-icon" /></div><div className="showcase-card"><div className="showcase-top"><img src={`${iconBase}picobuy-mark.png`} alt="" /><div><span>YOUR ORDER</span><strong>注文状況をひと目で</strong></div><span className="showcase-dots">•••</span></div><div className="showcase-product"><div className="product-placeholder"><Package size={38} /></div><div><small>注文番号 PB-20260928-XXXXXX</small><strong>お気に入りの商品を依頼</strong><span>¥10,000 <i>＋ 手数料 ¥1,000</i></span></div></div><div className="showcase-progress"><div><span>現在のステータス</span><b>注文済み</b></div><div className="progress-track"><span /></div><div className="progress-steps"><span>依頼受付</span><span>支払い</span><span>お届け</span></div></div></div><div className="floating-label label-bottom"><span className="mini-icon royal"><Truck size={19} /></span><span>進捗をいつでも確認<small>8段階のタイムライン</small></span></div></div></div></section>
    <section className="quick-section container"><div className="section-title"><span className="eyebrow">HOW IT WORKS</span><h2>欲しい商品への、<br className="mobile-break" />最短ルート。</h2><p>面倒な手続きは最小限。必要な情報を入力するだけ。</p></div><div className="steps-grid"><div className="step-card"><span className="step-num">01</span><div className="feature-icon"><Search size={25} /></div><h3>商品を見つける</h3><p>Amazonで気になる商品を探し、URLと商品情報を入力します。</p></div><div className="step-card"><span className="step-num">02</span><div className="feature-icon"><ClipboardList size={25} /></div><h3>内容を確認して依頼</h3><p>商品代金と10%の手数料を確認。納得してから依頼を確定。</p></div><div className="step-card"><span className="step-num">03</span><div className="feature-icon"><PackageCheck size={25} /></div><h3>進捗をチェック</h3><p>注文後は8段階のタイムラインで、現在の状況を確認できます。</p></div></div></section>
    <section className="home-bottom container"><div className="bottom-card"><div><span className="eyebrow">GET STARTED</span><h2>さっそく、はじめよう。</h2><p>お気に入りの商品を見つけたら、PicoBuyで依頼を作成しましょう。</p></div><Button onClick={() => go(user ? '/request' : '/login')}>{user ? '新しい依頼を作成' : 'ログインして始める'} <ArrowRight size={18} /></Button></div>{orders.length > 0 && <button className="recent-link" onClick={() => go(`/order/${orders[0].id}`)}><span><Clock3 size={18} /> 最近の注文: {orders[0].productName}</span><ChevronRight size={18} /></button>}<ServiceNote /></section></>
}

function RequestPage({ draft, setDraft }: { draft: Draft, setDraft: (value: Draft) => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const update = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (!draft.productName.trim()) next.productName = '商品名を入力してください。'
    if (!isAmazonUrl(draft.amazonUrl)) next.amazonUrl = 'https:// から始まるAmazonの商品URLを入力してください。'
    if (!Number.isSafeInteger(draft.price) || draft.price <= 0 || !Number.isSafeInteger(draft.price * draft.quantity) || !Number.isSafeInteger(totalFor(draft.price, draft.quantity))) next.price = '1円以上の整数を入力してください。'
    if (!Number.isSafeInteger(draft.quantity) || draft.quantity < 1 || draft.quantity > 99) next.quantity = '数量は1〜99で入力してください。'
    if (!draft.paymentDue || Date.parse(draft.paymentDue) <= Date.now()) next.paymentDue = '未来の支払い予定日時を入力してください。'
    setErrors(next)
    if (Object.keys(next).length === 0) go('/confirm')
  }
  return <div className="page-wrap container"><PageHead eyebrow="NEW REQUEST" title="商品を依頼する" subtitle="Amazonの商品情報を入力してください。見積もりは自動で計算します。" back="/" /><div className="content-grid"><form className="panel form-panel" onSubmit={submit} noValidate><div className="panel-heading"><span className="panel-icon"><ShoppingBag size={20} /></span><div><h2>商品情報</h2><p>商品ページを見ながら入力してください</p></div></div><div className="form-fields"><label>商品名 <span className="required">必須</span><input value={draft.productName} onChange={e => update({ productName: e.target.value })} placeholder="例：ワイヤレスイヤホン" aria-invalid={!!errors.productName} />{errors.productName && <small className="field-error">{errors.productName}</small>}</label><label>Amazon商品URL <span className="required">必須</span><input type="url" value={draft.amazonUrl} onChange={e => update({ amazonUrl: e.target.value })} placeholder="https://www.amazon.co.jp/dp/..." aria-invalid={!!errors.amazonUrl} /><small className="field-help">商品ページのURLを貼り付けてください。自動取得は行いません。</small>{errors.amazonUrl && <small className="field-error">{errors.amazonUrl}</small>}</label><div className="field-row"><label>商品価格（税込・円） <span className="required">必須</span><input type="number" min="1" step="1" value={draft.price || ''} onChange={e => update({ price: Number(e.target.value) })} placeholder="10000" aria-invalid={!!errors.price} />{errors.price && <small className="field-error">{errors.price}</small>}</label><label>数量 <span className="required">必須</span><input type="number" min="1" max="99" step="1" value={draft.quantity} onChange={e => update({ quantity: Number(e.target.value) })} aria-invalid={!!errors.quantity} />{errors.quantity && <small className="field-error">{errors.quantity}</small>}</label></div><label>支払い予定日時 <span className="required">必須</span><input type="datetime-local" value={draft.paymentDue} onChange={e => update({ paymentDue: e.target.value })} aria-invalid={!!errors.paymentDue} />{errors.paymentDue && <small className="field-error">{errors.paymentDue}</small>}</label><label>備考 <span className="optional">任意</span><textarea rows={4} value={draft.notes} onChange={e => update({ notes: e.target.value })} placeholder="カラーやサイズなど、伝えたいことがあれば入力してください" /></label></div><div className="form-actions"><Button type="submit">注文内容を確認する <ArrowRight size={18} /></Button></div></form><aside className="side-stack"><PriceCard price={draft.price} quantity={draft.quantity} /><div className="info-card"><CircleHelp size={20} /><div><strong>ご依頼の前に</strong><p>商品名・価格はAmazonの商品ページをご自身で確認して入力してください。オンライン決済は行いません。注文受付後に担当者が内容を確認します。</p></div></div></aside></div><ServiceNote /></div>
}

function PriceCard({ price, quantity }: { price: number, quantity: number }) {
  const safePrice = Number.isFinite(price) && price > 0 ? price : 0
  const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0
  return <div className="panel price-card"><span className="eyebrow">PRICE SUMMARY</span><h3>料金の内訳</h3><div className="price-line"><span>商品代金 <small>({safeQuantity}点)</small></span><strong>{yen(safePrice * safeQuantity)}</strong></div><div className="price-line"><span>手数料 <small>(10%)</small></span><strong>{yen(feeFor(safePrice, safeQuantity))}</strong></div><div className="price-total"><span>合計金額</span><strong>{yen(totalFor(safePrice, safeQuantity))}</strong></div><p>手数料は商品代金の10%です。端数は1円単位で四捨五入します。</p></div>
}

function ConfirmPage({ draft, onConfirm, busy }: { draft: Draft, onConfirm: () => Promise<void>, busy: boolean }) {
  if (!draft.productName || !isAmazonUrl(draft.amazonUrl) || draft.price <= 0 || draft.quantity < 1 || !draft.paymentDue) return <MissingPage message="注文内容がありません。商品依頼から入力してください。" />
  return <div className="page-wrap container"><PageHead eyebrow="REVIEW REQUEST" title="注文内容を確認" subtitle="内容をご確認のうえ、依頼を確定してください。" back="/request" /><div className="content-grid"><div className="panel review-panel"><div className="panel-heading"><span className="panel-icon"><ClipboardList size={20} /></span><div><h2>ご依頼内容</h2><p>内容に間違いがないかご確認ください</p></div></div><dl className="detail-list"><div><dt>商品名</dt><dd>{draft.productName}</dd></div><div><dt>Amazon商品URL</dt><dd><a href={draft.amazonUrl} target="_blank" rel="noopener noreferrer">商品ページを開く <ArrowUpRight size={15} /></a></dd></div><div><dt>商品価格</dt><dd>{yen(draft.price)}</dd></div><div><dt>数量</dt><dd>{draft.quantity}点</dd></div><div><dt>支払い予定日時</dt><dd>{dateTime(draft.paymentDue)}</dd></div><div><dt>備考</dt><dd>{draft.notes || 'なし'}</dd></div></dl><div className="review-actions"><Button variant="secondary" onClick={() => go('/request')}>内容を修正</Button><Button onClick={onConfirm} disabled={busy}>{busy ? '送信中...' : '注文を確定する'} <Check size={18} /></Button></div></div><aside className="side-stack"><PriceCard price={draft.price} quantity={draft.quantity} /><div className="info-card"><ShieldAlert size={20} /><div><strong>注文依頼について</strong><p>確定すると注文はサーバーに保存され、担当者が内容を確認します。オンライン決済は行いません。</p></div></div></aside></div></div>
}

function EmptyState({ admin = false }: { admin?: boolean }) { return <div className="empty-state"><div className="empty-icon"><Package size={34} /></div><h2>まだ注文がありません</h2><p>商品依頼を作成すると、ここに注文が表示されます。</p><Button onClick={() => go('/request')}>商品を依頼する <ArrowRight size={17} /></Button>{admin && <small>注文はサーバーに保存され、管理者に共有されます。</small>}</div> }

function OrderRow({ order, admin = false }: { order: Order, admin?: boolean }) { return <button className="order-row" onClick={() => go(admin ? `/admin/order/${order.id}` : `/order/${order.id}`)}><span className="order-row-icon"><Package size={22} /></span><span className="order-row-main"><strong>{order.productName}</strong><small>{order.id} · {dateTime(order.createdAt)}</small></span><span className="order-row-side"><Badge status={order.status} /><strong>{yen(order.total)}</strong></span><ChevronRight size={19} className="row-chevron" /></button> }

function HistoryPage({ orders }: { orders: Order[] }) { return <div className="page-wrap container"><PageHead eyebrow="YOUR ORDERS" title="注文履歴" subtitle="ご依頼の内容と進捗をいつでも確認できます。" /><ServiceNote /><div className="panel list-panel"><div className="list-heading"><h2>すべての注文 <span>{orders.length}</span></h2><Button onClick={() => go('/request')}><Plus size={17} /> 新しい依頼</Button></div>{orders.length ? orders.map(order => <OrderRow key={order.id} order={order} />) : <EmptyState />}</div></div> }

function Timeline({ order }: { order: Order }) { const current = statuses.indexOf(order.status); return <div className="timeline">{statuses.map((item, index) => { const event = order.statusEvents?.find(entry => entry.status === item); return <div className={`timeline-item ${index < current ? 'complete' : index === current ? 'current' : ''}`} key={item}><div className="timeline-marker">{index < current ? <Check size={14} /> : index + 1}</div><div className="timeline-copy"><strong>{item}</strong><small>{event ? dateTime(event.createdAt) : index < current ? '通過済み' : index === current ? '現在のステータス' : 'これから'}</small></div></div> })}</div> }

function OrderDetail({ order }: { order: Order }) { return <div className="panel detail-panel"><div className="panel-heading"><span className="panel-icon"><ShoppingBag size={20} /></span><div><h2>注文情報</h2><p>{order.id}</p></div></div><dl className="detail-list"><div><dt>商品名</dt><dd>{order.productName}</dd></div>{order.customerEmail && <div><dt>依頼者メール</dt><dd>{order.customerEmail}</dd></div>}<div><dt>Amazon商品URL</dt><dd><a href={order.amazonUrl} target="_blank" rel="noopener noreferrer">商品ページを開く <ArrowUpRight size={15} /></a></dd></div><div><dt>商品価格</dt><dd>{yen(order.price)}</dd></div><div><dt>数量</dt><dd>{order.quantity}点</dd></div><div><dt>手数料（10%）</dt><dd>{yen(order.fee)}</dd></div><div className="detail-total"><dt>合計金額</dt><dd>{yen(order.total)}</dd></div><div><dt>支払い予定日時</dt><dd>{dateTime(order.paymentDue)}</dd></div><div><dt>備考</dt><dd>{order.notes || 'なし'}</dd></div><div><dt>作成日時</dt><dd>{dateTime(order.createdAt)}</dd></div><div><dt>更新日時</dt><dd>{dateTime(order.updatedAt)}</dd></div></dl></div> }

function OrderPage({ order }: { order: Order }) { return <div className="page-wrap container"><PageHead eyebrow="ORDER DETAIL" title="注文詳細" subtitle={order.id} back="/history" /><div className="order-banner"><div><span>現在のステータス</span><h2>{order.status}</h2><p>進捗は管理者による更新後に反映されます。</p></div><Badge status={order.status} /></div><div className="content-grid"><div className="side-stack"><OrderDetail order={order} /><div className="panel document-links"><h2>書類</h2><button onClick={() => go(`/document/${order.id}/estimate`)}><FileText size={19} /> 見積書を表示 <ChevronRight size={17} /></button><button onClick={() => go(`/document/${order.id}/invoice`)}><CreditCard size={19} /> 請求書を表示 <ChevronRight size={17} /></button></div></div><aside className="panel timeline-panel"><div className="panel-heading"><span className="panel-icon"><Clock3 size={20} /></span><div><h2>進捗タイムライン</h2><p>受け渡しまでの8ステップ</p></div></div><Timeline order={order} /></aside></div><ServiceNote /></div> }

function AdminPage({ orders }: { orders: Order[] }) { const pending = orders.filter(order => statuses.indexOf(order.status) < 2).length; const inProgress = orders.filter(order => statuses.indexOf(order.status) >= 2 && order.status !== '受け渡し完了').length; const done = orders.filter(order => order.status === '受け渡し完了').length; return <div className="page-wrap container"><PageHead eyebrow="ADMIN" title="管理ダッシュボード" subtitle="受け付けた注文を管理します。" /><ServiceNote admin /><div className="stats-grid"><div className="stat-card"><span className="stat-icon"><ClipboardList size={22} /></span><span>すべての注文</span><strong>{orders.length}<small>件</small></strong></div><div className="stat-card"><span className="stat-icon amber"><Clock3 size={22} /></span><span>受付・支払い待ち</span><strong>{pending}<small>件</small></strong></div><div className="stat-card"><span className="stat-icon blue"><Truck size={22} /></span><span>進行中</span><strong>{inProgress}<small>件</small></strong></div><div className="stat-card"><span className="stat-icon green"><CheckCircle2 size={22} /></span><span>受け渡し完了</span><strong>{done}<small>件</small></strong></div></div><div className="panel list-panel"><div className="list-heading"><div><span className="eyebrow">ORDER MANAGEMENT</span><h2>注文一覧 <span>{orders.length}</span></h2></div><Button variant="secondary" onClick={() => go('/request')}><Plus size={17} /> 新しい注文を作成</Button></div>{orders.length ? orders.map(order => <OrderRow key={order.id} order={order} admin />) : <EmptyState admin />}</div></div> }

function AdminOrderPage({ order, changeStatus, issueInvoice }: { order: Order, changeStatus: (id: string, status: Status) => void, issueInvoice: (id: string) => Promise<void> }) { return <div className="page-wrap container"><PageHead eyebrow="MANAGE ORDER" title="注文を管理" subtitle={order.id} back="/admin" /><ServiceNote admin /><div className="content-grid"><div className="side-stack"><OrderDetail order={order} /><div className="panel document-links"><h2>書類を表示</h2><button onClick={() => go(`/document/${order.id}/estimate`)}><FileText size={19} /> 見積書 <ChevronRight size={17} /></button><button onClick={() => issueInvoice(order.id)}><CreditCard size={19} /> 請求書を発行・表示 <ChevronRight size={17} /></button></div></div><aside className="side-stack"><div className="panel status-panel"><div className="panel-heading"><span className="panel-icon"><LayoutDashboard size={20} /></span><div><h2>ステータスを変更</h2><p>注文の進捗を更新します</p></div></div><label>現在のステータス<select value={order.status} onChange={e => changeStatus(order.id, e.target.value as Status)}>{statuses.map(status => <option key={status}>{status}</option>)}</select></label><p>変更内容はサーバーに保存され、利用者に反映されます。</p></div><div className="panel timeline-panel"><h2>進捗タイムライン</h2><Timeline order={order} /></div></aside></div></div> }

function DocumentPage({ order }: { order: Order }) { const title = '概算見積書'; return <div className="page-wrap container document-wrap"><div className="document-toolbar"><button className="back-link" onClick={() => go(`/admin/order/${order.id}`)}><ArrowLeft size={16} /> 注文詳細に戻る</button><Button onClick={() => window.print()}><FileText size={17} /> 印刷 / PDF保存</Button></div><div className="document-page"><div className="document-top"><div><span className="eyebrow">PICOBUY DOCUMENT</span><h1>{title}</h1><p>利用者入力の価格にもとづく概算です。最終金額は担当者が確認します。</p></div><img src={`${iconBase}picobuy-wordmark.png`} alt="PicoBuy" /></div><div className="document-meta"><div><small>注文番号</small><strong>{order.id}</strong></div><div><small>発行日</small><strong>{dateTime(new Date().toISOString())}</strong></div><div><small>支払い予定日時</small><strong>{dateTime(order.paymentDue)}</strong></div></div><h2>明細</h2><div className="document-table"><div className="document-table-head"><span>商品</span><span>数量</span><span>単価</span><span>金額</span></div><div><span>{order.productName}<small>利用者入力の商品情報</small></span><span>{order.quantity}</span><span>{yen(order.price)}</span><span>{yen(order.price * order.quantity)}</span></div><div><span>購入代行手数料（10%）</span><span>1</span><span>{yen(order.fee)}</span><span>{yen(order.fee)}</span></div></div><div className="document-sum"><span>合計金額</span><strong>{yen(order.total)}</strong></div><div className="document-notes"><strong>備考</strong><p>{order.notes || 'なし'}</p></div><div className="document-foot"><span>PicoBuy · 欲しいを、もっと手軽に。</span><span>PICOBUY DOCUMENT</span></div></div></div> }

function InvoiceDocumentPage({ invoice }: { invoice: Invoice }) {
  return <div className="page-wrap container document-wrap">
    <div className="document-toolbar"><button className="back-link" onClick={() => go(`/order/${invoice.orderId}`)}><ArrowLeft size={16} /> 注文詳細に戻る</button><Button onClick={() => window.print()}><FileText size={17} /> 印刷 / PDF保存</Button></div>
    <div className="document-page">
      <div className="document-top"><div><span className="eyebrow">PICOBUY INVOICE</span><h1>請求書</h1><p>請求書番号 {invoice.id}</p></div><img src={`${iconBase}picobuy-wordmark.png`} alt="PicoBuy" /></div>
      <div className="document-meta"><div><small>注文番号</small><strong>{invoice.orderId}</strong></div><div><small>発行日</small><strong>{dateTime(invoice.issuedAt)}</strong></div><div><small>支払い予定日時</small><strong>{dateTime(invoice.paymentDue)}</strong></div></div>
      <div className="invoice-parties"><div><small>宛先</small><strong>{invoice.customerEmail}</strong></div><div><small>発行者</small><strong>{invoice.issuerName}</strong><span>{invoice.issuerAddress}</span><span>{invoice.issuerContact}</span></div></div>
      <h2>明細</h2><div className="document-table"><div className="document-table-head"><span>商品</span><span>数量</span><span>単価</span><span>金額</span></div><div><span>{invoice.productName}</span><span>{invoice.quantity}</span><span>{yen(invoice.price)}</span><span>{yen(invoice.price * invoice.quantity)}</span></div><div><span>購入代行手数料（10%）</span><span>1</span><span>{yen(invoice.fee)}</span><span>{yen(invoice.fee)}</span></div></div>
      <div className="document-sum"><span>合計金額</span><strong>{yen(invoice.total)}</strong></div>
      <div className="invoice-instructions"><strong>お支払い案内</strong><p>{invoice.paymentInstructions}</p><strong>税に関する記載</strong><p>{invoice.issuerTaxDetails}</p></div>
      <div className="document-notes"><strong>備考</strong><p>{invoice.notes || 'なし'}</p></div>
      <div className="document-foot"><span>PicoBuy · 欲しいを、もっと手軽に。</span><span>{invoice.id}</span></div>
    </div>
  </div>
}

function InvoicePendingPage() { return <div className="page-wrap container"><div className="empty-state standalone"><div className="empty-icon"><FileText size={32} /></div><h1>請求書はまだ発行されていません</h1><p>担当者による内容確認後に表示されます。</p><Button onClick={() => go('/history')}>注文履歴に戻る</Button></div></div> }

function MissingPage({ message = 'ページまたは注文が見つかりません。' }: { message?: string }) { return <div className="page-wrap container"><div className="empty-state standalone"><div className="empty-icon"><Bell size={32} /></div><h1>{message}</h1><p>注文データはログインしたアカウントで管理されます。</p><Button onClick={() => go('/')}>ホームに戻る <Home size={17} /></Button></div></div> }

export default App
