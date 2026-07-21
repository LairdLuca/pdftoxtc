import type { FlowParagraph } from '../lib/epub/extract'

interface Props {
  paragraphs: FlowParagraph[] | null
}

export default function TextPreview({ paragraphs }: Props) {
  return (
    <div className="pane">
      <div className="pane-header">
        <span>Extracted text (EPUB)</span>
        <span className="pane-sub">
          {paragraphs ? `${paragraphs.length} paragraphs on this page` : ''}
        </span>
      </div>
      <div className="text-preview">
        {paragraphs === null && <div className="loading">Extracting…</div>}
        {paragraphs?.length === 0 && (
          <div className="loading">
            No text found on this page — it will be skipped in the EPUB.
          </div>
        )}
        {paragraphs?.map((p, i) =>
          p.heading
            ? <h3 key={i}>{p.text}</h3>
            : <p key={i}>{p.text}</p>
        )}
      </div>
    </div>
  )
}
