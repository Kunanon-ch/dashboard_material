// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasetVersion, ParsedWorkbook } from '../types'
import ImportManager from './ImportManager'

const mocks = vi.hoisted(() => ({ parse: vi.fn(), rpc: vi.fn(), history: vi.fn() }))
vi.mock('../lib/parseUpload', () => ({ parseUpload: mocks.parse }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ order: () => ({ range: mocks.history }) }) }),
  },
}))

const parsed: ParsedWorkbook = {
  sheetName: 'all', warnings: [],
  dataset: {
    series: [{ id: 'copper_thb', name: 'Copper', category: 'Metals', currency: 'THB', unit: 'Lbs', sourceColumn: 'B' }],
    rows: [{ month: '2026-01-01', values: { copper_thb: 132 } }],
  },
}
const olderVersion: DatasetVersion = {
  id: 'older-version', filename: 'older.xlsx', sheet_name: 'all',
  created_at: '2026-01-01T00:00:00Z', created_by: 'admin', row_count: 1, series_count: 1,
}
const newerVersion: DatasetVersion = { ...olderVersion, id: 'newer-version', filename: 'newer.xlsx' }

describe('workbook review and committed changes', () => {
  let root: Root
  let container: HTMLDivElement
  let props: ComponentProps<typeof ImportManager>

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.parse.mockReset().mockResolvedValue(parsed)
    mocks.rpc.mockReset().mockResolvedValue({ data: 'published-version', error: null })
    mocks.history.mockReset().mockResolvedValue({ data: [], error: null })
    props = {
      version: olderVersion, preview: false,
      onPublished: vi.fn().mockResolvedValue(undefined), onPreviewPublish: vi.fn(),
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function render() {
    await act(async () => root.render(createElement(ImportManager, props)))
  }

  function button(label: string): HTMLButtonElement {
    const match = [...container.querySelectorAll('button')].find((item) => item.textContent === label)
    if (!match) throw new Error(`Missing button: ${label}`)
    return match
  }

  async function choose(file: File) {
    const input = container.querySelector<HTMLInputElement>('#workbook-upload')!
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    expect(input.value).toContain(file.name)
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    return input
  }

  async function click(label: string) {
    await act(async () => button(label).click())
  }

  it('allows the same workbook to be reviewed again after the active version changes', async () => {
    await render()
    const file = new File(['workbook'], 'materials.xlsx')
    const input = await choose(file)
    expect(input.value).toBe('')
    expect(input.files?.length).toBe(0)

    props = { ...props, version: newerVersion }
    await render()
    expect(container.textContent).toContain('A newer dataset is active.')
    expect(button('Publish dataset').disabled).toBe(true)

    await choose(file)
    expect(mocks.parse).toHaveBeenCalledTimes(2)
    expect(mocks.parse).toHaveBeenLastCalledWith(file)
    expect(input.value).toBe('')
    expect(container.textContent).not.toContain('A newer dataset is active.')
    expect(button('Publish dataset').disabled).toBe(false)
    await click('Publish dataset')
    expect(mocks.rpc).toHaveBeenCalledWith('publish_dataset', expect.objectContaining({ p_expected_version: newerVersion.id }))
  })

  it('reports a committed upload accurately when refreshing the dashboard fails', async () => {
    props.onPublished = vi.fn().mockRejectedValue(new Error('Connection interrupted'))
    await render()
    await choose(new File(['workbook'], 'materials.xlsx'))
    await click('Publish dataset')

    expect(mocks.rpc).toHaveBeenCalledWith('publish_dataset', {
      p_filename: 'materials.xlsx', p_sheet_name: 'all', p_payload: parsed.dataset,
      p_expected_version: olderVersion.id,
    })
    expect(props.onPublished).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Dataset published.')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('The dataset was published, but this dashboard could not reload it.')
    expect(container.querySelector('.selected-file')).toBeNull()
    expect(container.querySelector('.import-preview')).toBeNull()
    expect(container.querySelector<HTMLInputElement>('#workbook-upload')?.value).toBe('')
    expect(mocks.history).toHaveBeenCalledTimes(2)
  })

  it('reports a committed restore accurately and dismisses its confirmation when refresh fails', async () => {
    props.version = newerVersion
    props.onPublished = vi.fn().mockRejectedValue(new Error('Connection interrupted'))
    mocks.history.mockResolvedValue({ data: [newerVersion, olderVersion], error: null })
    await render()
    await click('Restore')
    expect(container.querySelector('[aria-label="Confirm restore"]')).not.toBeNull()
    await click('Confirm restore')

    expect(mocks.rpc).toHaveBeenCalledWith('restore_dataset', {
      p_version_id: olderVersion.id, p_expected_version: newerVersion.id,
    })
    expect(props.onPublished).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Previous dataset restored.')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('The version was restored, but this dashboard could not reload it.')
    expect(container.querySelector('[aria-label="Confirm restore"]')).toBeNull()
    expect(mocks.history).toHaveBeenCalledTimes(2)
  })

  it('preserves the pending workbook when publication fails before committing', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'Conflict' } })
    await render()
    await choose(new File(['workbook'], 'materials.xlsx'))
    await click('Publish dataset')

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Another admin published a new version.')
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('.selected-file')?.textContent).toContain('materials.xlsx')
    expect(container.querySelector('.import-preview')).not.toBeNull()
    expect(props.onPublished).not.toHaveBeenCalled()
  })

  it('applies a local preview without publishing to Supabase', async () => {
    props.preview = true
    await render()
    await choose(new File(['workbook'], 'materials.xlsx'))
    await click('Apply to preview')

    expect(props.onPreviewPublish).toHaveBeenCalledWith(parsed.dataset, 'materials.xlsx', 'all')
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.history).not.toHaveBeenCalled()
    expect(props.onPublished).not.toHaveBeenCalled()
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Preview updated in this browser.')
    expect(container.querySelector('.selected-file')).toBeNull()
    expect(container.querySelector('.import-preview')).toBeNull()
  })
})
