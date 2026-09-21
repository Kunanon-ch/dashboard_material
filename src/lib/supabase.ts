import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

function validBrowserKey(value: string) {
  if (value.startsWith('sb_publishable_')) return true
  try {
    const payload = JSON.parse(atob(value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.role === 'anon'
  } catch { return false }
}

export const configurationError = !url || !key
  ? 'Add the Supabase project URL and publishable key to connect this workspace.'
  : !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url) || !validBrowserKey(key)
    ? 'Check your Supabase project URL and browser-safe publishable key.' : null

export const supabase = configurationError ? null : createClient(url!, key!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
