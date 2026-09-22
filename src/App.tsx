import { lazy, Suspense, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Activity, ArrowDownRight, ArrowUpRight, CalendarDays, ChartNoAxesCombined, ChevronRight, Download, FileSpreadsheet, Layers3, LogOut, Search, ShieldCheck, TrendingDown, TrendingUp, UsersRound } from 'lucide-react'
import AuthScreen from './components/AuthScreen'
import ImportManager from './components/ImportManager'
import MembersManager from './components/MembersManager'
import type { ChartOption } from './components/Chart'
import Brand from './components/Brand'
import type { Dataset, DatasetVersion } from './types'
import { csvCell, formatChange, formatPrice, monthChange, monthLabel, monthlyMovers, priceAt, quoteLabel, shiftMonth, sortedRows, timeline, type Period } from './lib/analytics'
import type { EChartsType } from 'echarts/core'
import { supabase } from './lib/supabase'
import { useAuth } from './lib/useAuth'
import { useDataset } from './lib/useDataset'

const Chart = lazy(() => import('./components/Chart'))
const chartColors = ['#2864ec', '#0c9bb8', '#8b67cf', '#e69b3a', '#24436a', '#448db0']

function App() {
  const navigate = useNavigate()
  const auth = useAuth()
  const [retryingDataset, setRetryingDataset] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const userId = auth.session?.user.id ?? null
  const { dataset, version, loading, error, connection, refresh } = useDataset(userId)
  const signedIn = Boolean(auth.session)
  const canImport = auth.isAdmin
  const showImportNav = canImport || auth.roleLoading

  async function signOut() {
    if (signingOut) return
    setSigningOut(true); setSignOutError(null)
    try {
      const result = await supabase?.auth.signOut()
      if (result?.error) throw result.error
      navigate('/login')
    } catch { setSignOutError('Could not sign out. Check your connection and try again.') }
    finally { setSigningOut(false) }
  }

  async function retryDataset() {
    setRetryingDataset(true)
    try { await refresh() }
    catch { /* The dataset hook displays the load error. */ }
    finally { setRetryingDataset(false) }
  }

  if (auth.loading) return <p className="app-status">Loading…</p>
  if (auth.recovery) {
    return <AuthScreen recovery onRecovered={auth.finishRecovery} />
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to={signedIn ? '/chart' : '/login'} replace />} />
      <Route
        path="/login"
        element={signedIn ? <Navigate to="/chart" replace /> : <AuthScreen />}
      />
      <Route
        path="/chart"
        element={signedIn ? (
          <Shell canImport={showImportNav} isAdmin={auth.isAdmin} email={auth.session?.user.email} signingOut={signingOut} onSignOut={() => void signOut()}>
            {signOutError && <div className="notice notice-error" role="alert">{signOutError}</div>}
            <Dashboard
              dataset={dataset}
              loading={loading}
              error={error}
              authError={auth.error}
              connection={connection}
              version={version}
              retrying={retryingDataset}
              onRetry={() => void retryDataset()}
              canImport={canImport}
              roleLoading={auth.roleLoading}
            />
          </Shell>
        ) : <Navigate to="/login" replace />}
      />
      <Route
        path="/import"
        element={signedIn && auth.roleLoading ? <p className="app-status">Checking workspace permissions…</p> : signedIn && canImport ? (
          <Shell canImport={showImportNav} isAdmin={auth.isAdmin} email={auth.session?.user.email} signingOut={signingOut} onSignOut={() => void signOut()}>
            {signOutError && <div className="notice notice-error" role="alert">{signOutError}</div>}
            {loading ? <p className="app-status">Loading your dataset…</p> : error && !version ? (
              <div className="notice notice-error" role="alert">
                <p>{error}</p>
                <button type="button" className="button button-secondary" disabled={retryingDataset} onClick={() => void retryDataset()}>
                  {retryingDataset ? 'Retrying…' : 'Retry loading dataset'}
                </button>
              </div>
            ) : <ImportManager
              key={userId}
              version={version}
              onPublished={refresh}
            />}
          </Shell>
        ) : <Navigate to={signedIn ? '/chart' : '/login'} replace />}
      />
      <Route
        path="/members"
        element={signedIn && auth.roleLoading ? <p className="app-status">Checking workspace permissions…</p> : signedIn && canImport ? (
          <Shell canImport={showImportNav} isAdmin={auth.isAdmin} email={auth.session?.user.email} signingOut={signingOut} onSignOut={() => void signOut()}>
            {signOutError && <div className="notice notice-error" role="alert">{signOutError}</div>}
            <MembersManager />
          </Shell>
        ) : <Navigate to={signedIn ? '/chart' : '/login'} replace />}
      />
      <Route path="*" element={<Navigate to={signedIn ? '/chart' : '/login'} replace />} />
    </Routes>
  )
}


