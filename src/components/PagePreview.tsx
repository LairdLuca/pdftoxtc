import { useRef } from 'react'

interface Props {
  imgUrl: string | null
  mode: 'single' | 'two'
  splitX: number
  uncertain: boolean
  overridden: boolean
  onSplitChange: (fraction: number) => void
  onModeChange: (mode: 'auto' | 'single' | 'two') => void
}

export default function PagePreview({
  imgUrl, mode, splitX, uncertain, overridden, onSplitChange, onModeChange
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null)

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const frame = frameRef.current
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      const f = Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width))
      onSplitChange(f)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="pane">
      <div className="pane-header">
        <span>Original page</span>
        <div className="mode-toggle">
          <button
            className={!overridden ? 'active' : ''}
            onClick={() => onModeChange('auto')}
            title="Use automatic detection"
          >Auto</button>
          <button
            className={overridden && mode === 'single' ? 'active' : ''}
            onClick={() => onModeChange('single')}
          >Full page</button>
          <button
            className={overridden && mode === 'two' ? 'active' : ''}
            onClick={() => onModeChange('two')}
          >2 columns</button>
        </div>
      </div>
      {uncertain && !overridden && (
        <div className="warning-banner">
          Detection is uncertain on this page — check the result and adjust if needed.
        </div>
      )}
      <div className="page-frame" ref={frameRef}>
        {imgUrl
          ? <img src={imgUrl} alt="Original page" draggable={false} />
          : <div className="loading">Rendering…</div>}
        {imgUrl && mode === 'two' && (
          <div
            className="split-line"
            style={{ left: `${splitX * 100}%` }}
            onPointerDown={startDrag}
            title="Drag to move the column split"
          >
            <div className="split-handle">&#8596;</div>
          </div>
        )}
      </div>
    </div>
  )
}
