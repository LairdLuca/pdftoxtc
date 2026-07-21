import type { PDFDocumentProxy } from '../pdf'
import type { PageConfig } from '../pipeline'
import { fragmentsFromItems, type Fragment, type TextItemLike } from './extract'

export async function extractPageFragments(
  doc: PDFDocumentProxy,
  pageNum: number,
  cfg: PageConfig
): Promise<Fragment[][]> {
  const page = await doc.getPage(pageNum)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  return fragmentsFromItems(
    content.items as TextItemLike[],
    viewport.width,
    viewport.height,
    cfg
  )
}

export interface ChapterRange {
  title: string
  from: number
  to: number
}

/**
 * Derive chapter page ranges from the PDF outline (top level only).
 * Returns [] when there is no usable outline.
 */
export async function chaptersFromOutline(
  doc: PDFDocumentProxy,
  from: number,
  to: number
): Promise<ChapterRange[]> {
  try {
    const outline = await doc.getOutline()
    if (!outline || outline.length === 0) return []

    const marks: { title: string; page: number }[] = []
    for (const entry of outline) {
      try {
        let dest = entry.dest
        if (typeof dest === 'string') {
          dest = await doc.getDestination(dest)
        }
        if (!Array.isArray(dest) || !dest[0]) continue
        const pageIndex = await doc.getPageIndex(dest[0])
        marks.push({ title: entry.title || '', page: pageIndex + 1 })
      } catch {
        // unresolvable destination: skip entry
      }
    }
    marks.sort((a, b) => a.page - b.page)

    const within = marks.filter(m => m.page >= from && m.page <= to)
    if (within.length === 0) return []

    const chapters: ChapterRange[] = []
    if (within[0].page > from) {
      chapters.push({ title: '', from, to: within[0].page - 1 })
    }
    for (let i = 0; i < within.length; i++) {
      chapters.push({
        title: within[i].title,
        from: within[i].page,
        to: i + 1 < within.length ? within[i + 1].page - 1 : to
      })
    }
    return chapters.filter(c => c.from <= c.to)
  } catch {
    return []
  }
}
