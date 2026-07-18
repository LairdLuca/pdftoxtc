import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

export type { PDFDocumentProxy }

export async function loadPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data }).promise
}

/**
 * Render a page (1-based) to a canvas scaled to `targetWidth` pixels wide.
 */
export async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNum: number,
  targetWidth: number
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNum)
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = targetWidth / baseViewport.width
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: ctx, viewport, canvas }).promise
  page.cleanup()
  return canvas
}
