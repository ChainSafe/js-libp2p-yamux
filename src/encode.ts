import errcode from 'err-code'
import { FrameHeader, FrameType, HEADER_LENGTH } from './frame.js'
import { ERR_INVALID_FRAME } from './constants.js'

export function encodeFrame (header: FrameHeader, data?: Uint8Array): Uint8Array {
  let frame
  if (header.type === FrameType.Data) {
    if (data == null) {
      throw errcode(new Error('Invalid frame'), ERR_INVALID_FRAME, { header, data })
    }
    frame = new Uint8Array(HEADER_LENGTH + header.length)
    frame.set(data, HEADER_LENGTH)
  } else {
    frame = new Uint8Array(HEADER_LENGTH)
  }

  const frameView = new DataView(frame.buffer)

  // always assume version 0
  // frameView.setUint8(0, header.version)

  // TODO: more error checking
  frameView.setUint8(1, header.type)
  frameView.setUint16(2, header.flag, false)
  frameView.setUint32(4, header.streamID, false)
  frameView.setUint32(8, header.length, false)

  return frame
}
