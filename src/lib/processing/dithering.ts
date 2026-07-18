// Quantization for e-ink output: unsharp mask, optional error diffusion,
// 1-bit threshold or 2-bit levels.
// Adapted from xtcjs (https://github.com/varo6/xtcjs), MIT License.

const SHADOW_LIFT_GAMMA = 0.75
const SHADOW_TOE = 24
const shadowLiftLut = buildShadowLiftLut()

function buildShadowLiftLut(): Float32Array {
  const lut = new Float32Array(256)
  const toeTop = 255 * Math.pow(SHADOW_TOE / 255, SHADOW_LIFT_GAMMA)
  for (let v = 0; v < 256; v++) {
    if (v < SHADOW_TOE) {
      lut[v] = (v / SHADOW_TOE) * toeTop
    } else {
      lut[v] = 255 * Math.pow(v / 255, SHADOW_LIFT_GAMMA)
    }
  }
  return lut
}

function quantizePixel(value: number, is2bit: boolean): number {
  if (!is2bit) {
    return value >= 128 ? 255 : 0
  }
  if (value < 42.5) return 0
  if (value < 127.5) return 85
  if (value < 212.5) return 170
  return 255
}

export type DitherAlgorithm = 'none' | 'floyd' | 'atkinson' | 'sierra-lite' | 'ordered'

/**
 * Quantize the canvas for e-ink output.
 * `threshold` (default 128) biases the black/white cut: higher = darker text.
 */
export function applyDithering(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  algorithm: DitherAlgorithm,
  is2bit = false,
  threshold = 128
): void {
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  const pixels = new Float32Array(width * height)
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = data[i * 4]
  }

  sharpenLuminance(pixels, width, height, is2bit ? 0.45 : 0.7)

  if (is2bit) {
    applyShadowLift(pixels)
  }

  // Bias so that the quantizer's fixed 128 cut behaves like `threshold`
  const bias = 128 - threshold
  if (bias !== 0) {
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = Math.max(0, Math.min(255, pixels[i] + bias))
    }
  }

  switch (algorithm) {
    case 'none':
      applyThreshold(pixels, is2bit)
      break
    case 'sierra-lite':
      applySierraLite(pixels, width, height, is2bit)
      break
    case 'atkinson':
      applyAtkinson(pixels, width, height, is2bit)
      break
    case 'ordered':
      applyOrdered(pixels, width, height, is2bit)
      break
    case 'floyd':
    default:
      applyFloydSteinberg(pixels, width, height, is2bit)
  }

  for (let i = 0; i < pixels.length; i++) {
    const val = Math.max(0, Math.min(255, pixels[i]))
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = val
  }

  ctx.putImageData(imageData, 0, 0)
}

/**
 * Unsharp mask on the luminance buffer (3x3 gaussian blur as base).
 */
function sharpenLuminance(
  pixels: Float32Array,
  width: number,
  height: number,
  amount: number
): void {
  if (amount <= 0 || width < 3 || height < 3) return

  const blurred = new Float32Array(pixels.length)

  for (let y = 0; y < height; y++) {
    const yUp = y > 0 ? y - 1 : 0
    const yDown = y < height - 1 ? y + 1 : height - 1
    const rowUp = yUp * width
    const row = y * width
    const rowDown = yDown * width

    for (let x = 0; x < width; x++) {
      const xL = x > 0 ? x - 1 : 0
      const xR = x < width - 1 ? x + 1 : width - 1

      blurred[row + x] = (
        pixels[rowUp + xL] + 2 * pixels[rowUp + x] + pixels[rowUp + xR] +
        2 * pixels[row + xL] + 4 * pixels[row + x] + 2 * pixels[row + xR] +
        pixels[rowDown + xL] + 2 * pixels[rowDown + x] + pixels[rowDown + xR]
      ) / 16
    }
  }

  for (let i = 0; i < pixels.length; i++) {
    const sharpened = pixels[i] + amount * (pixels[i] - blurred[i])
    pixels[i] = Math.max(0, Math.min(255, sharpened))
  }
}

function applyShadowLift(pixels: Float32Array): void {
  for (let i = 0; i < pixels.length; i++) {
    const v = Math.max(0, Math.min(255, pixels[i]))
    const lo = Math.floor(v)
    const hi = Math.min(255, lo + 1)
    const frac = v - lo
    pixels[i] = shadowLiftLut[lo] * (1 - frac) + shadowLiftLut[hi] * frac
  }
}

