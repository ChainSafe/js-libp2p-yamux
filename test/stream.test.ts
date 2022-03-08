import { expect } from 'chai'
import { compare } from 'uint8arrays/compare'

import { STREAM_STATES, TYPES, VERSION } from '../src/constants'
import { Header } from '../src/header'
import { Session } from '../src/session'
import { Stream } from '../src/stream'

const createStream = (streamID = 0, state = STREAM_STATES.Init) => {
  const session = new Session(false)
  const stream = new Stream(session, streamID, state)

  return { streamID, stream, session }
}

describe('Stream', () => {
  it('has an ID', () => {
    const { session, streamID, stream } = createStream()
    expect(stream.ID()).to.equal(streamID)
    session.close()
  })

  it('can send a window update', (done) => {
    const { stream, session } = createStream()
    session.on('data', (data) => {
      expect(compare(data, Uint8Array.from([0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]))).to.equal(0)
      session.removeAllListeners('data')
      session.close()
      done()
    })
    stream.sendWindowUpdate()
  })

  it('tracks send window usage', (done) => {
    const { stream, session } = createStream(0, STREAM_STATES.Established)
    stream['sendWindow'] = 1
    session.on('data', (data) => {
      expect(compare(data, Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0xff]))).to.equal(0)
      expect(stream['sendWindow']).to.equal(0)
      session.removeAllListeners('data')
      session.close()
      done()
    })
    stream.write(Uint8Array.from([0xff]), () => stream.close())
  })

  it('waits for a window update if send window is empty', (done) => {
    const { stream, session } = createStream(0, STREAM_STATES.Established)
    const startTime = Date.now()
    stream['sendWindow'] = 0
    session.on('data', (data) => {
      expect(compare(data, Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0xff]))).to.equal(0)
      expect(stream['sendWindow']).to.equal(0)
      expect(Date.now() - startTime).to.be.greaterThan(50)
      session.removeAllListeners('data')
      session.close()
      done()
    })
    stream.write(Uint8Array.from([0xff]), () => stream.close())
    const hdr = new Header(VERSION, TYPES.WindowUpdate, 0, stream.ID(), 1)
    setTimeout(() => stream.incrSendWindow(hdr), 50)
  })

  it('does not send packets larger than send window', (done) => {
    const { stream, session } = createStream(0, STREAM_STATES.Established)
    let numberOfDataPackets = 0
    stream['sendWindow'] = 1
    session.on('data', (data) => {
      if (data[1] === 0) {
        // packet is of type Data
        numberOfDataPackets++
        expect(compare(data, Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0xff]))).to.equal(0)
        expect(stream['sendWindow']).to.equal(0)
        const hdr = new Header(VERSION, TYPES.WindowUpdate, 0, stream.ID(), 1)
        stream.incrSendWindow(hdr)
      }
    })
    stream.write(Uint8Array.from([0xff, 0xff]), () => {
      expect(numberOfDataPackets).to.equal(2)
      stream.close()
      session.removeAllListeners('data')
      session.close()
      done()
    })
  })

  it('can close when established', (done) => {
    // Established stream
    let { stream, session } = createStream(0, STREAM_STATES.Established)
    session.on('data', (data) => {
      expect(compare(data, Uint8Array.from([0, 1, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0]))).to.equal(0)
      session.removeAllListeners('data')
      session.close()
      done()
    })
    stream.close()
  })

  it('can close when connection is already closed', (done) => {
    const { stream, session } = createStream(0, STREAM_STATES.RemoteClose)
    session.on('data', (data) => {
      expect(compare(data, Uint8Array.from([0, 1, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0]))).to.equal(0)
      session.removeAllListeners('data')
      session.close()
      done()
    })
    stream.close()
  })
})