function Shell({
  canImport, isAdmin, email, signingOut, onSignOut, children,
}: {
  canImport: boolean
  isAdmin: boolean
  email?: string
  signingOut: boolean
  onSignOut: () => void
  children: ReactNode
}) {
  const location = useLocation()
  const importing = location.pathname === '/import'
  const viewingMembers = location.pathname === '/members'
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">Skip to content</a>
      <aside className="app-sidebar">
        <Link to="/chart" className="brand-link sidebar-brand" aria-label="Forma home"><Brand /></Link>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav aria-label="Main navigation" className="workspace-nav">
          <NavLink to="/chart"><ChartNoAxesCombined size={20} /><span>Overview</span><ChevronRight size={15} className="nav-chevron" /></NavLink>
          {canImport && <NavLink to="/import"><FileSpreadsheet size={20} /><span>Import data</span><ChevronRight size={15} className="nav-chevron" /></NavLink>}
          {canImport && <NavLink to="/members"><UsersRound size={20} /><span>Members</span><ChevronRight size={15} className="nav-chevron" /></NavLink>}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-note"><span className="workspace-note-icon"><Layers3 size={23} /></span><strong>A clearer view,<br />month by month.</strong><p>One place for your team’s material intelligence.</p><span className="workspace-note-rule" /></div>
          <div className="sidebar-footer"><ShieldCheck size={15} /><span>Your team’s workspace</span></div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="app-topbar">
          <Link to="/chart" className="brand-link mobile-brand" aria-label="Forma home"><Brand compact /></Link>
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{viewingMembers ? 'Members' : importing ? 'Import data' : 'Overview'}</strong></div>
          <div className="account-menu"><span className="account-role"><ShieldCheck size={14} />{isAdmin ? 'Administrator' : 'Viewer'}</span><span className="account-avatar" title={email ?? 'Your account'} aria-label={email ?? 'Your account'}>{email?.charAt(0).toUpperCase() || 'F'}</span><button type="button" className="signout-button" aria-label="Sign out" disabled={signingOut} onClick={onSignOut}><LogOut size={18} /><span>{signingOut ? 'Signing out…' : 'Sign out'}</span></button></div>
        </header>
        <main className="app-main" id="workspace-content">{children}<footer className="workspace-footer"><span>Forma · Material intelligence</span><span>Clarity for your next decision.</span></footer></main>
      </div>
    </div>
  )
}

