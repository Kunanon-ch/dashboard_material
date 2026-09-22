// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { Dataset } from '../types'
import App from '../App'
import { useAuth } from './useAuth'
import { useDataset } from './useDataset'

const mock = vi.hoisted(() => ({
  from: vi.fn(),
  pointer: vi.fn(),
  snapshot: vi.fn(),
  rpc: vi.fn(),
  getSession: vi.fn(),
  unsubscribe: vi.fn(),
  removeChannel: vi.fn(),
  authCallbacks: [] as ((event: AuthChangeEvent, session: Session | null) => void)[],
  channels: [] as { change: () => void; status: (status: string) => void }[],
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: mock.from,
    rpc: mock.rpc,
    auth: {
      getSession: mock.getSession,
      onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => {
        mock.authCallbacks.push(callback)
        return { data: { subscription: { unsubscribe: mock.unsubscribe } } }
      },
    },
    channel: () => {
      const callbacks = { change: () => {}, status: (_status: string) => {} }
      mock.channels.push(callbacks)
      const channel = {
        on: (_event: string, _filter: unknown, callback: () => void) => { callbacks.change = callback; return channel },
        subscribe: (callback: (status: string) => void) => { callbacks.status = callback; return channel },
      }
      return channel
    },
    removeChannel: mock.removeChannel,
  },
}))
vi.mock('../components/Chart', () => ({ default: () => null }))
vi.mock('../components/ImportManager', () => ({ default: () => createElement('p', null, 'Import manager ready') }))

const sample: Dataset = {
  series: [{ id: 'copper', name: 'Copper', category: 'Metals', currency: 'THB', unit: 'T', sourceColumn: 'D' }],
  rows: [{ month: '2026-01-01', values: { copper: 100 } }],
}
const another: Dataset = { ...sample, rows: [{ month: '2026-02-01', values: { copper: 200 } }] }
const pointer = (id: string | null) => ({ data: { active_version_id: id }, error: null })
const snapshot = (id: string, payload: Dataset = sample) => ({ data: { id, payload, filename: `${id}.xlsx` }, error: null })
const session = (id: string, token = 'token') => ({ user: { id }, access_token: token } as Session)
const roots: Root[] = []

function deferred<T>() {
  let resolve!: (result: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

async function renderHook<Props, Result>(useHook: (props: Props) => Result, initialProps: NoInfer<Props>) {
  let props = initialProps
  let current!: Result
  const renders: Result[] = []
  function Harness() { current = useHook(props); renders.push(current); return null }
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  await act(async () => { root.render(createElement(Harness)) })
  return {
    get current() { return current },
    renders,
    async rerender(next: Props) { props = next; await act(async () => { root.render(createElement(Harness)) }) },
  }
}

async function emitAuth(event: AuthChangeEvent, current: Session | null) {
  await act(async () => { mock.authCallbacks.at(-1)!(event, current) })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  mock.channels.length = 0
  mock.authCallbacks.length = 0
  mock.pointer.mockReset().mockResolvedValue(pointer('version-a'))
  mock.snapshot.mockReset().mockResolvedValue(snapshot('version-a'))
  mock.rpc.mockReset().mockResolvedValue({ data: false, error: null })
  mock.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null })
  mock.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ single: mock.pointer, maybeSingle: mock.snapshot }) }),
  }))
})

afterEach(async () => {
  await act(async () => { roots.splice(0).forEach(root => root.unmount()) })
  vi.unstubAllGlobals()
})

