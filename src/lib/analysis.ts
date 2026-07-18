// Two-column layout detection via vertical projection profile.

export interface PageAnalysis {
  mode: 'single' | 'two'
  /** Split position as a fraction of full page width (valid when mode === 'two'). */
  splitX: number
  /** False when the detection is uncertain and worth a human look. */
  confident: boolean
}

const DARK = 200

/**
 * Detect whether a rendered page has two text columns and where the gutter is.
 * Works on the raw RGBA render (approximate luminance, dark-on-light content).
 */
export function analyzePage(imageData: ImageData): PageAnalysis {
  const { data, width, height } = imageData

  // Vertical projection of dark pixels + content bounding box
  const proj = new Uint32Array(width)
  let minX = width, minY = height, maxX = -1, maxY = -1
  let total = 0

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4
    for (let x = 0; x < width; x++) {
      const i = rowOffset + x * 4
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3
      if (lum < DARK) {
        proj[x]++
        total++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  // Blank or nearly blank page
  if (maxX < 0 || total < width * height * 0.001) {
    return { mode: 'single', splitX: 0.5, confident: true }
  }

  const bboxWidth = maxX - minX + 1
  const noise = Math.max(1, Math.round(height * 0.003))
  const windowLo = minX + bboxWidth * 0.30
  const windowHi = minX + bboxWidth * 0.70

  // Collect empty (gutter candidate) runs inside the content bbox,
  // keep the longest one whose center falls in the central window.
  let bestStart = -1
  let bestLen = 0
  let runStart = -1

  const closeRun = (end: number) => {
    if (runStart < 0) return
    const len = end - runStart
    const center = runStart + len / 2
    if (center >= windowLo && center <= windowHi && len > bestLen) {
      bestLen = len
      bestStart = runStart
    }
    runStart = -1
  }

  for (let x = minX; x <= maxX; x++) {
    if (proj[x] <= noise) {
      if (runStart < 0) runStart = x
    } else {
      closeRun(x)
    }
  }
  closeRun(maxX + 1)

  const minGutter = Math.max(4, bboxWidth * 0.015)
  if (bestLen < minGutter) {
    return { mode: 'single', splitX: 0.5, confident: true }
  }

  // Sparse pages (titles, headings): a word gap can look like a gutter, but
  // real column pages have content spanning most of the page height
  const bboxHeight = maxY - minY + 1
  if (bboxHeight < height * 0.3) {
    return { mode: 'single', splitX: 0.5, confident: false }
  }

  const splitPx = bestStart + bestLen / 2
  let leftMass = 0
  for (let x = minX; x < splitPx; x++) leftMass += proj[x]
  const balance = leftMass / total

  // A "gutter" with almost all content on one side is not a column break
  if (balance < 0.2 || balance > 0.8) {
    return { mode: 'single', splitX: 0.5, confident: false }
  }

  // Both sides must have text along most of the column height: word gaps
  // and figure gaps produce empty runs, but only over shallow content
  const split = Math.round(splitPx)
  let leftRows = 0
  let rightRows = 0
  for (let y = minY; y <= maxY; y++) {
    const rowOffset = y * width * 4
    let left = false
    let right = false
    for (let x = minX; x <= maxX; x++) {
      const i = rowOffset + x * 4
      if ((data[i] + data[i + 1] + data[i + 2]) / 3 < DARK) {
        if (x < split) left = true
        else right = true
        if (left && right) break
      }
    }
    if (left) leftRows++
    if (right) rightRows++
  }
  const sideCoverage = Math.min(leftRows, rightRows) / bboxHeight
  if (sideCoverage < 0.25) {
    return { mode: 'single', splitX: 0.5, confident: false }
  }

  const confident = bestLen >= bboxWidth * 0.025 &&
    balance >= 0.3 && balance <= 0.7 &&
    sideCoverage >= 0.45
  return { mode: 'two', splitX: splitPx / width, confident }
}
