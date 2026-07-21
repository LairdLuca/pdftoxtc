import { useCallback, useEffect, useRef, useState } from 'react'
import Dropzone from './components/Dropzone'
import PagePreview from './components/PagePreview'
import OutputPreview from './components/OutputPreview'
import OptionsPanel from './components/OptionsPanel'
import PageStrip from './components/PageStrip'
import ExportBar from './components/ExportBar'
import { loadPdf, renderPageToCanvas, type PDFDocumentProxy } from './lib/pdf'
import { analyzePage, type PageAnalysis } from './lib/analysis'
import {
  processPage, encodePage, DEFAULT_OPTIONS, DEVICE_DIMENSIONS,
  type ConvertOptions, type PageConfig
} from './lib/pipeline'
import { buildXtcFromPages } from './lib/encode/xtc'
import { TextFlow, type FlowParagraph } from './lib/epub/extract'
import { extractPageFragments, chaptersFromOutline } from './lib/epub/pdf-text'
import { buildEpub, type EpubChapter } from './lib/epub/build'
import TextPreview from './components/TextPreview'
import { downloadBlob } from './lib/download'

export interface PageOverride {
  mode?: 'single' | 'two'
  splitX?: number
}

const ANALYSIS_WIDTH = 600
const PREVIEW_WIDTH = 1100
const EXPORT_WIDTH = 1600

const yieldToUi = () => new Promise<void>(resolve => setTimeout(resolve, 0))

