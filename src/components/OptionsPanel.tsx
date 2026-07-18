import type { ConvertOptions, TargetDevice } from '../lib/pipeline'

interface Props {
  options: ConvertOptions
  onChange: (options: ConvertOptions) => void
}

export default function OptionsPanel({ options, onChange }: Props) {
  const set = <K extends keyof ConvertOptions>(key: K, value: ConvertOptions[K]) =>
    onChange({ ...options, [key]: value })

  return (
    <div className="panel">
      <h3>Options</h3>

      <label className="field">
        <span>Format</span>
        <select
          value={options.format}
          onChange={e => set('format', e.target.value as ConvertOptions['format'])}
        >
          <option value="xtc">XTC — 1-bit B/W (crisp text)</option>
          <option value="xtch">XTCH — 2-bit grayscale</option>
        </select>
      </label>

      <label className="field">
        <span>Device</span>
        <select
          value={options.device}
          onChange={e => set('device', e.target.value as TargetDevice)}
        >
          <option value="X4">XTEink X4 (480 x 800)</option>
          <option value="X3">XTEink X3 (528 x 792)</option>
        </select>
      </label>

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={options.dither}
          onChange={e => set('dither', e.target.checked)}
        />
        <span>Dithering (better for images, softer text)</span>
      </label>

      <label className="field">
        <span>Contrast <em>{options.contrast.toFixed(1)}</em></span>
        <input
          type="range" min={0} max={3} step={0.5}
          value={options.contrast}
          onChange={e => set('contrast', Number(e.target.value))}
        />
      </label>

      <label className="field">
        <span>Text darkness <em>{options.threshold}</em></span>
        <input
          type="range" min={96} max={160} step={4}
          value={options.threshold}
          onChange={e => set('threshold', Number(e.target.value))}
        />
      </label>

      <label className="field">
        <span>Crop padding <em>{options.paddingPct.toFixed(1)}%</em></span>
        <input
          type="range" min={0} max={5} step={0.5}
          value={options.paddingPct}
          onChange={e => set('paddingPct', Number(e.target.value))}
        />
      </label>
    </div>
  )
}
