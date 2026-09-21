import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [role, setRole] = useState<{ userId: string | null; isAdmin: boolean; loading: boolean; error: string | null }>({ userId: null, isAdmin: false, loading: false, error: null })
  const [authError, setAuthError] = useState<string | null>(null)
  const [recovery, setRecovery] = useState(false)
  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!supabase) return
    let alive = true
    let authEventReceived = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, current) => {
      authEventReceived = true
      if (!alive) return
      setSession(current)
      setAuthError(null)
      setLoading(false)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') setRecovery(false)
    })
    void supabase.auth.getSession().then(({ data, error: authError }) => {
      if (!alive || authEventReceived) return
      setSession(data.session)
      setAuthError(authError?.message ?? null)
      setLoading(false)
    }).catch(() => { if (alive && !authEventReceived) { setAuthError('Unable to connect to authentication. Please reload.'); setLoading(false) } })
    return () => { alive = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    const client = supabase
    if (!userId || !client) {
      setRole({ userId: null, isAdmin: false, loading: false, error: null })
      return
    }
    let alive = true
    setRole({ userId, isAdmin: false, loading: true, error: null })
    void (async () => {
      try {
        const { data, error: roleError } = await client.rpc('is_admin')
        if (!alive) return
        setRole({ userId, isAdmin: !roleError && data === true, loading: false, error: roleError ? 'Could not load workspace permissions. Check the database setup.' : null })
      } catch {
        if (alive) setRole({ userId, isAdmin: false, loading: false, error: 'Could not load workspace permissions. Check your connection and reload.' })
      }
    })()
    return () => { alive = false }
  }, [userId])

  const roleLoading = Boolean(userId && supabase && (role.userId !== userId || role.loading))
  const isAdmin = Boolean(userId && role.userId === userId && !roleLoading && role.isAdmin)
  const error = authError ?? (role.userId === userId ? role.error : null)

  return { session, loading, isAdmin, roleLoading, error, recovery, finishRecovery: () => setRecovery(false) }
}
