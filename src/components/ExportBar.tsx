interface Props {
  fileNameBase: string
  title: string
  author: string
  rangeFrom: number
  rangeTo: number
  numPages: number
  extension: string
  exporting: { done: number; total: number } | null
  onChange: (patch: Partial<{
    fileNameBase: string
    title: string
    author: string
    rangeFrom: number
    rangeTo: number
  }>) => void
  onExport: () => void
}

export default function ExportBar({
  fileNameBase, title, author, rangeFrom, rangeTo, numPages,
  extension, exporting, onChange, onExport
}: Props) {
  const rangeValid = rangeFrom >= 1 && rangeTo <= numPages && rangeFrom <= rangeTo

  return (
    <div className="panel">
      <h3>Export</h3>

      <label className="field">
        <span>Book title</span>
        <input value={title} onChange={e => onChange({ title: e.target.value })} />
      </label>

      <label className="field">
        <span>Author (optional)</span>
        <input value={author} onChange={e => onChange({ author: e.target.value })} />
      </label>

      <label className="field">
        <span>File name</span>
        <div className="filename-row">
          <input value={fileNameBase} onChange={e => onChange({ fileNameBase: e.target.value })} />
          <span className="ext">.{extension}</span>
        </div>
      </label>

      <label className="field">
        <span>Page range</span>
        <div className="range-row">
          <input
            type="number" min={1} max={numPages} value={rangeFrom}
            onChange={e => onChange({ rangeFrom: Number(e.target.value) })}
          />
          <span>to</span>
          <input
            type="number" min={1} max={numPages} value={rangeTo}
            onChange={e => onChange({ rangeTo: Number(e.target.value) })}
          />
        </div>
      </label>

      {exporting ? (
        <div className="export-progress">
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${(exporting.done / exporting.total) * 100}%` }}
            />
          </div>
          <span>Converting page {exporting.done} of {exporting.total}…</span>
        </div>
      ) : (
        <button
          className="export-btn"
          disabled={!rangeValid || !fileNameBase.trim()}
          onClick={onExport}
        >
          Convert &amp; Export
        </button>
      )}
      {!rangeValid && <p className="field-error">Invalid page range.</p>}
    </div>
  )
}
