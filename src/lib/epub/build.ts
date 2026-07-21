// Minimal EPUB 3 builder (zip via fflate).

import { zipSync, strToU8 } from 'fflate'
import type { FlowParagraph } from './extract'

export interface EpubChapter {
  title: string
  paragraphs: FlowParagraph[]
}

export interface EpubMetadata {
  title: string
  author: string
  language: string
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function buildEpub(meta: EpubMetadata, chapters: EpubChapter[]): Uint8Array<ArrayBuffer> {
  const uuid = crypto.randomUUID()
  const lang = meta.language.trim() || 'en'
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

  const css = `p { margin: 0; text-indent: 1.3em; text-align: justify; }
h2, h3 { text-align: center; }
`

  const chapterFiles = chapters.map((ch, i) => {
    const name = `ch${i + 1}.xhtml`
    const body: string[] = []
    if (ch.title) {
      body.push(`<h2>${escapeXml(ch.title)}</h2>`)
    }
    for (const p of ch.paragraphs) {
      body.push(p.heading
        ? `<h3>${escapeXml(p.text)}</h3>`
        : `<p>${escapeXml(p.text)}</p>`)
    }
    const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(lang)}">
<head>
  <title>${escapeXml(ch.title || meta.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body.join('\n')}
</body>
</html>`
    return { name, xhtml }
  })

  const navItems = chapters.map((ch, i) =>
    `      <li><a href="ch${i + 1}.xhtml">${escapeXml(ch.title || `Section ${i + 1}`)}</a></li>`
  ).join('\n')

  const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(lang)}">
<head><title>${escapeXml(meta.title)}</title></head>
<body>
  <nav epub:type="toc">
    <h1>${escapeXml(meta.title)}</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>`

  const manifestItems = chapterFiles.map((f, i) =>
    `    <item id="ch${i + 1}" href="${f.name}" media-type="application/xhtml+xml"/>`
  ).join('\n')
  const spineItems = chapterFiles.map((_, i) =>
    `    <itemref idref="ch${i + 1}"/>`
  ).join('\n')

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeXml(meta.title)}</dc:title>
    <dc:language>${escapeXml(lang)}</dc:language>
${meta.author ? `    <dc:creator>${escapeXml(meta.author)}</dc:creator>\n` : ''}    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`

  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    // The mimetype entry must come first and be stored uncompressed
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(containerXml),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(navXhtml),
    'OEBPS/style.css': strToU8(css)
  }
  for (const f of chapterFiles) {
    files[`OEBPS/${f.name}`] = strToU8(f.xhtml)
  }

  return zipSync(files) as Uint8Array<ArrayBuffer>
}
