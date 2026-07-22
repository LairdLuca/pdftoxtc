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

/** "CAPITOLO IV", "LIBRO PRIMO", "CHAPTER 2", "PROLOGUE"... */
const KEYWORD =
  /^(CAPITOLO|LIBRO|PARTE|TOMO|PROLOGO|EPILOGO|APPENDICE|INTRODUZIONE|PREFAZIONE|CHAPTER|BOOK|PART|PROLOGUE|EPILOGUE|APPENDIX|INTRODUCTION|PREFACE)\b/
/** "II: Premessa seconda", "XIV. The house and the mole" */
const ROMAN_TITLE = /^[IVXLCDM]{1,7}\s*[:.–-]\s+\S/
/** "UNA RIUNIONE INASPETTATA" — a title carrying no typographic signal at all */
const ALL_CAPS = /^[A-ZÀÈÉÌÒÙÁÍÓÚÄÖÜÑÇ][A-ZÀÈÉÌÒÙÁÍÓÚÄÖÜÑÇ0-9'’«»"().,\- ]+$/

const fingerprint = (s: string) =>
  s.toUpperCase().replace(/[^A-ZÀÈÉÌÒÙÁÍÓÚÄÖÜÑÇ0-9]/g, '').slice(0, 28)

function looksLikeTitle(
  text: string,
  size: number,
  bodySize: number,
  lineIndex: number
): boolean {
  if (text.length < 4 || text.length > 70) return false
  if (KEYWORD.test(text) || ROMAN_TITLE.test(text)) return true
  // Typographic heading: larger than the surrounding body text.
  if (size > bodySize * 1.25) return true
  // A chapter title opens the page; an all-caps inscription or epigraph sits
  // in the middle of it, so position is what tells them apart.
  return lineIndex < 3 && ALL_CAPS.test(text) && /[A-Z]{2}/.test(text) && text.includes(' ')
}

/**
 * Derive chapter page ranges by scanning the text, for PDFs whose outline is
 * missing or unusable. `outlineTitles` are matched against the text as well:
 * some outlines carry the right titles but point every entry at the same page.
 */
export async function chaptersFromText(
  doc: PDFDocumentProxy,
  from: number,
  to: number,
  outlineTitles: string[] = []
): Promise<ChapterRange[]> {
  const expected = new Map<string, string>(
    outlineTitles
      .map(t => [fingerprint(t), t] as [string, string])
      .filter(([key]) => key.length >= 5)
  )
  const marks: { title: string; page: number }[] = []

  for (let p = from; p <= to; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()

    // Rebuild whole lines: titles must be matched complete, not per text item.
    const lines = new Map<number, { text: string; size: number }>()
    for (const item of content.items as TextItemLike[]) {
      const y = Math.round(item.transform[5])
      const size = Math.hypot(item.transform[2], item.transform[3]) || 10
      const line = lines.get(y)
      if (line) {
        line.text += item.str
        line.size = Math.max(line.size, size)
      } else {
        lines.set(y, { text: item.str, size })
      }
    }

    const sizes = [...lines.values()].map(l => l.size).sort((a, b) => a - b)
    const bodySize = sizes[Math.floor(sizes.length / 2)] ?? 0
    const ordered = [...lines.entries()]
      .sort((a, b) => b[0] - a[0]) // PDF y grows upward: top of page first
      .map(([, line]) => line)
      .filter(line => line.text.trim())

    ordered.forEach((line, i) => {
      const text = line.text.trim()
      const key = fingerprint(text)
      if (key.length >= 5 && expected.has(key)) {
        marks.push({ title: expected.get(key)!, page: p })
        expected.delete(key) // a title counts once
        return
      }
      if (looksLikeTitle(text, line.size, bodySize, i)) marks.push({ title: text, page: p })
    })
  }

  // A page opens one chapter but may carry several headings: "LIBRO PRIMO" and
  // "CAPITOLO 1" sit together, and dropping the second would lose the first
  // chapter of every book.
  const byPage = new Map<number, string>()
  for (const mark of marks) {
    const seen = byPage.get(mark.page)
    if (!seen) byPage.set(mark.page, mark.title)
    else if (!seen.includes(mark.title) && seen.length + mark.title.length < 90) {
      byPage.set(mark.page, `${seen} · ${mark.title}`)
    }
  }

  const pages = [...byPage.keys()].sort((a, b) => a - b)
  if (pages.length < 2) return []

  const chapters: ChapterRange[] = []
  if (pages[0] > from) chapters.push({ title: '', from, to: pages[0] - 1 })
  pages.forEach((page, i) => {
    chapters.push({
      title: byPage.get(page)!,
      from: page,
      to: i + 1 < pages.length ? pages[i + 1] - 1 : to
    })
  })
  return chapters.filter(c => c.from <= c.to)
}

/**
 * Chapter ranges for a document: the outline when it is usable, the text
 * otherwise. An outline is treated as unusable when it yields a single range,
 * or when one range covers most of the book — which is what happens when every
 * outline entry points at the same page.
 */
export async function chapterRanges(
  doc: PDFDocumentProxy,
  from: number,
  to: number
): Promise<ChapterRange[]> {
  const fromOutline = await chaptersFromOutline(doc, from, to)
  const pages = to - from + 1
  const longest = fromOutline.length
    ? Math.max(...fromOutline.map(c => c.to - c.from + 1)) / pages
    : 1
  if (fromOutline.length >= 2 && longest <= 0.7) return fromOutline

  let titles: string[] = []
  try {
    titles = ((await doc.getOutline()) ?? []).map(entry => entry.title ?? '')
  } catch {
    // no outline: text scan only
  }
  const fromText = await chaptersFromText(doc, from, to, titles)
  return fromText.length >= 2 ? fromText : fromOutline
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
