interface Props {
  urls: string[]
  deviceLabel: string
}

export default function OutputPreview({ urls, deviceLabel }: Props) {
  return (
    <div className="pane">
      <div className="pane-header">
        <span>E-reader output ({deviceLabel})</span>
        <span className="pane-sub">
          {urls.length === 0 ? '' : urls.length === 1 ? '1 screen' : `${urls.length} screens`}
        </span>
      </div>
      <div className="output-frames">
        {urls.length === 0 && <div className="loading">Processing…</div>}
        {urls.map((url, i) => (
          <figure key={i} className="device-frame">
            <img src={url} alt={`Output screen ${i + 1}`} draggable={false} />
            <figcaption>{i + 1}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}