describe('dataset session scope', () => {
  it('does not read protected tables or subscribe before sign-in, and fetches after sign-in', async () => {
    const hook = await renderHook((id: string | null) => useDataset(id), null)
    expect(mock.from).not.toHaveBeenCalled()
    expect(mock.channels).toHaveLength(0)
    expect(hook.current.loading).toBe(false)
    await hook.rerender('account-a')
    expect(hook.current.dataset).toEqual(sample)
    expect(hook.current.version?.id).toBe('version-a')
    expect(mock.channels).toHaveLength(1)
  })

  it('hides the previous dataset on the first account render and ignores old channels', async () => {
    const hook = await renderHook((id: string | null) => useDataset(id), 'account-a')
    const oldChannel = mock.channels[0]
    const nextPointer = deferred<ReturnType<typeof pointer>>()
    mock.pointer.mockReturnValueOnce(nextPointer.promise)
    const firstNewRender = hook.renders.length
    await hook.rerender('account-b')
    expect(hook.renders[firstNewRender].dataset).toBeNull()
    expect(hook.current.loading).toBe(true)
    const reads = mock.from.mock.calls.length
    await act(async () => { oldChannel.status('SUBSCRIBED'); oldChannel.change() })
    expect(mock.from).toHaveBeenCalledTimes(reads)
    expect(hook.current.connection).toBe('connecting')
    expect(mock.removeChannel).toHaveBeenCalledTimes(1)
    mock.pointer.mockResolvedValue(pointer('version-b'))
    mock.snapshot.mockResolvedValue(snapshot('version-b', another))
    await act(async () => { nextPointer.resolve(pointer('version-b')) })
    expect(hook.current.dataset).toEqual(another)
  })

  it('invalidates an in-flight read when the account changes', async () => {
    const oldRead = deferred<ReturnType<typeof snapshot>>()
    mock.snapshot.mockReturnValueOnce(oldRead.promise)
    const hook = await renderHook((id: string | null) => useDataset(id), 'account-a')
    mock.pointer.mockResolvedValue(pointer('version-b'))
    mock.snapshot.mockResolvedValue(snapshot('version-b', another))
    await hook.rerender('account-b')
    expect(hook.current.dataset).toEqual(another)
    await act(async () => { oldRead.resolve(snapshot('version-a')) })
    expect(hook.current.dataset).toEqual(another)
    expect(hook.current.version?.id).toBe('version-b')
    expect(hook.current.error).toBeNull()
  })

  it('keeps preview local and clears its published data when leaving or re-entering', async () => {
    type Props = { id: string | null; preview?: Dataset }
    const hook = await renderHook(({ id, preview }: Props) => useDataset(id, preview), { id: null, preview: sample })
    await act(async () => { hook.current.publishPreview(another, 'preview.xlsx', 'Prices') })
    expect(hook.current.dataset).toEqual(another)
    expect(mock.from).not.toHaveBeenCalled()
    expect(mock.channels).toHaveLength(0)
    const firstSignedOutRender = hook.renders.length
    await hook.rerender({ id: null })
    expect(hook.renders[firstSignedOutRender].dataset).toBeNull()
    expect(hook.current.version).toBeNull()
    await hook.rerender({ id: null, preview: sample })
    expect(hook.current.dataset).toEqual(sample)
    expect(hook.current.version).toBeNull()
    const firstSignedInRender = hook.renders.length
    await hook.rerender({ id: 'account-a' })
    expect(hook.renders[firstSignedInRender].dataset).toBeNull()
    expect(hook.current.dataset).toEqual(sample)
    expect(hook.current.connection).toBe('connecting')
  })

  it('rechecks the active pointer and never exposes a snapshot superseded during loading', async () => {
    mock.pointer.mockResolvedValueOnce(pointer('version-a')).mockResolvedValue(pointer('version-b'))
    mock.snapshot.mockResolvedValueOnce(snapshot('version-a')).mockResolvedValue(snapshot('version-b', another))
    const hook = await renderHook((id: string) => useDataset(id), 'account-a')
    expect(hook.current.dataset).toEqual(another)
    expect(hook.current.version?.id).toBe('version-b')
    expect(hook.renders.some(result => result.version?.id === 'version-a')).toBe(false)
    expect(mock.pointer).toHaveBeenCalledTimes(4)
  })

  it('rejects explicit failed refreshes, retains the last snapshot, and can recover', async () => {
    const hook = await renderHook((id: string) => useDataset(id), 'account-a')
    mock.pointer.mockResolvedValueOnce({ data: null, error: { message: 'Network unavailable' } })
    await act(async () => { await expect(hook.current.refresh()).rejects.toThrow('Network unavailable') })
    expect(hook.current.dataset).toEqual(sample)
    expect(hook.current.error).toBe('Network unavailable')
    await act(async () => { await hook.current.refresh() })
    expect(hook.current.error).toBeNull()
  })

  it('runs a requested refresh after the current read rather than claiming its result', async () => {
    const firstRead = deferred<ReturnType<typeof snapshot>>()
    mock.snapshot.mockReturnValueOnce(firstRead.promise)
    const hook = await renderHook((id: string) => useDataset(id), 'account-a')
    let refreshed = false
    const requested = hook.current.refresh().then(() => { refreshed = true })
    expect(refreshed).toBe(false)
    mock.pointer.mockResolvedValue(pointer('version-b'))
    mock.snapshot.mockResolvedValue(snapshot('version-b', another))
    await act(async () => { firstRead.resolve(snapshot('version-a')); await requested })
    expect(refreshed).toBe(true)
    expect(hook.current.version?.id).toBe('version-b')
    expect(mock.snapshot).toHaveBeenCalledTimes(3)
  })
})

