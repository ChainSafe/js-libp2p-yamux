import { itBench } from '@dapplion/benchmark'
import { Flag, FrameHeader, FrameType } from '../../src/frame.js'
import { encodeFrame } from '../../src/encode.js'
import { decodeHeader } from '../../src/decode.js'
import { decodeHeaderNaive, encodeFrameNaive } from '../codec.util.js'

describe('codec benchmark', () => {
  for (const { encode, name } of [
    { encode: encodeFrame, name: 'encodeFrame' },
    { encode: encodeFrameNaive, name: 'encodeFrameNaive' }
  ]) {
    itBench<FrameHeader, undefined>({
      id: `frame header - ${name}`,
      beforeEach: () => {
        return {
          type: FrameType.WindowUpdate,
          flag: Flag.ACK,
          streamID: 0xffffffff,
          length: 0xffffffff
        }
      },
      fn: (header) => {
        encode(header)
      }
    })
  }

  for (const { decode, name } of [
    { decode: decodeHeader, name: 'decodeHeader' },
    { decode: decodeHeaderNaive, name: 'decodeHeaderNaive' }
  ]) {
    itBench<Uint8Array, undefined>({
      id: `frame header ${name}`,
      beforeEach: () => {
        const header = new Uint8Array(12)
        for (let i = 1; i < 12; i++) {
          header[i] = 255
        }
        return header
      },
      fn: (header) => {
        decode(header)
      }
    })
  }
})