export default function App() {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [analyses, setAnalyses] = useState<Record<number, PageAnalysis>>({})
  const [analyzed, setAnalyzed] = useState(0)
  const [overrides, setOverrides] = useState<Record<number, PageOverride>>({})
  const [options, setOptions] = useState<ConvertOptions>(DEFAULT_OPTIONS)
  const [current, setCurrent] = useState(1)
  const [origUrl, setOrigUrl] = useState<string | null>(null)
  const [outUrls, setOutUrls] = useState<string[]>([])
  const [textPreview, setTextPreview] = useState<FlowParagraph[] | null>(null)
  const [exportMeta, setExportMeta] = useState({
    fileNameBase: '', title: '', author: '', language: 'en', rangeFrom: 1, rangeTo: 1
  })
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const origCache = useRef(new Map<number, string>())
  const previewToken = useRef(0)

  const configFor = useCallback((page: number): PageConfig & { confident: boolean; overridden: boolean } => {
    const a = analyses[page]
    const o = overrides[page]
    const mode = o?.mode ?? a?.mode ?? 'single'
    const splitX = o?.splitX ?? (a && a.mode === 'two' ? a.splitX : 0.5)
    return { mode, splitX, confident: a?.confident ?? true, overridden: !!o }
  }, [analyses, overrides])

  const handleFile = useCallback(async (file: File) => {
    setError(null)
    try {
      const data = await file.arrayBuffer()
      const pdf = await loadPdf(data)
      origCache.current.clear()
      setDoc(pdf)
      setNumPages(pdf.numPages)
      setAnalyses({})
      setAnalyzed(0)
      setOverrides({})
      setCurrent(1)
      setOrigUrl(null)
      setOutUrls([])
      const base = file.name.replace(/\.pdf$/i, '')
      setExportMeta(prev => ({
        ...prev, fileNameBase: base, title: base, author: '', rangeFrom: 1, rangeTo: pdf.numPages
      }))
    } catch (e) {
      setError(`Could not open PDF: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  // Background analysis of every page at low resolution
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    ;(async () => {
      for (let p = 1; p <= doc.numPages; p++) {
        if (cancelled) return
        try {
          const canvas = await renderPageToCanvas(doc, p, ANALYSIS_WIDTH)
          if (cancelled) return
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!
          const analysis = analyzePage(ctx.getImageData(0, 0, canvas.width, canvas.height))
          setAnalyses(prev => ({ ...prev, [p]: analysis }))
        } catch {
          // unreadable page: leave as default (full page)
        }
        setAnalyzed(p)
        await yieldToUi()
      }
    })()
    return () => { cancelled = true }
  }, [doc])

  // Live preview of the current page
  const currentAnalysis = analyses[current]
  const currentOverride = overrides[current]
  useEffect(() => {
    if (!doc) return
    const token = ++previewToken.current
    const timer = setTimeout(async () => {
      try {
        const canvas = await renderPageToCanvas(doc, current, PREVIEW_WIDTH)
        if (previewToken.current !== token) return
        let orig = origCache.current.get(current)
        if (!orig) {
          orig = canvas.toDataURL('image/jpeg', 0.85)
          origCache.current.set(current, orig)
        }
        setOrigUrl(orig)
        const cfg = configFor(current)
        if (options.format === 'epub') {
          setTextPreview(null)
          const flow = new TextFlow()
          for (const region of await extractPageFragments(doc, current, cfg)) {
            flow.append(region)
          }
          if (previewToken.current !== token) return
          setTextPreview(flow.paragraphs)
          setOutUrls([])
          return
        }
        const outs = processPage(canvas, cfg, options)
        if (previewToken.current !== token) return
        setOutUrls(outs.map(c => c.toDataURL()))
      } catch (e) {
        if (previewToken.current === token) {
          setError(`Preview failed on page ${current}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }, 120)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, current, options, currentAnalysis, currentOverride])

  const setOverride = (page: number, patch: PageOverride | null) => {
    setOverrides(prev => {
      const next = { ...prev }
      if (patch === null) {
        delete next[page]
      } else {
        next[page] = { ...next[page], ...patch }
      }
      return next
    })
  }

  const handleModeChange = (mode: 'auto' | 'single' | 'two') => {
    if (mode === 'auto') {
      setOverride(current, null)
    } else {
      setOverride(current, { mode })
    }
  }

  const handleExportEpub = async () => {
    if (!doc) return
    const { rangeFrom, rangeTo, fileNameBase, title, author, language } = exportMeta
    const total = rangeTo - rangeFrom + 1
    setExporting({ done: 0, total })

    const ranges = await chaptersFromOutline(doc, rangeFrom, rangeTo)
    if (ranges.length === 0) {
      ranges.push({ title: '', from: rangeFrom, to: rangeTo })
    }

    const chapters: EpubChapter[] = []
    let done = 0
    let totalParagraphs = 0
    for (const range of ranges) {
      const flow = new TextFlow()
      for (let p = range.from; p <= range.to; p++) {
        let cfg: PageConfig = configFor(p)
        if (!analyses[p] && !overrides[p]?.mode) {
          const canvas = await renderPageToCanvas(doc, p, ANALYSIS_WIDTH)
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!
          const a = analyzePage(ctx.getImageData(0, 0, canvas.width, canvas.height))
          cfg = { mode: a.mode, splitX: overrides[p]?.splitX ?? a.splitX }
        }
        for (const region of await extractPageFragments(doc, p, cfg)) {
          flow.append(region)
        }
        setExporting({ done: ++done, total })
        await yieldToUi()
      }
      totalParagraphs += flow.paragraphs.length
      chapters.push({ title: range.title, paragraphs: flow.paragraphs })
    }

    if (totalParagraphs === 0) {
      throw new Error('no extractable text found — this PDF looks scanned. Use XTC/XTCH instead.')
    }

    const epub = buildEpub(
      { title: title || fileNameBase, author, language },
      chapters.filter(c => c.paragraphs.length > 0 || c.title)
    )
    downloadBlob(epub, `${fileNameBase.trim()}.epub`)
  }

  const handleExport = async () => {
    if (!doc || exporting) return
    setError(null)
    try {
      if (options.format === 'epub') {
        await handleExportEpub()
        return
      }
      const { rangeFrom, rangeTo, fileNameBase, title, author } = exportMeta
      const total = rangeTo - rangeFrom + 1
      setExporting({ done: 0, total })
      const blobs: ArrayBuffer[] = []
      for (let p = rangeFrom; p <= rangeTo; p++) {
        const canvas = await renderPageToCanvas(doc, p, EXPORT_WIDTH)
        let cfg: PageConfig = configFor(p)
        if (!analyses[p] && !overrides[p]?.mode) {
          // Page not analyzed yet (export started before background scan finished)
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!
          const a = analyzePage(ctx.getImageData(0, 0, canvas.width, canvas.height))
          cfg = { mode: a.mode, splitX: overrides[p]?.splitX ?? a.splitX }
        }
        for (const out of processPage(canvas, cfg, options)) {
          blobs.push(encodePage(out, options.format))
        }
        setExporting({ done: p - rangeFrom + 1, total })
        await yieldToUi()
      }
      const xtc = buildXtcFromPages(blobs, {
        is2bit: options.format === 'xtch',
        metadata: { title: title || fileNameBase, author, toc: [] }
      })
      const ext = options.format === 'xtch' ? 'xtch' : 'xtc'
      downloadBlob(xtc, `${fileNameBase.trim()}.${ext}`)
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExporting(null)
    }
  }

  if (!doc) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>PDF <span className="arrow">&#8594;</span> XTC</h1>
          <p className="tagline">Two-column PDF converter for XTEink e-readers</p>
        </header>
        {error && <div className="error-banner">{error}</div>}
        <Dropzone onFile={handleFile} />
        <footer className="app-footer">
          XTC/XTCH encoder adapted from{' '}
          <a href="https://github.com/varo6/xtcjs" target="_blank" rel="noreferrer">xtcjs</a> (MIT).
          Files never leave your browser.
        </footer>
      </div>
    )
  }

  const cfg = configFor(current)
  const dims = DEVICE_DIMENSIONS[options.device]

  return (
    <div className="app">
      <header className="app-header compact">
        <h1>PDF <span className="arrow">&#8594;</span> XTC</h1>
        <span className="file-name">{exportMeta.fileNameBase}.pdf ({numPages} pages)</span>
        <button className="link-btn" onClick={() => setDoc(null)}>Open another file</button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="workspace">
        <aside className="sidebar">
          <OptionsPanel options={options} onChange={setOptions} />
          <ExportBar
            fileNameBase={exportMeta.fileNameBase}
            title={exportMeta.title}
            author={exportMeta.author}
            language={exportMeta.language}
            rangeFrom={exportMeta.rangeFrom}
            rangeTo={exportMeta.rangeTo}
            numPages={numPages}
            extension={options.format === 'xtc' ? 'xtc' : options.format === 'xtch' ? 'xtch' : 'epub'}
            exporting={exporting}
            onChange={patch => setExportMeta(prev => ({ ...prev, ...patch }))}
            onExport={handleExport}
          />
        </aside>

        <main className="previews">
          <PagePreview
            imgUrl={origUrl}
            mode={cfg.mode}
            splitX={cfg.splitX}
            uncertain={!cfg.confident}
            overridden={cfg.overridden}
            onSplitChange={f => setOverride(current, { mode: 'two', splitX: f })}
            onModeChange={handleModeChange}
          />
          {options.format === 'epub'
            ? <TextPreview paragraphs={textPreview} />
            : <OutputPreview
                urls={outUrls}
                deviceLabel={`${options.device} ${dims.width}x${dims.height}`}
              />}
        </main>
      </div>

      <PageStrip
        numPages={numPages}
        current={current}
        analyses={analyses}
        overrides={overrides}
        analyzed={analyzed}
        onSelect={setCurrent}
      />
    </div>
  )
}