function applyThreshold(pixels: Float32Array, is2bit: boolean): void {
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = quantizePixel(pixels[i], is2bit)
  }
}

// Clamp accumulated error so high-contrast edges don't smear streaks
const ERROR_CLAMP = 96

function clampError(error: number): number {
  if (error > ERROR_CLAMP) return ERROR_CLAMP
  if (error < -ERROR_CLAMP) return -ERROR_CLAMP
  return error
}

function applySierraLite(
  pixels: Float32Array,
  width: number,
  height: number,
  is2bit: boolean
): void {
  for (let y = 0; y < height; y++) {
    const reverse = (y & 1) === 1
    const dir = reverse ? -1 : 1

    for (let i = 0; i < width; i++) {
      const x = reverse ? width - 1 - i : i
      const idx = y * width + x
      const oldPixel = pixels[idx]
      const newPixel = quantizePixel(oldPixel, is2bit)
      pixels[idx] = newPixel
      const error = clampError(oldPixel - newPixel)

      const xAhead = x + dir
      const xBehind = x - dir

      if (xAhead >= 0 && xAhead < width) pixels[idx + dir] += error * 2 / 4
      if (y + 1 < height) {
        if (xBehind >= 0 && xBehind < width) pixels[idx + width - dir] += error * 1 / 4
        pixels[idx + width] += error * 1 / 4
      }
    }
  }
}

function applyAtkinson(
  pixels: Float32Array,
  width: number,
  height: number,
  is2bit: boolean
): void {
  for (let y = 0; y < height; y++) {
    const reverse = (y & 1) === 1
    const dir = reverse ? -1 : 1

    for (let i = 0; i < width; i++) {
      const x = reverse ? width - 1 - i : i
      const idx = y * width + x
      const oldPixel = pixels[idx]
      const newPixel = quantizePixel(oldPixel, is2bit)
      pixels[idx] = newPixel
      const error = clampError(oldPixel - newPixel) / 8

      const xAhead1 = x + dir
      const xAhead2 = x + dir * 2
      const xBehind = x - dir

      if (xAhead1 >= 0 && xAhead1 < width) pixels[idx + dir] += error
      if (xAhead2 >= 0 && xAhead2 < width) pixels[idx + dir * 2] += error
      if (y + 1 < height) {
        if (xBehind >= 0 && xBehind < width) pixels[idx + width - dir] += error
        pixels[idx + width] += error
        if (xAhead1 >= 0 && xAhead1 < width) pixels[idx + width + dir] += error
      }
      if (y + 2 < height) {
        pixels[idx + width * 2] += error
      }
    }
  }
}

function applyFloydSteinberg(
  pixels: Float32Array,
  width: number,
  height: number,
  is2bit: boolean
): void {
  for (let y = 0; y < height; y++) {
    const reverse = (y & 1) === 1
    const dir = reverse ? -1 : 1

    for (let i = 0; i < width; i++) {
      const x = reverse ? width - 1 - i : i
      const idx = y * width + x
      const oldPixel = pixels[idx]
      const newPixel = quantizePixel(oldPixel, is2bit)
      pixels[idx] = newPixel
      const error = clampError(oldPixel - newPixel)

      const xAhead = x + dir
      const xBehind = x - dir

      if (xAhead >= 0 && xAhead < width) pixels[idx + dir] += error * 7 / 16
      if (y + 1 < height) {
        if (xBehind >= 0 && xBehind < width) pixels[idx + width - dir] += error * 3 / 16
        pixels[idx + width] += error * 5 / 16
        if (xAhead >= 0 && xAhead < width) pixels[idx + width + dir] += error * 1 / 16
      }
    }
  }
}

const BAYER_8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21]
]

function applyOrdered(
  pixels: Float32Array,
  width: number,
  height: number,
  is2bit: boolean
): void {
  const amplitude2bit = 85

  for (let y = 0; y < height; y++) {
    const row = BAYER_8[y & 7]
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const matrixValue = row[x & 7]

      if (is2bit) {
        const adjusted = pixels[idx] + (((matrixValue + 0.5) / 64) - 0.5) * amplitude2bit
        pixels[idx] = quantizePixel(Math.max(0, Math.min(255, adjusted)), true)
      } else {
        const t = ((matrixValue + 0.5) / 64) * 255
        pixels[idx] = pixels[idx] > t ? 255 : 0
      }
    }
  }
}
