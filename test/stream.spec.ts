/* eslint-env mocha */

import { pipe } from 'it-pipe'
import { expect } from 'aegir/chai'
import { sleep, testClientServer } from './util.js'
import { HalfStreamState, StreamState } from '../src/stream.js'
import { Pushable, pushable } from 'it-pushable'
import { defaultConfig } from '../src/config.js'
import { ERR_STREAM_RESET } from '../src/constants.js'
import { GoAwayCode } from '../src/frame.js'

describe('stream', () => {
  it('test send data - small', async () => {
    const { client, server } = testClientServer({ initialStreamWindowSize: defaultConfig.initialStreamWindowSize })
    const { default: drain } = await import('it-drain')

    const p = pushable()
    const c1 = client.newStream()
    await sleep(10)

    const s1 = server.streams[0]
    const sendPipe = pipe(p, c1)
    const recvPipe = pipe(s1, drain)
    for (let i = 0; i < 10; i++) {
      p.push(new Uint8Array(256))
    }
    p.end()

    await Promise.all([sendPipe, recvPipe])

    // the window capacities should have refilled via window updates as received data was consumed

    // eslint-disable-next-line @typescript-eslint/dot-notation
    expect(c1['sendWindowCapacity']).to.equal(defaultConfig.initialStreamWindowSize)
    // eslint-disable-next-line @typescript-eslint/dot-notation
    expect(s1['recvWindowCapacity']).to.equal(defaultConfig.initialStreamWindowSize)
  })

  it('test send data - large', async () => {
    const { client, server } = testClientServer({ initialStreamWindowSize: defaultConfig.initialStreamWindowSize })
    const { default: drain } = await import('it-drain')

    const p = pushable()
    const c1 = client.newStream()
    await sleep(10)

    const s1 = server.streams[0]
    const sendPipe = pipe(p, c1)
    const recvPipe = pipe(s1, drain)
    // amount of data is greater than initial window size
    // and each payload is also greater than the max message size
    // this will payload chunking and also waiting for window updates before continuing to send
    for (let i = 0; i < 10; i++) {
      p.push(new Uint8Array(defaultConfig.initialStreamWindowSize))
    }
    p.end()

    await Promise.all([sendPipe, recvPipe])
    // the window capacities should have refilled via window updates as received data was consumed

    // eslint-disable-next-line @typescript-eslint/dot-notation
    expect(c1['sendWindowCapacity']).to.equal(defaultConfig.initialStreamWindowSize)
    // eslint-disable-next-line @typescript-eslint/dot-notation
    expect(s1['recvWindowCapacity']).to.equal(defaultConfig.initialStreamWindowSize)
  })

  it('test send data - large with increasing recv window size', async () => {
    const { client, server } = testClientServer({ initialStreamWindowSize: defaultConfig.initialStreamWindowSize })
    const { default: drain } = await import('it-drain')

    const p = pushable()
    const c1 = client.newStream()

    server.pauseWrite()
    void server.ping()
    await sleep(10)
    server.unpauseWrite()

    const s1 = server.streams[0]
    const sendPipe = pipe(p, c1)
    const recvPipe = pipe(s1, drain)
    // amount of data is greater than initial window size
    // and each payload is also greater than the max message size
    // this will payload chunking and also waiting for window updates before continuing to send
    for (let i = 0; i < 10; i++) {
      p.push(new Uint8Array(defaultConfig.initialStreamWindowSize))
    }
    p.end()

    await Promise.all([sendPipe, recvPipe])
    // the window capacities should have refilled via window updates as received data was consumed

    // eslint-disable-next-line @typescript-eslint/dot-notation
    expect(c1['sendWindowCapacity']).to.be.gt(defaultConfig.initialStreamWindowSize)
    // eslint-disable-next-line @typescript-eslint/dot-notation
    expect(s1['recvWindowCapacity']).to.be.gt(defaultConfig.initialStreamWindowSize)
  })

  it('test many streams', async () => {
    const { client, server } = testClientServer()
    for (let i = 0; i < 1000; i++) {
      client.newStream()
    }
    await sleep(100)

    expect(client.streams.length).to.equal(1000)
    expect(server.streams.length).to.equal(1000)
  })

  it('test many streams - ping pong', async () => {
    const numStreams = 10
    const { client, server } = testClientServer({
      // echo on incoming streams
      onIncomingStream: (stream) => { void pipe(stream, stream) }
    })

    const p: Array<Pushable<Uint8Array>> = []
    for (let i = 0; i < numStreams; i++) {
      client.newStream()
      p.push(pushable())
    }
    await sleep(100)

    for (let i = 0; i < numStreams; i++) {
      const s = client.streams[i]
      void pipe(p[i], s)
      p[i].push(new Uint8Array(16))
    }
    await sleep(100)

    expect(client.streams.length).to.equal(numStreams)
    expect(server.streams.length).to.equal(numStreams)

    client.close()
  })

  it('test stream close', async () => {
    const { client, server } = testClientServer()

    const c1 = client.newStream()
    c1.close()
    await sleep(5)

    expect(c1.state).to.equal(StreamState.Finished)

    const s1 = server.streams[0]
    expect(s1).to.not.be.undefined()
    expect(s1.state).to.equal(StreamState.SYNReceived)
  })

  it('test stream close read', async () => {
    const { client, server } = testClientServer()

    const c1 = client.newStream()
    c1.closeRead()
    await sleep(5)

    expect(c1.readState).to.equal(HalfStreamState.Closed)
    expect(c1.writeState).to.equal(HalfStreamState.Open)

    const s1 = server.streams[0]
    expect(s1).to.not.be.undefined()
    expect(s1.readState).to.equal(HalfStreamState.Open)
    expect(s1.writeState).to.equal(HalfStreamState.Open)
  })

  it('test stream close write', async () => {
    const { client, server } = testClientServer()

    const c1 = client.newStream()
    c1.closeWrite()
    await sleep(5)

    expect(c1.readState).to.equal(HalfStreamState.Open)
    expect(c1.writeState).to.equal(HalfStreamState.Closed)

    const s1 = server.streams[0]
    expect(s1).to.not.be.undefined()
    expect(s1.readState).to.equal(HalfStreamState.Closed)
    expect(s1.writeState).to.equal(HalfStreamState.Open)
  })

  it('test window overflow', async () => {
    const { client, server } = testClientServer({ maxMessageSize: defaultConfig.initialStreamWindowSize, initialStreamWindowSize: defaultConfig.initialStreamWindowSize })
    const { default: drain } = await import('it-drain')

    const p = pushable()
    const c1 = client.newStream()
    await sleep(10)

    const s1 = server.streams[0]
    const sendPipe = pipe(p, c1)

    // eslint-disable-next-line @typescript-eslint/dot-notation
    const c1SendData = c1['sendData'].bind(c1)
    // eslint-disable-next-line @typescript-eslint/dot-notation
    ;(c1 as any)['sendData'] = (data: Uint8Array): void => {
      // eslint-disable-next-line @typescript-eslint/dot-notation
      c1SendData(data)
      // eslint-disable-next-line @typescript-eslint/dot-notation
      c1['sendWindowCapacity'] = defaultConfig.initialStreamWindowSize * 10
    }
    p.push(new Uint8Array(defaultConfig.initialStreamWindowSize))
    p.push(new Uint8Array(defaultConfig.initialStreamWindowSize))

    await sleep(10)

    const recvPipe = pipe(s1, drain)
    p.end()

    try {
      await Promise.all([sendPipe, recvPipe])
    } catch (e) {
      expect((e as { code: string }).code).to.equal(ERR_STREAM_RESET)
    }
    // eslint-disable-next-line @typescript-eslint/dot-notation
    expect(client['remoteGoAway']).to.equal(GoAwayCode.ProtocolError)
    // eslint-disable-next-line @typescript-eslint/dot-notation
    expect(server['localGoAway']).to.equal(GoAwayCode.ProtocolError)
  })

  it('test stream sink error', async () => {
    const { client, server } = testClientServer()

    // don't let the server respond
    server.pauseRead()

    const p = pushable()
    const c1 = client.newStream()

    const sendPipe = pipe(p, c1)

    // send more data than the window size, will trigger a wait
    p.push(new Uint8Array(defaultConfig.initialStreamWindowSize))
    p.push(new Uint8Array(defaultConfig.initialStreamWindowSize))

    await sleep(10)

    // the client should close gracefully even though it was waiting to send more data
    client.close()
    p.end()

    await sendPipe
  })
})
