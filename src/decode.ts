import { Uint8ArrayList } from 'uint8arraylist'
import errcode from 'err-code'
import { FrameHeader, FrameType, HEADER_LENGTH, YAMUX_VERSION } from './frame.js'
import { ERR_DECODE_INVALID_VERSION } from './constants.js'
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

export class Decoder {
  /** Buffer for in-progress frames */
  private readonly buffer: Uint8ArrayList
  private readonly source: Source<Uint8Array>

  constructor (source: Source<Uint8Array>) {
    this.source = source
    this.buffer = new Uint8ArrayList()
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
          // If this is a data frame, the frame body must still be read
          // `readData` must be called before the next iteration here
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
    return out
  }
}
