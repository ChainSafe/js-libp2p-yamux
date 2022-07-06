import errcode from 'err-code'
import { ERR_DECODE_INVALID_VERSION, ERR_INVALID_FRAME } from '../src/constants.js'
import { FrameHeader, FrameType, HEADER_LENGTH, YAMUX_VERSION } from '../src/frame.js'

// Slower encode / decode functions that use dataview

export function decodeHeaderNaive (data: Uint8Array): FrameHeader {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  if (view.getUint8(0) !== YAMUX_VERSION) {
    throw errcode(new Error('Invalid frame version'), ERR_DECODE_INVALID_VERSION)
  }
  return {
    type: view.getUint8(1),
    flag: view.getUint16(2, false),
    streamID: view.getUint32(4, false),
    length: view.getUint32(8, false)
  }
}

export function encodeFrameNaive (header: FrameHeader, data?: Uint8Array): Uint8Array {
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

  const frameView = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)

  // always assume version 0
  // frameView.setUint8(0, header.version)

  frameView.setUint8(1, header.type)
  frameView.setUint16(2, header.flag, false)
  frameView.setUint32(4, header.streamID, false)
  frameView.setUint32(8, header.length, false)

  return frame
}
