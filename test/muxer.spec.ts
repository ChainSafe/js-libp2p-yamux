/* eslint-env mocha */

import { duplexPair } from 'it-pair/duplex'
import { pipe } from 'it-pipe'
import { expect } from 'aegir/chai'
import { sleep, testClientServer, testYamuxMuxer } from './util.js'
import { ERR_MUXER_LOCAL_CLOSED } from '../src/constants.js'

describe('muxer', () => {
  it('test repeated close', async () => {
    const client1 = testYamuxMuxer('libp2p:yamux:1', true)
    // inspect logs to ensure its only closed once
    client1.close()
    client1.close()
    client1.close()
  })

  it('test client<->client', async () => {
    const pair = duplexPair<Uint8Array>()
    const client1 = testYamuxMuxer('libp2p:yamux:1', true)
    const client2 = testYamuxMuxer('libp2p:yamux:2', true)
    void pipe(pair[0], client1, pair[0])
    void pipe(pair[1], client2, pair[1])
    client1.newStream()
    client2.newStream()

    await sleep(20)

    expect(client1.isClosed()).to.equal(true)
    expect(client2.isClosed()).to.equal(true)
  })

  it('test server<->server', async () => {
    const pair = duplexPair<Uint8Array>()
    const client1 = testYamuxMuxer('libp2p:yamux:1', false)
    const client2 = testYamuxMuxer('libp2p:yamux:2', false)
    void pipe(pair[0], client1, pair[0])
    void pipe(pair[1], client2, pair[1])
    client1.newStream()
    client2.newStream()

    await sleep(20)

    expect(client1.isClosed()).to.equal(true)
    expect(client2.isClosed()).to.equal(true)
  })

  it('test ping', async () => {
    const { client, server } = testClientServer()

    server.pauseRead()
    const clientRTT = client.ping()
    await sleep(10)
    server.unpauseRead()
    expect(await clientRTT).to.not.equal(0)

    server.pauseWrite()
    const serverRTT = server.ping()
    await sleep(10)
    server.unpauseWrite()
    expect(await serverRTT).to.not.equal(0)

    client.close()
    server.close()
  })

  it('test multiple simultaneous pings', async () => {
    const { client } = testClientServer()

    client.pauseWrite()
    const promise = [
      client.ping(),
      client.ping(),
      client.ping()
    ]
    await sleep(10)
    client.unpauseWrite()

    const clientRTTs = await Promise.all(promise)
    expect(clientRTTs[0]).to.not.equal(0)
    expect(clientRTTs[0]).to.equal(clientRTTs[1])
    expect(clientRTTs[1]).to.equal(clientRTTs[2])

    // eslint-disable-next-line @typescript-eslint/dot-notation
    expect(client['nextPingID']).to.equal(1)

    client.close()
  })

  it('test go away', () => {
    const { client } = testClientServer()
    client.close()
    try {
      client.newStream()
      expect.fail('should not be able to open a stream after close')
    } catch (e) {
      expect((e as { code: string }).code).to.equal(ERR_MUXER_LOCAL_CLOSED)
    }
  })

  it('test keep alive', async () => {
    const { client } = testClientServer({ enableKeepAlive: true, keepAliveInterval: 10 })

    await sleep(100)

    // eslint-disable-next-line @typescript-eslint/dot-notation
    expect(client['nextPingID']).to.be.gt(2)
    client.close()
  })

  it('test max inbound streams', async () => {
    const { client, server } = testClientServer({ maxInboundStreams: 1 })
    client.newStream()
    client.newStream()
    await sleep(10)

    expect(server.streams.length).to.equal(1)
    expect(client.streams.length).to.equal(1)
  })

  it('test max outbound streams', async () => {
    const { client, server } = testClientServer({ maxOutboundStreams: 1 })
    client.newStream()
    await sleep(10)

    try {
      client.newStream()
      expect.fail('stream creation should fail if exceeding maxOutboundStreams')
    } catch (e) {
      expect(server.streams.length).to.equal(1)
      expect(client.streams.length).to.equal(1)
    }
  })
})
