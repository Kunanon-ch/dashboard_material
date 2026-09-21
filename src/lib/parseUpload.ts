import type { ParsedWorkbook } from '../types'

// Keep workbook decompression and parsing off the UI thread; terminate stalled parsers.
export async function parseUpload(file: File): Promise<ParsedWorkbook> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Please choose an Excel .xlsx workbook.')
  if (file.size > 5 * 1024 * 1024) throw new Error('The workbook must be smaller than 5 MB.')
  const buffer = await file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workbook.worker.ts', import.meta.url), { type: 'module' })
    const timer = window.setTimeout(() => { worker.terminate(); reject(new Error('This workbook took too long to read. Try a smaller file.')) }, 20_000)
    const finish = () => { window.clearTimeout(timer); worker.terminate() }
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result: ParsedWorkbook; error?: string }>) => {
      finish()
      if (event.data.ok) resolve(event.data.result)
      else reject(new Error(event.data.error || 'Unable to read this workbook.'))
    }
    worker.onerror = () => { finish(); reject(new Error('Unable to process the workbook. Please try again.')) }
    worker.postMessage(buffer, [buffer])
  })
}
