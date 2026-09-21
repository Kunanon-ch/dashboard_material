import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dataset, DatasetVersion } from '../types'
import { supabase } from './supabase'

type Connection = 'connecting' | 'live' | 'offline'
interface Scope { userId: string | null; preview?: Dataset }
interface DatasetState {
  scope: Scope
  dataset: Dataset | null
  version: DatasetVersion | null
  loading: boolean
  error: string | null
  connection: Connection
}

function initialState(scope: Scope): DatasetState {
  return {
    scope,
    dataset: scope.userId ? null : scope.preview ?? null,
    version: null,
    loading: Boolean(scope.userId && supabase),
    error: null,
    connection: scope.userId && supabase ? 'connecting' : 'offline',
  }
}

export function useDataset(userId: string | null, preview?: Dataset) {
  const scope = useMemo(() => ({ userId, preview }), [userId, preview])
  const [state, setState] = useState(() => initialState(scope))
  const active = useRef<{ scope: Scope; refresh: () => Promise<void> } | null>(null)

  const refresh = useCallback(async () => {
    if (active.current?.scope !== scope) throw new Error('Sign in again before refreshing the dataset.')
    await active.current.refresh()
  }, [scope])

  const publishPreview = useCallback((dataset: Dataset, _filename: string, _sheetName: string) => {
    if (scope.userId) return
    setState(previous => previous.scope === scope
      ? { ...previous, dataset, version: null, loading: false, error: null, connection: 'offline' }
      : previous)
  }, [scope])

  useEffect(() => {
    setState(initialState(scope))
    const client = supabase
    if (!scope.userId || !client) return
    let current = true
    const assertCurrent = () => {
      if (!current) throw new Error('The session changed while loading the dataset. Please refresh.')
    }
    const readPointer = async () => {
      assertCurrent()
      const result = await client.from('dashboard_state').select('active_version_id').eq('id', 1).single()
      assertCurrent()
      if (result.error) throw result.error
      return result.data.active_version_id as string | null
    }

    const load = async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const versionId = await readPointer()
          assertCurrent()
          const result = versionId
            ? await client.from('dataset_versions').select('*').eq('id', versionId).maybeSingle()
            : null
          assertCurrent()
          if (result?.error) throw result.error
          // Administrators can still read an older snapshot after another publish.
          // Accept a snapshot only if the active pointer still identifies it.
          const latestVersionId = await readPointer()
          assertCurrent()
          if (latestVersionId !== versionId) continue
          if (!versionId) {
            setState(previous => ({ ...previous, dataset: null, version: null, error: null }))
            return
          }
          if (!result?.data) continue
          const { payload, ...metadata } = result.data
          if (!payload || !Array.isArray(payload.series) || !Array.isArray(payload.rows)) throw new Error('The published dataset is invalid.')
          setState(previous => ({ ...previous, dataset: payload as Dataset, version: metadata as DatasetVersion, error: null }))
          return
        }
        throw new Error('The dataset changed while loading. Please refresh.')
      } catch (cause) {
        const message = cause instanceof Error ? cause.message
          : typeof cause === 'object' && cause !== null && 'message' in cause && typeof cause.message === 'string' ? cause.message
            : 'Unable to load data. Check your connection and database setup.'
        if (current) setState(previous => ({ ...previous, error: message }))
        throw new Error(message)
      } finally {
        if (current) setState(previous => ({ ...previous, loading: false }))
      }
    }

    // Queue refreshes so a publish refresh cannot be superseded by an older read.
    // Each caller observes the success or failure of its own read after the trigger.
    let pending = Promise.resolve()
    const refreshCurrent = () => {
      pending = pending.then(load, load)
      return pending
    }
    active.current = { scope, refresh: refreshCurrent }
    const refreshAutomatically = () => {
      if (current) void refreshCurrent().catch(() => { /* The hook exposes the load error. */ })
    }
    refreshAutomatically()
    const channel = client.channel(`material-dataset-state:${scope.userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dashboard_state', filter: 'id=eq.1' }, refreshAutomatically)
      .subscribe(status => {
        if (!current) return
        setState(previous => ({ ...previous, connection: status === 'SUBSCRIBED' ? 'live' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED' ? 'offline' : 'connecting' }))
        if (status === 'SUBSCRIBED') refreshAutomatically()
      })
    const onFocus = () => { if (document.visibilityState === 'visible') refreshAutomatically() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    const timer = window.setInterval(onFocus, 60_000)
    return () => {
      current = false
      if (active.current?.scope === scope) active.current = null
      void client.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      window.clearInterval(timer)
    }
  }, [scope])

  // Effects run after rendering: hide the previous account immediately.
  const visible = state.scope === scope ? state : initialState(scope)
  return { dataset: visible.dataset, version: visible.version, loading: visible.loading, error: visible.error, connection: visible.connection, refresh, publishPreview }
}
