import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '../../api/supabase-keepalive'

const cronSecret = 'test-cron-secret'
const request = (authorization = `Bearer ${cronSecret}`, method = 'GET') =>
  new Request('https://example.com/api/supabase-keepalive', { method, headers: { authorization } })

describe('scheduled Supabase database reads', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', cronSecret)
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co/')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fails closed when the cron secret is missing', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request('Bearer undefined'))).status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not query the database for an unauthorized request', async () => {
    expect((await GET(request('Bearer wrong'))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-GET requests before reading the database', async () => {
    const result = await GET(request(undefined, 'POST'))
    expect(result.status).toBe(405)
    expect(result.headers.get('allow')).toBe('GET')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid Supabase configuration before sending the key', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://unrelated.example.com')
    expect((await GET(request())).status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('performs three uncached read-only requests and reports their success', async () => {
    fetchMock.mockImplementation(async () => Response.json(true))
    const result = await GET(request())
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(await result.json()).toMatchObject({ ok: true, reads: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/rpc/dashboard_keepalive',
      expect.objectContaining({ method: 'GET', cache: 'no-store', headers: {
        apikey: 'sb_publishable_test', Accept: 'application/json',
      } }),
    )
  })

  it('reports database errors without logging response contents', async () => {
    fetchMock.mockResolvedValue(new Response('private upstream information', { status: 401 }))
    expect((await GET(request())).status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private upstream information')
  })

  it.each([false, null, 'true', []])('does not accept an unexpected database response: %j', async (value) => {
    fetchMock.mockImplementation(async () => Response.json(value))
    expect((await GET(request())).status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports network failures without exposing exception details', async () => {
    fetchMock.mockRejectedValue(new Error('private connection details'))
    expect((await GET(request())).status).toBe(502)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private connection details')
  })
})
