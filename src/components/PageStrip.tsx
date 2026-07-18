import type { PageAnalysis } from '../lib/analysis'
import type { PageOverride } from '../App'

interface Props {
  numPages: number
  current: number
  analyses: Record<number, PageAnalysis>
  overrides: Record<number, PageOverride>
  analyzed: number
  onSelect: (page: number) => void
}

export default function PageStrip({
  numPages, current, analyses, overrides, analyzed, onSelect
}: Props) {
  const nextFlagged = () => {
    for (let i = 1; i <= numPages; i++) {
      const p = ((current + i - 1) % numPages) + 1
      const a = analyses[p]
      if (a && !a.confident && !overrides[p]) {
        onSelect(p)
        return
      }
    }
  }

  const flaggedCount = Object.entries(analyses)
    .filter(([p, a]) => !a.confident && !overrides[Number(p)]).length

  return (
    <div className="page-strip">
      <div className="strip-controls">
        <button onClick={() => onSelect(Math.max(1, current - 1))} disabled={current <= 1}>&#9664;</button>
        <span className="strip-pos">{current} / {numPages}</span>
        <button onClick={() => onSelect(Math.min(numPages, current + 1))} disabled={current >= numPages}>&#9654;</button>
        <button className="flag-jump" onClick={nextFlagged} disabled={flaggedCount === 0}>
          Next flagged ({flaggedCount})
        </button>
        {analyzed < numPages && (
          <span className="strip-progress">analyzing {analyzed}/{numPages}…</span>
        )}
      </div>
      <div className="strip-pages">
        {Array.from({ length: numPages }, (_, i) => i + 1).map(p => {
          const a = analyses[p]
          const o = overrides[p]
          const cls = [
            'strip-page',
            p === current ? 'current' : '',
            o ? 'edited' : a ? (a.confident ? (a.mode === 'two' ? 'two' : 'single') : 'flagged') : 'pending'
          ].join(' ')
          const title = o
            ? `Page ${p} — manually adjusted`
            : a
              ? `Page ${p} — ${a.mode === 'two' ? '2 columns' : 'full page'}${a.confident ? '' : ' (uncertain)'}`
              : `Page ${p} — not analyzed yet`
          return (
            <button key={p} className={cls} title={title} onClick={() => onSelect(p)}>
              {p}
            </button>
          )
        })}
      </div>
    </div>
  )
}
