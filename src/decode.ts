import { Uint8ArrayList } from 'uint8arraylist'
import errcode from 'err-code'
import { FrameHeader, FrameType, HEADER_LENGTH, YAMUX_VERSION } from './frame.js'
import { ERR_DECODE_INVALID_VERSION, ERR_DECODE_IN_PROGRESS } from './constants.js'
import type { Source } from 'it-stream-types'

/**
 * Decode a header from the front of a buffer
 *
 * @param buffer - Assumed to have enough bytes for a header
 */
export function decodeHeader (buffer: Uint8ArrayList): FrameHeader {
  if (buffer.get(0) !== YAMUX_VERSION) {
    throw errcode(new Error('Invalid frame version'), ERR_DECODE_INVALID_VERSION)
  }
  return {
    type: buffer.getUint8(1),
    flag: buffer.getUint16(2, false),
    streamID: buffer.getUint32(4, false),
    length: buffer.getUint32(8, false)
  }
}

/**
 * Decodes yamux frames from a source
 */
export class Decoder {
  private readonly source: Source<Uint8Array>
  /** Buffer for in-progress frames */
  private readonly buffer: Uint8ArrayList
  /** Used to sanity check against decoding while in an inconsistent state */
  private frameInProgress: boolean

  constructor (source: Source<Uint8Array>) {
    this.source = source
    this.buffer = new Uint8ArrayList()
    this.frameInProgress = false
  }

  async * emitFrames (): AsyncGenerator<{header: FrameHeader, readData?: () => Promise<Uint8Array>}> {
    for await (const chunk of this.source) {
      this.buffer.append(chunk)

      // Loop to consume as many bytes from the buffer as possible
      // Eg: when a single chunk contains several frames
      while (true) {
        const header = this.readHeader()
        if (header === undefined) {
          break
        }

        const { type, length } = header
        if (type === FrameType.Data) {
          // This is a data frame, the frame body must still be read
          // `readData` must be called before the next iteration here
          this.frameInProgress = true
          yield {
            header,
            readData: async () => await this.readBytes(length)
          }
        } else {
          yield { header }
        }
      }
    }
  }

  private readHeader (): FrameHeader | undefined {
    // Sanity check to ensure a header isn't read when another frame is partially decoded
    // In practice this shouldn't happen
    if (this.frameInProgress) {
      throw errcode(new Error('decoding frame already in progress'), ERR_DECODE_IN_PROGRESS)
    }

    if (this.buffer.length < HEADER_LENGTH) {
      // not enough data yet
      return
    }

    const header = decodeHeader(this.buffer)
    this.buffer.consume(HEADER_LENGTH)
    return header
  }

  private async readBytes (length: number): Promise<Uint8Array> {
    while (this.buffer.length < length) {
      for await (const chunk of this.source) {
        this.buffer.append(chunk)
      }
    }

    const out = this.buffer.slice(0, length)
    this.buffer.consume(length)

    // The next frame can now be decoded
    this.frameInProgress = false

    return out
  }
}
