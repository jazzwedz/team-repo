// Minimal, dependency-free ZIP reader (server-side).
//
// Office Open XML files (.xlsx, .docx, .pptx) are ZIP archives of XML, and
// the corporate npm registry won't serve a ZIP/spreadsheet library — so we
// read the archive ourselves using only Node's built-in `zlib` for the
// DEFLATE entries. Handles stored (method 0) and deflate (method 8); ZIP64
// is not handled (fine for typical Office documents). Reusable by any
// OOXML extractor.

import zlib from "zlib"

const EOCD_SIG = 0x06054b50 // end of central directory
const CEN_SIG = 0x02014b50 // central directory file header

/**
 * Read every entry of a ZIP buffer into a map of { path → uncompressed bytes }.
 * Throws if the buffer isn't a ZIP. Individual undecodable entries are skipped.
 */
export function readZipEntries(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>()

  // Find the End-Of-Central-Directory record by scanning backwards (the ZIP
  // comment, if any, sits after it — max 65535 bytes).
  let eocd = -1
  const scanFloor = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= scanFloor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP archive (no end-of-central-directory record).")

  const total = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16) // central directory start offset

  for (let n = 0; n < total; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CEN_SIG) break
    const method = buf.readUInt16LE(off + 10)
    const uncompSize = buf.readUInt32LE(off + 24)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen)

    // The local header repeats name/extra; the data starts after them.
    if (localOff + 30 <= buf.length && buf.readUInt32LE(localOff) === 0x04034b50) {
      const lNameLen = buf.readUInt16LE(localOff + 26)
      const lExtraLen = buf.readUInt16LE(localOff + 28)
      const dataStart = localOff + 30 + lNameLen + lExtraLen
      try {
        let content: Buffer
        if (method === 0) {
          content = Buffer.from(buf.subarray(dataStart, dataStart + uncompSize))
        } else {
          // Inflate the raw deflate stream; it stops at the stream's final
          // block, so trailing archive bytes are harmless.
          content = zlib.inflateRawSync(buf.subarray(dataStart))
        }
        out.set(name, content)
      } catch {
        // skip an entry we can't decode
      }
    }

    off += 46 + nameLen + extraLen + commentLen
  }

  return out
}
