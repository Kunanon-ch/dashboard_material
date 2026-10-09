const responseHeaders = { 'Cache-Control': 'no-store' }

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: responseHeaders })
}

export async function GET(request: Request) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, {
      status: 405, headers: { ...responseHeaders, Allow: 'GET' },
    })
  }

  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('Supabase keepalive: CRON_SECRET is missing')
    return json({ error: 'Keepalive is not configured' }, 503)
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const url = process.env.VITE_SUPABASE_URL?.trim()
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url) || !key) {
    console.error('Supabase keepalive: public Supabase configuration is missing or invalid')
    return json({ error: 'Keepalive is not configured' }, 503)
  }

  // This RPC reads the singleton state row and returns only a boolean.
  // A few database requests per day follow Supabase's inactivity guidance.
  try {
    for (let read = 0; read < 3; read++) {
      const result = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/dashboard_keepalive`, {
        method: 'GET',
        headers: { apikey: key, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      })
      if (!result.ok) {
        // Never log response bodies, credentials, or dataset contents.
        console.error('Supabase keepalive: database request failed', { status: result.status })
        return json({ error: 'Database health check failed' }, 502)
      }
      if (await result.json() !== true) {
        console.error('Supabase keepalive: database state check failed')
        return json({ error: 'Database health check failed' }, 502)
      }
    }
  } catch {
    console.error('Supabase keepalive: database request timed out or returned an invalid response')
    return json({ error: 'Database health check failed' }, 502)
  }

  const checkedAt = new Date().toISOString()
  console.info('Supabase keepalive completed', { reads: 3, checkedAt })
  return json({ ok: true, reads: 3, checkedAt })
}
