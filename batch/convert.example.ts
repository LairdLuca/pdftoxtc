/**
 * Headless batch conversion: a folder of PDFs to EPUB, no browser.
 *
 * Reuses the tool's epub/ modules, so the output matches the web UI. The
 * canvas-based column analysis is skipped by fixing PageConfig — fine for
 * single-column books, which is what novels usually are. For two-column
 * PDFs use the web UI, where the split can be reviewed page by page.
 *
 *   npx esbuild batch/convert.example.ts --bundle --platform=node --format=esm \
 *     --outfile=batch/convert.mjs --external:pdfjs-dist --external:fflate
 *   node batch/convert.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extractPageFragments, chapterRanges, chaptersFromText } from '../src/lib/epub/pdf-text'
import { TextFlow } from '../src/lib/epub/extract'
import { buildEpub, type EpubChapter } from '../src/lib/epub/build'

const require = createRequire(import.meta.url)
const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs')

const IN_DIR = './pdf-in'
const OUT_DIR = './epub-out'

const CFG = { mode: 'single' as const, splitX: 0.5 }

interface Book {
  file: string
  title: string
  author: string
  out: string
  /**
   * Optional table of contents, for the stubborn books.
   *
   * chapterRanges() finds chapters on its own in most PDFs: it reads the
   * outline, and falls back to scanning the text for keywords ("CHAPTER 4"),
   * roman numerals, oversized lines, or all-caps lines opening a page.
   *
   * None of that fires when a book sets its chapter titles in the body font,
   * lowercase, with no numbering — the titles are simply indistinguishable
   * from any other line. Listing them here is the way out: chaptersFromText()
   * matches them against the text and uses the pages where they are found.
   *
   * Titles are matched on a normalised form (uppercase, letters and digits
   * only), so punctuation and spacing may differ from the PDF. Each title is
   * consumed once, at its first occurrence.
   *
   * Copy them from the book's own table of contents, then check the result:
   * a chapter count far below the expected one means the titles in the PDF
   * differ from the ones listed here.
   */
  chapters?: string[]
}

const BOOKS: Book[] = [
  // Nothing special: chapters are detected automatically.
  {
    file: 'some-novel.pdf',
    title: 'Some Novel',
    author: 'An Author',
    out: 'Author - Some Novel'
  },
  // Example of a stubborn one. This book's chapter titles are plain lowercase
  // lines in the body font, so automatic detection only found the two section
  // headings ("PRIMA PARTE", "SECONDA PARTE") and missed all 11 chapters.
  // With the list below it exports 14 entries: 11 chapters, 2 sections, title
  // page. Replace with your own book's table of contents.
  {
    file: 'gomorra.pdf',
    title: 'Gomorra',
    author: 'Roberto Saviano',
    out: 'Saviano - Gomorra',
    chapters: [
      'Il porto', 'Angelina Jolie', 'Il Sistema', 'La guerra di Secondigliano', 'Donne',
      'Kalashnikov', 'Cemento armato', 'Don Peppino Diana', 'Hollywood',
      'Aberdeen, Mondragone', 'Terra dei fuochi'
    ]
  }
]

mkdirSync(OUT_DIR, { recursive: true })

for (const book of BOOKS) {
  const started = Date.now()
  try {
    const data = new Uint8Array(readFileSync(`${IN_DIR}/${book.file}`))
    const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise

    let ranges = book.chapters
      ? await chaptersFromText(doc, 1, doc.numPages, book.chapters)
      : await chapterRanges(doc, 1, doc.numPages)
    // Listed titles absent from this edition: fall back to detection.
    if (ranges.length < 2) ranges = await chapterRanges(doc, 1, doc.numPages)
    if (ranges.length === 0) ranges.push({ title: '', from: 1, to: doc.numPages })

    const chapters: EpubChapter[] = []
    for (const range of ranges) {
      const flow = new TextFlow()
      for (let p = range.from; p <= range.to; p++) {
        for (const region of await extractPageFragments(doc, p, CFG)) flow.append(region)
      }
      chapters.push({ title: range.title, paragraphs: flow.paragraphs })
    }

    const used = chapters.filter(c => c.paragraphs.length > 0 || c.title)
    const paragraphs = used.reduce((n, c) => n + c.paragraphs.length, 0)
    if (paragraphs === 0) throw new Error('no extractable text — scanned PDF?')

    const epub = buildEpub({ title: book.title, author: book.author, language: 'it' }, used)
    writeFileSync(`${OUT_DIR}/${book.out}.epub`, epub)

    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    console.log(
      `OK   ${book.out}.epub — ${doc.numPages} pages, ${used.length} chapters, ` +
      `${paragraphs} paragraphs, ${Math.round(epub.length / 1024)} KB, ${seconds}s`
    )
  } catch (e) {
    console.log(`FAIL ${book.file} — ${(e as Error).message}`)
  }
}