function Dashboard({
  dataset, loading, error, authError, connection, version, retrying, onRetry, canImport, roleLoading,
}: {
  dataset: Dataset | null
  loading: boolean
  error: string | null
  authError: string | null
  connection: 'connecting' | 'live' | 'offline'
  version: DatasetVersion | null
  retrying: boolean
  onRetry: () => void
  canImport: boolean
  roleLoading: boolean
}) {
  const [period, setPeriod] = useState<Period>('1Y')
  const [chartType, setChartType] = useState<'line' | 'area' | 'bar'>('line')
  const [chosenIds, setChosenIds] = useState<string[]>([])
  const [showAllSeries, setShowAllSeries] = useState(false)
  const [materialQuery, setMaterialQuery] = useState('')
  const chartInstance = useRef<EChartsType | null>(null)
  const rows = useMemo(() => sortedRows(dataset?.rows ?? []), [dataset])
  const availableSeries = useMemo(() => dataset?.series ?? [], [dataset])
  const defaultIds = useMemo(() => availableSeries.slice(0, 4).map((series) => series.id), [availableSeries])
  const activeIds = useMemo(() => {
    const available = new Set(availableSeries.map((series) => series.id))
    const selected = chosenIds.filter((id) => available.has(id)).slice(0, 4)
    return selected.length ? selected : defaultIds
  }, [availableSeries, chosenIds, defaultIds])
  const latest = rows.at(-1)
  const latestMonth = latest?.month ?? ''
  const priceLines = useMemo(() => {
    if (!dataset || !latestMonth || !activeIds.length) return null
    const months = timeline(dataset.rows, latestMonth, period)
    if (!months.length) return null
    const selected = activeIds.flatMap((id) => {
      const series = dataset.series.find((item) => item.id === id)
      return series ? [{ series, values: months.map((month) => priceAt(dataset.rows, series.id, month)) }] : []
    })
    return selected.length ? { months, series: selected } : null
  }, [activeIds, dataset, latestMonth, period])
  const chartLines = priceLines
  const option = useMemo<ChartOption | null>(() => {
    if (!chartLines) return null
    const labels = chartLines.series.map((item) => `${item.series.name} (${quoteLabel(item.series)})`)
    return {
      color: chartLines.series.map((item) => chartColors[availableSeries.findIndex((series) => series.id === item.series.id) % chartColors.length]),
      textStyle: { fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' },
      tooltip: {
        trigger: 'axis' as const,
        confine: true,
        backgroundColor: '#fff', borderColor: '#e4eaf3', padding: [12, 16],
        textStyle: { color: '#293c59', fontSize: 12 },
        valueFormatter: (value) => typeof value === 'number' ? formatPrice(value) : '—',
      },
      legend: { type: 'scroll' as const, bottom: 0, data: labels, icon: 'roundRect', itemWidth: 12, itemHeight: 4, textStyle: { color: '#66758d', fontSize: 11 } },
      grid: { left: 12, right: 28, top: 46, bottom: 56, outerBoundsMode: 'same' as const, outerBoundsContain: 'axisLabel' as const },
      xAxis: { type: 'category' as const, boundaryGap: chartType === 'bar', data: chartLines.months.map((month) => monthLabel(month, true)), axisLine: { lineStyle: { color: '#e5ebf4' } }, axisTick: { show: false }, axisLabel: { color: '#70819a', fontSize: 11, margin: 14 } },
      yAxis: { type: 'value' as const, name: 'Price', scale: true, nameTextStyle: { color: '#70819a', padding: [0, 0, 6, 0] }, axisLabel: { color: '#70819a', fontSize: 11 }, splitLine: { lineStyle: { color: '#eaf0f7', type: 'dashed' as const } } },
      series: chartLines.series.map((item, index) => ({
        type: chartType === 'bar' ? 'bar' as const : 'line' as const,
        name: labels[index],
        data: item.values,
        connectNulls: false,
        showSymbol: true,
        symbolSize: 7,
        barMaxWidth: 22,
        barGap: '12%',
        lineStyle: { width: 2.5 },
        areaStyle: chartType === 'area' ? { opacity: 0.14 } : undefined,
        smooth: chartType === 'bar' ? 0 : 0.15,
        label: {
          show: true,
          position: 'top' as const,
          fontSize: 10,
          fontWeight: 600,
          color: '#3d5473',
          formatter: (params: { value?: unknown }) => typeof params.value === 'number' ? formatPrice(params.value) : '',
        },
        labelLayout: { hideOverlap: false, moveOverlap: 'shiftY' as const },
      })),
    }
  }, [availableSeries, chartLines, chartType])
  const movers = useMemo(() => latestMonth && dataset ? monthlyMovers(dataset, latestMonth).slice(0, 5) : [], [dataset, latestMonth])
  const latestSeries = availableSeries
  const visibleSeries = materialQuery.trim()
    ? availableSeries.filter(series => `${series.name} ${series.currency} ${series.unit}`.toLowerCase().includes(materialQuery.trim().toLowerCase()))
    : showAllSeries ? availableSeries : availableSeries.filter((series, index) => index < 8 || activeIds.includes(series.id))
  const statusLabel = connection === 'live' ? 'Live updates' : connection === 'offline' ? 'Updates paused' : 'Connecting'

  function toggleSeries(id: string) {
    const next = activeIds.includes(id) ? activeIds.filter((item) => item !== id) : [...activeIds, id].slice(-4)
    if (next.length) setChosenIds(next)
  }

  function downloadCsv() {
    if (!dataset) return
    const header = ['Month', ...dataset.series.map((series) => `${series.name} (${series.currency}/${series.unit})`)]
    const body = rows.map((row) => [row.month, ...dataset.series.map((series) => row.values[series.id])])
    const csv = [header, ...body].map((line) => line.map((value) => csvCell(value as string | number | null)).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `material-prices-${latestMonth || 'dataset'}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const handleChartReady = useCallback((chart: EChartsType | null) => {
    chartInstance.current = chart
  }, [])

  function downloadChart() {
    const image = chartInstance.current?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' })
    if (!image) return
    const link = document.createElement('a')
    link.href = image
    link.download = `material-price-chart-${latestMonth || 'dataset'}.png`
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  if (loading && !dataset) return <div className="dashboard-empty"><Activity className="spin" size={22} /><p>Loading your dataset…</p></div>
  if (!dataset || !latest) {
    if (error) return (
      <div className="notice notice-error" role="alert">
        <p>{error}</p>
        <button type="button" className="button button-secondary" disabled={retrying} onClick={onRetry}>
          {retrying ? 'Retrying…' : 'Retry loading dataset'}
        </button>
      </div>
    )
    return (
      <div className="dashboard-empty">
        <Layers3 size={24} />
        <h2>No dataset yet</h2>
        {authError && <p className="notice notice-warning" role="status">{authError}</p>}
        {roleLoading ? <p>Checking whether you can publish a workbook…</p> : canImport ? (
          <>
            <p>This workspace has no published prices yet. Import an Excel workbook to create the first live dataset.</p>
            <Link to="/import" className="button button-primary">Import workbook<ArrowUpRight size={16} /></Link>
          </>
        ) : (
          <p>Your team’s prices will appear here once an administrator publishes the first workbook.</p>
        )}
      </div>
    )
  }

  const biggestMover = movers[0]
  const previousMonth = shiftMonth(latestMonth, -1)

  return (
    <section className="dashboard-page">
      {authError && <div className="notice notice-warning" role="status">{authError}</div>}
      {error && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
          <button type="button" className="button button-secondary" disabled={retrying} onClick={onRetry}>
            {retrying ? 'Retrying…' : 'Retry loading dataset'}
          </button>
        </div>
      )}
      <div className="page-heading dashboard-heading">
        <div>
          <span className="eyebrow">THE BIGGER PICTURE</span>
          <h1>Material prices</h1>
          <p className="muted">Track the changes. Make your next move with confidence.</p>
        </div>
        <div className="dashboard-heading-actions">
          <span className={`connection-pill connection-${connection}`}><span className="status-dot" />{statusLabel}</span>
          <button type="button" className="button button-secondary" onClick={downloadCsv}><Download size={16} />Export CSV</button>
        </div>
      </div>

      <div className="stat-grid">
        <article className="stat-card stat-card-featured"><span className="stat-icon"><CalendarDays size={19} /></span><div><span className="stat-label">Reporting month</span><strong>{monthLabel(latestMonth)}</strong><small>{version ? <>Updated {new Date(version.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}{version.created_by_name ? ` · by ${version.created_by_name}` : ''}</> : 'Latest published data'}</small></div></article>
        <article className="stat-card"><span className="stat-icon"><Layers3 size={18} /></span><div><span className="stat-label">Tracked series</span><strong>{dataset.series.length}</strong><small>{dataset.series.filter((series) => series.category !== 'FX').length} material quotes · {dataset.series.filter((series) => series.category === 'FX').length} FX</small></div></article>
        <article className="stat-card"><span className="stat-icon"><Activity size={18} /></span><div><span className="stat-label">Data coverage</span><strong>{rows.length} months</strong><small>{monthLabel(rows[0].month, true)} – {monthLabel(latestMonth, true)}</small></div></article>
        <article className="stat-card"><span className={`stat-icon ${biggestMover?.change && biggestMover.change < 0 ? 'tone-negative' : 'tone-positive'}`}>{biggestMover?.change && biggestMover.change < 0 ? <TrendingDown size={18} /> : <TrendingUp size={18} />}</span><div><span className="stat-label">Largest monthly move</span><strong>{biggestMover ? formatChange(biggestMover.change) : '—'}</strong><small>{biggestMover ? biggestMover.series.name : 'No comparable THB quote'}</small></div></article>
      </div>

      <section className="panel chart-panel">
        <div className="section-heading chart-heading">
          <div>
            <span className="eyebrow">PRICE EXPLORER</span>
            <h2>A closer look at the movement.</h2>
            <p className="muted small">Compare published prices, in their original units.</p>
          </div>
          <div className="chart-controls">
            <div className="period-control" role="group" aria-label="Chart type">
              {(['line', 'area', 'bar'] as const).map((type) => (
                <button key={type} type="button" className={chartType === type ? 'active' : ''} aria-pressed={chartType === type} onClick={() => setChartType(type)}>
                  {type === 'line' ? 'Line' : type === 'area' ? 'Area' : 'Bar'}
                </button>
              ))}
            </div>
            <button type="button" className="button button-secondary chart-download" disabled={!option} onClick={downloadChart}><Download size={16} />Download chart</button>
            <div className="period-control" role="group" aria-label="Chart period">{(['6M', '1Y', 'All'] as Period[]).map((item) => <button key={item} type="button" className={period === item ? 'active' : ''} aria-pressed={period === item} onClick={() => setPeriod(item)}>{item}</button>)}</div>
          </div>
        </div>
        <div className="series-toolbar">
          <div className="series-toolbar-heading"><span className="control-label">Materials <span>{activeIds.length} / 4 selected</span></span><div className="material-search"><Search size={15} /><input aria-label="Search materials" placeholder="Find a material…" value={materialQuery} onChange={event => setMaterialQuery(event.target.value)} /></div></div>
          <div className="series-picker">
            <div className="series-chips" id="comparison-series">{visibleSeries.map((series) => <button key={series.id} type="button" className={`series-chip ${activeIds.includes(series.id) ? 'selected' : ''}`} data-tone={availableSeries.indexOf(series) % 6} aria-pressed={activeIds.includes(series.id)} onClick={() => toggleSeries(series.id)}><span className="series-dot" />{series.name}<small>{series.currency}/{series.unit}</small></button>)}</div>
            {!visibleSeries.length && <p className="empty-inline">No materials match “{materialQuery}”.</p>}
            {!materialQuery.trim() && availableSeries.length > 8 && <button type="button" className="text-button series-expand" aria-expanded={showAllSeries} aria-controls="comparison-series" onClick={() => setShowAllSeries((shown) => !shown)}>{showAllSeries ? 'Show fewer series' : `Show all ${availableSeries.length} series`}<ChevronRight size={14} /></button>}
          </div>
        </div>
        {option ? <Suspense fallback={<div className="chart-loading" role="status">Loading chart…</div>}><Chart option={option} label="Published material prices" height={400} onReady={handleChartReady} /></Suspense> : <div className="chart-empty"><Layers3 size={22} /><p>There are no prices to chart for the selected series.</p><small>Choose a different combination to compare them.</small></div>}
        {latestMonth && <p className="chart-footnote">Latest month: <strong>{monthLabel(latestMonth)}</strong> uses the same quotes as the Latest prices table.</p>}
      </section>

      <div className="dashboard-lower-grid">
        <section className="panel movers-panel"><div className="section-heading"><div><span className="eyebrow">MONTHLY SIGNAL</span><h2>Biggest movers</h2><p className="muted small">Largest changes since {monthLabel(previousMonth, true)}.</p></div><span className="section-icon"><TrendingUp size={19} /></span></div>{movers.length ? <div className="mover-list">{movers.map((mover) => <div className="mover-row" key={mover.series.id}><div className="mover-name"><span className={`mover-badge ${mover.change >= 0 ? 'positive' : 'negative'}`}>{mover.change >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}</span><div><strong>{mover.series.name}</strong><small>{mover.series.currency} / {mover.series.unit}</small></div></div><div className="mover-value"><strong className={mover.change >= 0 ? 'positive-text' : 'negative-text'}>{formatChange(mover.change)}</strong><small>{formatPrice(mover.value)}</small></div></div>)}</div> : <p className="empty-inline">No comparable month-over-month material movements.</p>}</section>
        <section className="panel prices-panel">
          <div className="section-heading"><div><span className="eyebrow">LATEST SNAPSHOT</span><h2>Latest prices</h2><p className="muted small">Primary quotes for the latest reporting month. A dash means no observation.</p></div><span className="pill">{monthLabel(latestMonth, true)}</span></div>
          <div className="price-table-wrap"><table className="price-table" id="latest-prices"><thead><tr><th>Material</th><th>Category</th><th>Price</th><th>MoM</th></tr></thead><tbody>{latestSeries.map((series) => { const value = latest.values[series.id]; const change = monthChange(rows, series.id, latestMonth); return <tr key={series.id}><td><strong>{series.name}</strong><small>{series.currency} / {series.unit}</small></td><td><span className={`category-tag category-${series.category.toLowerCase()}`}>{series.category}</span></td><td>{formatPrice(value)}</td><td className={change === null ? 'muted' : change >= 0 ? 'positive-text' : 'negative-text'}>{formatChange(change)}</td></tr> })}</tbody></table></div>
        </section>
      </div>
    </section>
  )
}

export default App
