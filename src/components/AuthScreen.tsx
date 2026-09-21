import { useState, type FormEvent } from 'react'
import { ArrowRight, ChartNoAxesCombined, Check, ChevronLeft, Eye, EyeOff, Layers3, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import Brand from './Brand'
import { configurationError, supabase } from '../lib/supabase'

interface Props { recovery?: boolean; onRecovered?: () => void }

export default function AuthScreen({ recovery, onRecovered }: Props) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (recovery) {
        const result = await supabase.auth.updateUser({ password })
        if (result.error) throw result.error
        onRecovered?.()
      } else if (mode === 'login') {
        const result = await supabase.auth.signInWithPassword({ email, password })
        if (result.error) throw result.error
      } else if (mode === 'signup') {
        const result = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
        if (result.error) throw result.error
        setNotice('Check your email to confirm your account, then sign in. If you already have an account, use Sign in or reset your password.')
      } else {
        const result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        if (result.error) throw result.error
        setNotice('If an account exists for this email, you will receive a password reset link.')
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.') }
    finally { setBusy(false) }
  }

  function changeMode(next: typeof mode) { setMode(next); setError(''); setNotice(''); setPassword(''); setVisible(false) }
  const title = configurationError ? 'Your workspace awaits.' : recovery ? 'Set a new password' : mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Forgot your password?' : 'Welcome back.'

  return <main className="auth-layout">
    <section className="auth-story">
      <a className="brand-link" href="/" aria-label="Forma home"><Brand /></a>
      <div className="auth-story-copy">
        <span className="auth-kicker"><span /> THE MATERIAL INTELLIGENCE WORKSPACE</span>
        <h1>A clearer view.<br /><span>A smarter next move.</span></h1>
        <p>Turn monthly material prices into perspective. Everything your team needs to see the change and plan ahead.</p>
      </div>
      <div className="auth-art" aria-hidden="true">
        <div className="art-orbit art-orbit-outer" /><div className="art-orbit art-orbit-inner" />
        <div className="art-sheet art-sheet-back" />
        <div className="art-sheet art-sheet-middle" />
        <div className="art-sheet art-sheet-front">
          <div className="art-sheet-top"><span className="art-sheet-icon"><Layers3 size={22} /></span><span className="art-sheet-tag">ONE CONNECTED VIEW</span><span className="art-sheet-dots">•••</span></div>
          <div className="art-sheet-heading">Clarity in every change.</div>
          <div className="art-chart"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
          <div className="art-sheet-footer"><span><span className="art-check"><Check size={12} /></span> Your team. In sync.</span><ChartNoAxesCombined size={19} /></div>
        </div>
        <span className="art-float"><ShieldCheck size={18} /> A shared source of truth</span>
      </div>
      <div className="auth-benefits"><span><ChartNoAxesCombined size={18} />Follow every price movement</span><span><Layers3 size={18} />Keep your team aligned</span></div>
      <footer><span>Built for informed decisions.</span><span>FORMA · MATERIAL INTELLIGENCE</span></footer>
    </section>

    <section className="auth-form-wrap">
      <div className="auth-form-inner">
        <div className="auth-form-icon"><LockKeyhole size={23} /></div>
        <span className="eyebrow">YOUR WORKSPACE, CONNECTED</span>
        <h2>{title}</h2>
        <p className="muted">{configurationError ? 'Your team’s material intelligence is almost ready.' : recovery ? 'Choose a new password to secure your account.' : mode === 'signup' ? 'One account. A shared view of your material prices.' : mode === 'reset' ? 'Enter your email and we’ll send you a reset link.' : 'Sign in to stay one step ahead of your material prices.'}</p>

        {configurationError ? <div className="setup-card"><ShieldCheck size={24} /><h3>Workspace setup in progress</h3><p>Contact your workspace administrator to finish connecting your account.</p></div> : <form onSubmit={submit} className="auth-form">
          {!recovery && <label htmlFor="auth-email">Email address<div className="input-with-icon"><Mail size={18} /><input id="auth-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" disabled={busy} required /></div></label>}
          {(mode !== 'reset' || recovery) && <div className="password-field"><div className="password-label"><label htmlFor="auth-password">Password</label>{mode === 'login' && !recovery && <button type="button" className="text-button" disabled={busy} onClick={() => changeMode('reset')}>Forgot password?</button>}</div><div className="input-with-icon"><LockKeyhole size={18} /><input id="auth-password" type={visible ? 'text' : 'password'} autoComplete={mode === 'signup' || recovery ? 'new-password' : 'current-password'} minLength={mode === 'signup' || recovery ? 8 : 1} value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" disabled={busy} required /><button type="button" className="icon-button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>}
          {(mode === 'signup' || recovery) && <small className="password-hint">Use at least 8 characters.</small>}
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          {notice && <div className="notice notice-success" role="status">{notice}</div>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Please wait…' : recovery ? 'Save password' : mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}<ArrowRight size={18} /></button>
        </form>}

        {!configurationError && !recovery && <p className="auth-switch">{mode === 'login' ? <>New to Forma? <button className="text-button" disabled={busy} onClick={() => changeMode('signup')}>Create an account</button></> : <button className="text-button" disabled={busy} onClick={() => changeMode('login')}><ChevronLeft size={16} />Back to sign in</button>}</p>}
        <div className="auth-footnote"><ShieldCheck size={16} /><span>Secure access. Only your team’s data.</span></div>
      </div>
      <div className="auth-form-footer">FORMA<span>A little clarity goes a long way.</span></div>
    </section>
  </main>
}
