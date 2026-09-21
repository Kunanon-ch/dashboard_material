export default function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`brand-lockup${compact ? ' brand-compact' : ''}`}>
    <span className="brand-symbol" aria-hidden="true">
      <svg viewBox="0 0 28 28" fill="none"><path d="M6 22V6h16v5H11v3h9v5h-9v3H6Z" fill="currentColor" /></svg>
    </span>
    <span className="brand-wordmark">forma<span>.</span></span>
  </span>
}