describe('authentication permissions', () => {
  it('loads permissions by user identity and preserves them during token refresh', async () => {
    mock.rpc.mockResolvedValue({ data: true, error: null })
    const hook = await renderHook(() => useAuth(), undefined)
    await emitAuth('SIGNED_IN', session('account-a'))
    expect(hook.current.isAdmin).toBe(true)
    const beforeRefresh = hook.renders.length
    await emitAuth('TOKEN_REFRESHED', session('account-a', 'new-token'))
    expect(mock.rpc).toHaveBeenCalledTimes(2)
    expect(hook.renders.slice(beforeRefresh).every(value => value.isAdmin && !value.roleLoading)).toBe(true)
  })

  it('hides old permissions immediately when the user changes', async () => {
    mock.rpc.mockResolvedValueOnce({ data: true, error: null })
    const hook = await renderHook(() => useAuth(), undefined)
    await emitAuth('SIGNED_IN', session('account-a'))
    const nextRole = deferred<{ data: boolean; error: null }>()
    mock.rpc.mockReturnValueOnce(nextRole.promise)
    const firstNewRender = hook.renders.length
    await emitAuth('SIGNED_IN', session('account-b'))
    expect(hook.renders[firstNewRender].isAdmin).toBe(false)
    expect(hook.renders[firstNewRender].roleLoading).toBe(true)
    await act(async () => { nextRole.resolve({ data: false, error: null }) })
    expect(hook.current.isAdmin).toBe(false)
    expect(hook.current.roleLoading).toBe(false)
  })

  it('ignores the previous account permission result and settles a rejected permission lookup', async () => {
    const oldRole = deferred<{ data: boolean; error: null }>()
    mock.rpc.mockReturnValueOnce(oldRole.promise).mockRejectedValueOnce(new Error('Network unavailable'))
    const hook = await renderHook(() => useAuth(), undefined)
    await emitAuth('SIGNED_IN', session('account-a'))
    await emitAuth('SIGNED_IN', session('account-b'))
    await act(async () => { oldRole.resolve({ data: true, error: null }) })
    expect(hook.current.isAdmin).toBe(false)
    expect(hook.current.roleLoading).toBe(false)
    expect(hook.current.error).toContain('Could not load workspace permissions')
  })

  it('keeps a direct import visit in place until permission loading finishes', async () => {
    const permission = deferred<{ data: boolean; error: null }>()
    mock.getSession.mockResolvedValue({ data: { session: session('account-a') }, error: null })
    mock.rpc.mockReturnValueOnce(permission.promise)
    const container = document.createElement('div')
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(createElement(MemoryRouter, { initialEntries: ['/import'] }, createElement(App))) })
    expect(container.textContent).toContain('Checking workspace permissions')
    await act(async () => { permission.resolve({ data: true, error: null }) })
    expect(container.textContent).toContain('Import manager ready')
    await emitAuth('TOKEN_REFRESHED', session('account-a', 'new-token'))
    expect(container.textContent).toContain('Import manager ready')
  })

  it('blocks imports when the initial dataset read fails and allows a successful retry', async () => {
    mock.getSession.mockResolvedValue({ data: { session: session('account-a') }, error: null })
    mock.rpc.mockResolvedValue({ data: true, error: null })
    mock.pointer.mockResolvedValueOnce({ data: null, error: { message: 'Dataset temporarily unavailable' } })
    const container = document.createElement('div')
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(createElement(MemoryRouter, { initialEntries: ['/import'] }, createElement(App))) })
    expect(container.textContent).toContain('Dataset temporarily unavailable')
    expect(container.textContent).not.toContain('Import manager ready')
    const retry = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry loading dataset')
    expect(retry).toBeDefined()
    await act(async () => { retry!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.textContent).toContain('Import manager ready')
    expect(container.textContent).not.toContain('Dataset temporarily unavailable')
  })

  it('keeps imports mounted when a later refresh fails with a known active version', async () => {
    mock.getSession.mockResolvedValue({ data: { session: session('account-a') }, error: null })
    mock.rpc.mockResolvedValue({ data: true, error: null })
    const container = document.createElement('div')
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(createElement(MemoryRouter, { initialEntries: ['/import'] }, createElement(App))) })
    expect(container.textContent).toContain('Import manager ready')
    mock.pointer.mockResolvedValueOnce({ data: null, error: { message: 'Dataset temporarily unavailable' } })
    await act(async () => { mock.channels[0].change() })
    expect(container.textContent).toContain('Import manager ready')
    expect(container.textContent).not.toContain('Retry loading dataset')
  })
})
