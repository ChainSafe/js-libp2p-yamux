import errcode from 'err-code'
import type { Uint8ArrayList } from 'uint8arraylist'
import { FrameHeader, FrameType, HEADER_LENGTH } from './frame.js'
import { ERR_INVALID_FRAME } from './constants.js'

export function encodeFrame (header: FrameHeader, data?: Uint8Array | Uint8ArrayList): Uint8Array {
  let frame
  if (header.type === FrameType.Data) {
    if (data == null) {
      throw errcode(new Error('Invalid frame'), ERR_INVALID_FRAME, { header, data })
    }
    frame = new Uint8Array(HEADER_LENGTH + header.length)
    frame.set(data instanceof Uint8Array ? data : data.subarray(), HEADER_LENGTH)
  } else {
    frame = new Uint8Array(HEADER_LENGTH)
  }

  // always assume version 0
  // frameView.setUint8(0, header.version)

  frame[1] = header.type

  frame[2] = header.flag >>> 8 & 255
  frame[3] = header.flag & 255

  frame[4] = header.streamID >>> 24 & 255
  frame[5] = header.streamID >>> 16 & 255
  frame[6] = header.streamID >>> 8 & 255
  frame[7] = header.streamID & 255

  frame[8] = header.length >>> 24 & 255
  frame[9] = header.length >>> 16 & 255
  frame[10] = header.length >>> 8 & 255
  frame[11] = header.length & 255

  return frame
}
