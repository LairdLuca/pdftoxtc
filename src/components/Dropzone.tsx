import { useCallback, useRef, useState } from 'react'

interface Props {
  onFile: (file: File) => void
}

export default function Dropzone({ onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = useCallback((files: FileList | null) => {
    const file = files?.[0]
    if (file && /\.pdf$/i.test(file.name)) {
      onFile(file)
    }
  }, [onFile])

  return (
    <div
      className={`dropzone ${dragging ? 'dragging' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault()
        setDragging(false)
        handleFiles(e.dataTransfer.files)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        hidden
        onChange={e => handleFiles(e.target.files)}
      />
      <div className="dropzone-inner">
        <div className="dropzone-icon">&#128196;</div>
        <h2>Drop a PDF here</h2>
        <p>or click to choose a file</p>
        <p className="dropzone-note">
          Two-column pages are detected automatically: each column becomes a
          full-screen XTC page. Everything runs locally in your browser.
        </p>
      </div>
    </div>
  )
}
