// Column-aware text extraction: rebuilds reading order, lines, paragraphs
// and cross-column/cross-page paragraph continuation from pdf.js text items.

import type { PageConfig } from '../pipeline'

export interface TextItemLike {
  str: string
  transform: number[]
  width: number
}

export interface Fragment {
  text: string
  heading: boolean
  /** First line of the paragraph was indented (strong "new paragraph" signal). */
  indented: boolean
}

export interface FlowParagraph {
  text: string
  heading: boolean
}

interface Line {
  y: number
  x0: number
  x1: number
  size: number
  parts: { x: number; end: number; str: string }[]
}

/**
 * Split page text items into regions (reading order) and rebuild each
 * region's paragraphs. Returns one Fragment[] per region.
 */
export function fragmentsFromItems(
  items: TextItemLike[],
  pageWidth: number,
  pageHeight: number,
  cfg: PageConfig
): Fragment[][] {
  const printable = items.filter(it => typeof it.str === 'string' && it.str.trim().length > 0)

  if (cfg.mode === 'two') {
    const boundary = pageWidth * cfg.splitX
    const left: TextItemLike[] = []
    const right: TextItemLike[] = []
    for (const it of printable) {
      const center = it.transform[4] + it.width / 2
      ;(center < boundary ? left : right).push(it)
    }
    return [left, right].map(group => linesToFragments(itemsToLines(group), pageHeight))
  }

  return [linesToFragments(itemsToLines(printable), pageHeight)]
}

function itemsToLines(items: TextItemLike[]): Line[] {
  const lines: Line[] = []
  for (const it of items) {
    const x = it.transform[4]
    const y = it.transform[5]
    const size = Math.hypot(it.transform[2], it.transform[3]) || 10
    const tol = Math.max(2, size * 0.45)
    let line = lines.find(l => Math.abs(l.y - y) <= tol)
    if (!line) {
      line = { y, x0: x, x1: x + it.width, size, parts: [] }
      lines.push(line)
    }
    line.parts.push({ x, end: x + it.width, str: it.str })
    line.x0 = Math.min(line.x0, x)
    line.x1 = Math.max(line.x1, x + it.width)
    line.size = Math.max(line.size, size)
  }
  for (const l of lines) l.parts.sort((a, b) => a.x - b.x)
  lines.sort((a, b) => b.y - a.y) // PDF y grows upward: top of page first
  return lines
}

function lineText(l: Line): string {
  let out = ''
  let prevEnd = -Infinity
  for (const p of l.parts) {
    if (out && p.x - prevEnd > l.size * 0.2 && !out.endsWith(' ') && !p.str.startsWith(' ')) {
      out += ' '
    }
    out += p.str
    prevEnd = p.end
  }
  return out.replace(/\s+/g, ' ').trim()
}

function linesToFragments(lines: Line[], pageHeight: number): Fragment[] {
  const kept: { line: Line; text: string }[] = []
  for (const line of lines) {
    const text = lineText(line)
    if (!text) continue
    // Drop page numbers in the top/bottom margin bands
    const inMarginBand = line.y < pageHeight * 0.06 || line.y > pageHeight * 0.94
    if (inMarginBand && /^[\divxlc]+$/i.test(text)) continue
    kept.push({ line, text })
  }
  if (kept.length === 0) return []

  const sizes = kept.map(k => k.line.size).sort((a, b) => a - b)
  const bodySize = sizes[Math.floor(sizes.length / 2)]
  const starts = kept.map(k => k.line.x0).sort((a, b) => a - b)
  const columnLeft = starts[Math.floor(starts.length * 0.1)]
  const gaps: number[] = []
  for (let i = 1; i < kept.length; i++) {
    gaps.push(kept[i - 1].line.y - kept[i].line.y)
  }
  const medianGap = gaps.length
    ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    : bodySize * 1.4

  const fragments: Fragment[] = []
  let current: Fragment | null = null

  for (let i = 0; i < kept.length; i++) {
    const { line, text } = kept[i]
    const heading = line.size > bodySize * 1.25
    const indented = line.x0 - columnLeft > line.size * 0.6
    const gap = i > 0 ? kept[i - 1].line.y - line.y : 0
    const newParagraph =
      !current || heading || current.heading || indented ||
      (i > 0 && gap > medianGap * 1.6)

    if (newParagraph) {
      current = { text, heading, indented }
      fragments.push(current)
    } else {
      current!.text = joinLines(current!.text, text)
    }
  }
  return fragments
}

/** Join two text runs, resolving a trailing hyphenation. */
function joinLines(a: string, b: string): string {
  if (/[-‐]$/.test(a)) {
    return a.replace(/[-‐]$/, '') + b
  }
  return a + ' ' + b
}

const PARAGRAPH_END = /[.!?…»”"')\]]$/

/**
 * Accumulates fragments across columns and pages, merging paragraphs that
 * continue over a column/page break (previous paragraph left "open" and the
 * next fragment does not start a new, indented or heading paragraph).
 */
export class TextFlow {
  paragraphs: FlowParagraph[] = []

  append(fragments: Fragment[]): void {
    for (const f of fragments) {
      const last = this.paragraphs[this.paragraphs.length - 1]
      if (last && this.canMerge(last, f)) {
        last.text = joinLines(last.text, f.text)
      } else {
        this.paragraphs.push({ text: f.text, heading: f.heading })
      }
    }
  }

  private canMerge(last: FlowParagraph, f: Fragment): boolean {
    if (f.heading || last.heading || f.indented) return false
    return !PARAGRAPH_END.test(last.text)
  }
}
