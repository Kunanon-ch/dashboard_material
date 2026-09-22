import { useEffect, useRef, useState } from 'react'
import { Check, FileSpreadsheet, History, RotateCcw, Upload, X, ArrowRight, AlertCircle, ShieldCheck, CheckCheck } from 'lucide-react'
import type { DatasetVersion, ParsedWorkbook } from '../types'
import { parseUpload } from '../lib/parseUpload'
import { supabase } from '../lib/supabase'

interface Props {
  version: DatasetVersion | null
  onPublished: () => Promise<void>
  preview?: boolean
  onPreviewPublish?: (dataset: ParsedWorkbook['dataset'], filename: string, sheetName: string) => void
}
const formatMonth = (month: string) => new Date(`${month}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })

export default function ImportManager({ version, onPublished, preview = false, onPreviewPublish }: Props) {
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [expectedVersion, setExpectedVersion] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [dragging, setDragging] = useState(false)
  const [history, setHistory] = useState<DatasetVersion[]>([])
  const [historyError, setHistoryError] = useState('')
  const [restore, setRestore] = useState<{ target: DatasetVersion; expected: string | null } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  const [historyPage, setHistoryPage] = useState(0)
  const [historyMore, setHistoryMore] = useState(false)
  const [historyRevision, setHistoryRevision] = useState(0)

  useEffect(() => () => { request.current++ }, [])
  useEffect(() => {
    if (preview || !supabase) return
    let active = true
    void supabase.from('dataset_versions').select('id,filename,sheet_name,created_at,created_by,created_by_name,row_count,series_count')
      .order('created_at', { ascending: false }).range(historyPage * 10, historyPage * 10 + 10)
      .then(({ data, error: loadError }) => {
        if (!active) return
        if (loadError) setHistoryError('Could not load upload history. Please refresh.')
        else { setHistoryError(''); setHistory((data ?? []).slice(0, 10) as DatasetVersion[]); setHistoryMore((data?.length ?? 0) > 10) }
      })
    return () => { active = false }
  }, [preview, version?.id, historyPage, historyRevision])

  async function selectFile(next?: File) {
    if (!next || busy) return
    // Let choosing the same workbook again trigger change after a stale review or error.
    if (input.current) input.current.value = ''
    const current = ++request.current
    setFile(next); setParsed(null); setError(''); setSuccess(''); setReading(true)
    setExpectedVersion(version?.id ?? null)
    try { const result = await parseUpload(next); if (current === request.current) setParsed(result) }
    catch (cause) { if (current === request.current) setError(cause instanceof Error ? cause.message : 'Unable to read this file.') }
    finally { if (current === request.current) setReading(false) }
  }
  const stale = Boolean(parsed && expectedVersion !== (version?.id ?? null))
  async function publish() {
    if (!parsed || !file || stale || busy) return
    setBusy(true); setError(''); setSuccess('')
    try {
      if (preview) {
        onPreviewPublish?.(parsed.dataset, file.name, parsed.sheetName)
        setSuccess('Preview updated in this browser.')
        setParsed(null); setFile(null); if (input.current) input.current.value = ''
        return
      }
      if (!supabase) throw new Error('The workspace is not connected. Contact your administrator.')
      const result = await supabase.rpc('publish_dataset', { p_filename: file.name, p_sheet_name: parsed.sheetName, p_payload: parsed.dataset, p_expected_version: expectedVersion })
      if (result.error) throw new Error(result.error.code === '40001' ? 'Another admin published a new version. Refresh and select your file again.' : result.error.message)
      setHistoryPage(0)
      setHistoryRevision((revision) => revision + 1)
      setSuccess('Dataset published. Connected dashboards will refresh automatically.')
      try { await onPublished() }
      catch { setError('The dataset was published, but this dashboard could not reload it. Refresh the page to see the active version.') }
      setParsed(null); setFile(null); if (input.current) input.current.value = ''
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not confirm the upload. Refresh and check the active version before trying again.') }
    finally { setBusy(false) }
  }
  async function restoreVersion() {
    if (!restore || !supabase || busy) return
    setBusy(true); setError(''); setSuccess('')
    try {
      const result = await supabase.rpc('restore_dataset', { p_version_id: restore.target.id, p_expected_version: restore.expected })
      if (result.error) throw new Error(result.error.code === '40001' ? 'The active dataset changed. Refresh and review the version again.' : result.error.message)
      setRestore(null)
      setHistoryRevision((revision) => revision + 1)
      setSuccess('Previous dataset restored. All upload versions have been preserved.')
      try { await onPublished() }
      catch { setError('The version was restored, but this dashboard could not reload it. Refresh the page to see the active version.') }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not restore this version.') }
    finally { setBusy(false) }
  }
  const stage = busy || success ? 2 : parsed ? 1 : 0
  return <div className="imports-page">
    <div className="page-heading">
      <div><span className="eyebrow">KEEP YOUR TEAM IN THE KNOW</span><h1>Import data</h1><p className="muted">From your latest workbook to everyone’s dashboard.</p></div>
      <span className="pill admin-badge"><ShieldCheck size={15} />Admin workspace</span>
    </div>

    <ol className="import-steps" aria-label="Import progress">
      {['Upload workbook', 'Review your data', 'Publish update'].map((label, index) => <li key={label} className={index === stage ? 'is-current' : index < stage ? 'is-complete' : ''} aria-current={index === stage ? 'step' : undefined}><span className="import-step-number">{index < stage ? <Check size={16} /> : index + 1}</span><div><small>STEP 0{index + 1}</small><strong>{label}</strong></div>{index < 2 && <ArrowRight size={16} className="step-arrow" />}</li>)}
    </ol>

    {error && <div className="notice notice-error" role="alert"><AlertCircle size={18} />{error}</div>}
    {success && <div className="notice notice-success" role="status"><CheckCheck size={18} />{success}</div>}

    <div className="import-grid">
      <section className="panel upload-panel">
        <div className="section-heading"><div className="section-heading-with-icon"><span className="section-icon"><Upload size={20} /></span><div><h2>Upload your workbook</h2><p className="muted small">Choose the Excel file with your latest material prices.</p></div></div><span className="file-type-tag">XLSX</span></div>
        <div className={`drop-zone ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void selectFile(event.dataTransfer.files[0]) }}>
          <span className="upload-symbol"><FileSpreadsheet size={30} /><span><Upload size={12} /></span></span>
          <h3>{reading ? 'Reading your workbook…' : 'Your next update starts here'}</h3>
          <p>Drop your Excel file, or choose one from your device.</p>
          <input ref={input} id="workbook-upload" type="file" accept=".xlsx" className="visually-hidden" tabIndex={-1} aria-label="Excel workbook" disabled={busy || reading} onChange={event => void selectFile(event.target.files?.[0])} />
          <button type="button" className="button button-primary" disabled={busy || reading} onClick={() => input.current?.click()}>{reading ? 'Reading workbook…' : 'Choose workbook'}<ArrowRight size={16} /></button>
          <small>.xlsx format <span>·</span> Up to 5 MB</small>
        </div>

        {file && <div className="selected-file"><span className="selected-file-icon"><FileSpreadsheet size={23} /></span><div><strong title={file.name}>{file.name}</strong><span>{(file.size / 1024).toFixed(1)} KB · {reading ? 'Validating…' : parsed ? 'Ready to review' : 'Needs attention'}</span></div><button className="icon-button" aria-label="Remove selected workbook" disabled={busy || reading} onClick={() => { request.current++; setParsed(null); setFile(null); setError(''); if (input.current) input.current.value = '' }}><X size={18} /></button></div>}

        {parsed && <div className="import-preview">
          <div className="section-heading"><h3>Workbook preview</h3><span className="pill pill-green"><Check size={13} />Validated</span></div>
          <div className="import-summary"><div><strong>{parsed.dataset.rows.length}</strong><span>Months</span></div><div><strong>{parsed.dataset.series.length}</strong><span>Price series</span></div><div><strong title={parsed.sheetName}>{parsed.sheetName}</strong><span>Worksheet</span></div></div>
          <p className="small muted">{formatMonth(parsed.dataset.rows[0].month)} – {formatMonth(parsed.dataset.rows.at(-1)!.month)}</p>
          <div className="preview-table-wrap"><table className="preview-table" role="table"><thead><tr><th scope="col">Month</th>{parsed.dataset.series.slice(0, 3).map(series => <th scope="col" key={series.id}>{series.name}<small>{series.currency}/{series.unit}</small></th>)}</tr></thead><tbody role="rowgroup">{parsed.dataset.rows.slice(-3).map(row => <tr key={row.month} role="row"><td role="cell" data-label="Month">{formatMonth(row.month)}</td>{parsed.dataset.series.slice(0, 3).map(series => <td role="cell" key={series.id} data-label={`${series.name} · ${series.currency}/${series.unit}`}><span>{row.values[series.id]?.toLocaleString('en-GB', { maximumFractionDigits: 3 }) ?? '—'}</span></td>)}</tr>)}</tbody></table></div>
          {parsed.warnings.length > 0 && <div className="notice notice-warning"><AlertCircle size={17} /><div><strong>A few things to review</strong><ul>{parsed.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div></div>}
          {stale && <div className="notice notice-warning" role="status">A newer dataset is active. Select the file again to review before publishing.</div>}
          <div className="publish-footer"><p><ShieldCheck size={16} />{preview ? 'This preview stays in your browser.' : 'Previous versions stay safely in your history.'}</p><button className="button button-primary" disabled={busy || stale} onClick={() => void publish()}>{busy ? (preview ? 'Applying…' : 'Publishing…') : (preview ? 'Apply to preview' : 'Publish dataset')}<ArrowRight size={17} /></button></div>
        </div>}
      </section>

      <aside className="import-aside">
        <div className="panel import-guide"><span className="eyebrow">A LITTLE PREPARATION</span><h2>Set up for a smooth import.</h2><p className="muted small">A quick check before you upload.</p><ol className="workflow-list"><li><span><Check size={13} /></span><div><strong>Keep your column headers</strong><p>Use the same material names and units as your original workbook.</p></div></li><li><span><Check size={13} /></span><div><strong>Recalculate, then save</strong><p>Save your latest formulas in Excel so every price is up to date.</p></div></li><li><span><Check size={13} /></span><div><strong>Leave missing prices blank</strong><p>Empty cells stay as gaps, keeping the picture accurate.</p></div></li></ol></div>
        <div className="import-note"><span className="import-note-icon"><History size={23} /></span><div><h3>Every version, preserved.</h3><p>Publish with confidence. You can restore an earlier upload whenever you need it.</p></div><ShieldCheck size={54} className="import-note-art" aria-hidden="true" /></div>
      </aside>
    </div>

    <section className="panel history-panel">
      <div className="section-heading"><div className="section-heading-with-icon"><span className="section-icon"><History size={20} /></span><div><h2>Upload history</h2><p className="muted small">Every update, in one place.</p></div></div><span className="pill">Version history</span></div>
      {historyError && <p className="notice notice-error" role="alert">{historyError}</p>}
      {history.length === 0 ? <div className="history-empty"><History size={26} /><strong>Your updates will live here</strong><p>Publish your first workbook to start building your version history.</p></div> : <>
        <div className="history-table-wrap"><table className="history-table" role="table"><thead><tr><th scope="col">Workbook</th><th scope="col">Uploaded by</th><th scope="col">Published</th><th scope="col">Coverage</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead><tbody role="rowgroup">{history.map(item => <tr key={item.id} role="row">
          <td role="cell" className="history-filename" data-label="Workbook"><FileSpreadsheet size={18} /><span title={item.filename}>{item.filename}</span></td>
          <td role="cell" data-label="Uploaded by"><span className="history-uploader">{item.created_by_name ?? 'Name not recorded'}<small>{item.created_by ? `Admin · ${item.created_by.slice(0, 8)}` : 'Administrator'}</small></span></td>
          <td role="cell" data-label="Published">{new Date(item.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
          <td role="cell" data-label="Coverage">{item.row_count} months · {item.series_count} series</td>
          <td role="cell" data-label="Status"><span className={`pill ${item.id === version?.id ? 'pill-green' : ''}`}>{item.id === version?.id && <span className="status-dot" />}{item.id === version?.id ? 'Active' : 'Archived'}</span></td>
          <td role="cell" className="history-action">{item.id !== version?.id && <button className="button button-secondary button-small" disabled={busy} onClick={() => setRestore({ target: item, expected: version?.id ?? null })}><RotateCcw size={14} />Restore</button>}</td>
        </tr>)}</tbody></table></div>
        <div className="history-pagination"><span className="small muted">Page {historyPage + 1}</span><div><button className="button button-secondary button-small" disabled={historyPage === 0} onClick={() => setHistoryPage(p => p - 1)}>Previous</button><button className="button button-secondary button-small" disabled={!historyMore} onClick={() => setHistoryPage(p => p + 1)}>Next</button></div></div>
      </>}
      {restore && <div className="restore-confirm" role="region" aria-label="Confirm restore"><div><strong>Restore {restore.target.filename}?</strong><p>This changes the active dataset for all viewers. Both versions will remain in history.</p></div><button className="button button-secondary" disabled={busy} onClick={() => setRestore(null)}>Cancel</button><button className="button button-primary" disabled={busy} onClick={() => void restoreVersion()}>{busy ? 'Restoring…' : 'Confirm restore'}</button></div>}
    </section>
  </div>
}
