// XTC container format for XTEink X4/X3 e-readers.
// Adapted from xtcjs (https://github.com/varo6/xtcjs), MIT License.

export interface TocEntry {
  title: string
  startPage: number
  endPage: number
}

export interface BookMetadata {
  title: string
  author: string
  toc: TocEntry[]
}

interface XtcBuildOptions {
  metadata?: BookMetadata
  is2bit?: boolean
}

// Header: 48 bytes base + 8 bytes TOC offset pointer = 56 bytes total
const HEADER_BASE_SIZE = 48
const TOC_OFFSET_PTR_SIZE = 8
const HEADER_WITH_METADATA_SIZE = HEADER_BASE_SIZE + TOC_OFFSET_PTR_SIZE
const INDEX_ENTRY_SIZE = 16
const TITLE_SIZE = 128
const AUTHOR_SIZE = 112 // 112 bytes, not 128 - TOC header comes right after
const TOC_HEADER_SIZE = 16
const TOC_ENTRY_SIZE = 96
const TOC_TITLE_SIZE = 80

const FLAG_HAS_METADATA_LOW = 0x01000100
const FLAG_HAS_METADATA_HIGH = 0x00000001

function getXtgDimensions(xtgBlob: ArrayBuffer): { width: number; height: number } {
  if (xtgBlob.byteLength < 8) {
    return { width: 480, height: 800 }
  }
  const view = new DataView(xtgBlob)
  return {
    width: view.getUint16(4, true),
    height: view.getUint16(6, true)
  }
}

/**
 * Build an XTC file from pre-encoded XTG/XTH page blobs.
 */
export function buildXtcFromPages(
  pageBlobs: ArrayBuffer[],
  options: XtcBuildOptions = {}
): ArrayBuffer {
  const is2bit = options.is2bit || false
  const pageCount = pageBlobs.length
  const hasMetadata = options.metadata && (
    options.metadata.title ||
    options.metadata.author ||
    options.metadata.toc.length > 0
  )

  let metadataSize = 0
  let tocEntriesOffset = 0

  if (hasMetadata) {
    // Structure: Header(56) + Title(128) + Author(112) + TOC Header(16) + TOC Entries(N*96)
    metadataSize = TITLE_SIZE + AUTHOR_SIZE + TOC_HEADER_SIZE
    if (options.metadata!.toc.length > 0) {
      metadataSize += options.metadata!.toc.length * TOC_ENTRY_SIZE
    }
    tocEntriesOffset = HEADER_WITH_METADATA_SIZE + TITLE_SIZE + AUTHOR_SIZE + TOC_HEADER_SIZE
  }

  const headerSize = hasMetadata ? HEADER_WITH_METADATA_SIZE : HEADER_BASE_SIZE
  const metadataOffset = hasMetadata ? HEADER_WITH_METADATA_SIZE : 0
  const indexOffset = headerSize + metadataSize
  const dataOffset = indexOffset + (pageCount * INDEX_ENTRY_SIZE)

  let totalSize = dataOffset
  for (const blob of pageBlobs) {
    totalSize += blob.byteLength
  }

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const uint8 = new Uint8Array(buffer)

  // Magic: XTC / XTCH
  if (is2bit) {
    uint8[0] = 0x58; uint8[1] = 0x54; uint8[2] = 0x43; uint8[3] = 0x48
  } else {
    uint8[0] = 0x58; uint8[1] = 0x54; uint8[2] = 0x43; uint8[3] = 0x00
  }
  view.setUint16(4, 1, true) // version
  view.setUint16(6, pageCount, true)

  if (hasMetadata) {
    view.setUint32(8, FLAG_HAS_METADATA_LOW, true)
    view.setUint32(12, FLAG_HAS_METADATA_HIGH, true)
  } else {
    view.setUint32(8, 0, true)
    view.setUint32(12, 0, true)
  }

  setBigUint64(view, 16, BigInt(metadataOffset))
  setBigUint64(view, 24, BigInt(indexOffset))
  setBigUint64(view, 32, BigInt(dataOffset))
  setBigUint64(view, 40, 0n)

  if (hasMetadata) {
    setBigUint64(view, 48, BigInt(tocEntriesOffset))
  }

  if (hasMetadata && options.metadata) {
    writeMetadata(uint8, view, HEADER_WITH_METADATA_SIZE, options.metadata)
  }

  let relOffset = dataOffset
  for (let i = 0; i < pageCount; i++) {
    const blob = pageBlobs[i]
    const entryOffset = indexOffset + i * INDEX_ENTRY_SIZE
    const dimensions = getXtgDimensions(blob)

    setBigUint64(view, entryOffset, BigInt(relOffset))
    view.setUint32(entryOffset + 8, blob.byteLength, true)
    view.setUint16(entryOffset + 12, dimensions.width, true)
    view.setUint16(entryOffset + 14, dimensions.height, true)

    relOffset += blob.byteLength
  }

  let writeOffset = dataOffset
  for (const blob of pageBlobs) {
    uint8.set(new Uint8Array(blob), writeOffset)
    writeOffset += blob.byteLength
  }

  return buffer
}

function writeMetadata(
  uint8: Uint8Array,
  view: DataView,
  offset: number,
  metadata: BookMetadata
): void {
  const encoder = new TextEncoder()
  let currentOffset = offset

  if (metadata.title) {
    const titleBytes = encoder.encode(metadata.title)
    const titleLen = Math.min(titleBytes.length, TITLE_SIZE - 1)
    uint8.set(titleBytes.subarray(0, titleLen), currentOffset)
  }
  currentOffset += TITLE_SIZE

  if (metadata.author) {
    const authorBytes = encoder.encode(metadata.author)
    const authorLen = Math.min(authorBytes.length, AUTHOR_SIZE - 1)
    uint8.set(authorBytes.subarray(0, authorLen), currentOffset)
  }
  currentOffset += AUTHOR_SIZE

  writeTocHeader(view, currentOffset, metadata.toc.length)
  currentOffset += TOC_HEADER_SIZE

  if (metadata.toc.length > 0) {
    writeTocEntries(uint8, view, currentOffset, metadata.toc)
  }
}

function writeTocHeader(view: DataView, offset: number, chapterCount: number): void {
  // 4 bytes timestamp, 2 bytes reserved, 2 bytes chapter count, 8 bytes padding
  const timestamp = Math.floor(Date.now() / 1000)
  view.setUint32(offset, timestamp, true)
  view.setUint16(offset + 4, 0, true)
  view.setUint16(offset + 6, chapterCount, true)
}

function writeTocEntries(
  uint8: Uint8Array,
  view: DataView,
  offset: number,
  toc: TocEntry[]
): void {
  const encoder = new TextEncoder()
  let entryOffset = offset

  for (const entry of toc) {
    const titleBytes = encoder.encode(entry.title)
    const titleLen = Math.min(titleBytes.length, TOC_TITLE_SIZE - 1)
    uint8.set(titleBytes.subarray(0, titleLen), entryOffset)

    view.setUint16(entryOffset + TOC_TITLE_SIZE, entry.startPage, true)
    view.setUint16(entryOffset + TOC_TITLE_SIZE + 2, entry.endPage, true)

    entryOffset += TOC_ENTRY_SIZE
  }
}

function setBigUint64(view: DataView, offset: number, value: bigint): void {
  const low = Number(value & 0xFFFFFFFFn)
  const high = Number(value >> 32n)
  view.setUint32(offset, low, true)
  view.setUint32(offset + 4, high, true)
}
