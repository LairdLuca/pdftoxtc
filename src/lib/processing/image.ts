// Grayscale, contrast stretch and content-bounds detection.
// Adapted from xtcjs (https://github.com/varo6/xtcjs), MIT License.

export interface ContentBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Convert canvas content to grayscale (luminosity method), in place.
 */
export function toGrayscale(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    data[i] = data[i + 1] = data[i + 2] = gray
  }

  ctx.putImageData(imageData, 0, 0)
}

/**
 * Histogram-based contrast stretch. `level` 0..3, 0 = off.
 */
export function applyContrast(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  level: number
): void {
  if (level <= 0) return
  const blackCutoff = 3 * level
  const whiteCutoff = 3 + 9 * level

  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  const histogram = new Array(256).fill(0)
  for (let i = 0; i < data.length; i += 4) {
    histogram[Math.round(data[i])]++
  }

  const totalPixels = width * height
  const blackThreshold = totalPixels * blackCutoff / 100
  const whiteThreshold = totalPixels * whiteCutoff / 100

  let blackPoint = 0
  let whitePoint = 255
  let count = 0

  for (let i = 0; i < 256; i++) {
    count += histogram[i]
    if (count >= blackThreshold) {
      blackPoint = i
      break
    }
  }

  count = 0
  for (let i = 255; i >= 0; i--) {
    count += histogram[i]
    if (count >= whiteThreshold) {
      whitePoint = i
      break
    }
  }

  const range = whitePoint - blackPoint
  if (range > 0) {
    for (let i = 0; i < data.length; i += 4) {
      const val = Math.max(0, Math.min(255, ((data[i] - blackPoint) / range) * 255))
      data[i] = data[i + 1] = data[i + 2] = val
    }
  }

  ctx.putImageData(imageData, 0, 0)
}

/**
 * Find the tight bounds around non-white content, expanded by `paddingPct`
 * percent of the content size on each side.
 */
export function findContentBounds(
  imageData: ImageData,
  whiteThreshold = 245,
  paddingPct = 1.5
): ContentBounds | null {
  const { data, width, height } = imageData
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4
    for (let x = 0; x < width; x++) {
      if (data[rowOffset + x * 4] >= whiteThreshold) {
        continue
      }
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0 || maxY < 0) {
    return null
  }

  const contentWidth = maxX - minX + 1
  const contentHeight = maxY - minY + 1
  const padX = Math.max(2, Math.floor(contentWidth * paddingPct / 100))
  const padY = Math.max(2, Math.floor(contentHeight * paddingPct / 100))
  const x = Math.max(0, minX - padX)
  const y = Math.max(0, minY - padY)
  const right = Math.min(width, maxX + padX + 1)
  const bottom = Math.min(height, maxY + padY + 1)

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  }
}
