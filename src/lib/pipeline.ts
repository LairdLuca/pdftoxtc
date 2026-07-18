import { toGrayscale, applyContrast, findContentBounds } from './processing/image'
import { applyDithering } from './processing/dithering'
import { imageDataToXtg, imageDataToXth } from './encode/xtg'

export const DEVICE_DIMENSIONS = {
  X4: { width: 480, height: 800 },
  X3: { width: 528, height: 792 }
} as const

export type TargetDevice = keyof typeof DEVICE_DIMENSIONS

export interface ConvertOptions {
  format: 'xtc' | 'xtch'
  dither: boolean
  contrast: number // 0..3
  threshold: number // 80..176, 128 = neutral
  paddingPct: number // crop padding, % of content size
  device: TargetDevice
}

export const DEFAULT_OPTIONS: ConvertOptions = {
  format: 'xtc',
  dither: false,
  contrast: 1,
  threshold: 128,
  paddingPct: 1.5,
  device: 'X4'
}

export interface PageConfig {
  mode: 'single' | 'two'
  splitX: number // fraction of page width
}

/**
 * Turn one rendered PDF page into 1 or 2 device-sized canvases:
 * grayscale + contrast, column split, auto-crop, scale, quantize.
 * Mutates `src` (grayscale/contrast are applied in place).
 */
export function processPage(
  src: HTMLCanvasElement,
  cfg: PageConfig,
  opt: ConvertOptions
): HTMLCanvasElement[] {
  const ctx = src.getContext('2d', { willReadFrequently: true })!
  toGrayscale(ctx, src.width, src.height)
  applyContrast(ctx, src.width, src.height, opt.contrast)

  const splitPx = Math.round(src.width * cfg.splitX)
  const regions = cfg.mode === 'two'
    ? [
        { x: 0, w: splitPx },
        { x: splitPx, w: src.width - splitPx }
      ]
    : [{ x: 0, w: src.width }]

  const { width: TW, height: TH } = DEVICE_DIMENSIONS[opt.device]

  return regions.map(region => {
    const regionData = ctx.getImageData(region.x, 0, region.w, src.height)
    const bounds = findContentBounds(regionData, 245, opt.paddingPct)
      ?? { x: 0, y: 0, width: region.w, height: src.height }

    const out = document.createElement('canvas')
    out.width = TW
    out.height = TH
    const octx = out.getContext('2d', { willReadFrequently: true })!
    octx.fillStyle = '#ffffff'
    octx.fillRect(0, 0, TW, TH)

    const scale = Math.min(TW / bounds.width, TH / bounds.height)
    const dw = bounds.width * scale
    const dh = bounds.height * scale
    octx.imageSmoothingEnabled = true
    octx.imageSmoothingQuality = 'high'
    octx.drawImage(
      src,
      region.x + bounds.x, bounds.y, bounds.width, bounds.height,
      (TW - dw) / 2, (TH - dh) / 2, dw, dh
    )

    applyDithering(
      octx, TW, TH,
      opt.dither ? 'floyd' : 'none',
      opt.format === 'xtch',
      opt.threshold
    )
    return out
  })
}

/**
 * Encode a processed (device-sized, quantized) canvas as an XTG/XTH page blob.
 */
export function encodePage(canvas: HTMLCanvasElement, format: 'xtc' | 'xtch'): ArrayBuffer {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return format === 'xtch' ? imageDataToXth(imageData) : imageDataToXtg(imageData)
}
