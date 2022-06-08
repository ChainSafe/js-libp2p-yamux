import type { Components } from '@libp2p/interfaces/components'
import type { Stream } from '@libp2p/interfaces/connection'
import type { StreamMuxer, StreamMuxerFactory, StreamMuxerInit } from '@libp2p/interfaces/stream-muxer'
import { abortableSource } from 'abortable-iterator'
import { pipe } from 'it-pipe'
import type { Source } from 'it-stream-types'
import { trackedMap } from '@libp2p/tracked-map'
import { pushable, Pushable } from 'it-pushable'
import errcode from 'err-code'
import anySignal from 'any-signal'
import { Flag, FrameHeader, FrameType, GoAwayCode, stringifyHeader } from './frame.js'
import { StreamState, YamuxStream } from './stream.js'
import { encodeFrame } from './encode.js'
import { ERR_BOTH_CLIENTS, ERR_INVALID_FRAME, ERR_NOT_MATCHING_PING, ERR_STREAM_ALREADY_EXISTS, ERR_UNREQUESTED_PING } from './constants.js'
import { Config, defaultConfig, verifyConfig } from './config.js'
import { Decoder } from './decode.js'
import type { Logger } from '@libp2p/logger'

const YAMUX_PROTOCOL_ID = '/yamux/1.0.0'

export interface YamuxMuxerInit extends StreamMuxerInit, Partial<Config> {
  /** True if client, false if server */
  client?: boolean
}

export class Yamux implements StreamMuxerFactory {
  protocol = YAMUX_PROTOCOL_ID
  createStreamMuxer (components: Components, init?: YamuxMuxerInit): YamuxMuxer {
    return new YamuxMuxer(components, init)
  }
}

export class YamuxMuxer implements StreamMuxer {
  protocol = YAMUX_PROTOCOL_ID
  source: Pushable<Uint8Array>

  private readonly _init: YamuxMuxerInit
  private readonly config: Config
  private readonly log?: Logger

  /** The next stream id to be used when initiating a new stream */
  private nextStreamID: number
  /** Primary stream mapping, streamID => stream */
  private readonly _streams: Map<number, YamuxStream>

  /** The next ping id to be used when pinging */
  private nextPingID: number
  /** Tracking info for the currently active ping */
  private activePing?: { id: number, started: number }
  /** Round trip time */
  private rtt: number

  private readonly client: boolean

  private readonly goAway: {local?: GoAwayCode, remote?: GoAwayCode} = {
    local: undefined,
    remote: undefined
  }

  /** Used to close the muxer from either the sink or source */
  private readonly closeController: AbortController

  private readonly onIncomingStream?: (stream: Stream) => void
  private readonly onStreamEnd?: (stream: Stream) => void

  constructor (components: Components, init: YamuxMuxerInit = {}) {
    this._init = init
    this.client = Boolean(init.client)
    this.config = { ...defaultConfig, ...init }
    this.log = this.config.log
    verifyConfig(this.config)

    this.onIncomingStream = init.onIncomingStream
    this.onStreamEnd = init.onStreamEnd

    this._streams = trackedMap({ metrics: components.getMetrics(), component: 'yamux', metric: 'streams' })
    this.source = pushable({
      onEnd: (err?: Error): void => {
        this.log?.('muxer source ended')
        this.close(err != null ? GoAwayCode.InternalError : GoAwayCode.NormalTermination, err)
      }
    })
    this.closeController = new AbortController()
    // client uses odd streamIDs, server uses even streamIDs
    this.nextStreamID = this.client ? 1 : 2

    this.nextPingID = 0
    this.rtt = 0

    if (this.config.enableKeepAlive) {
      void this.keepAlive()
    }
  }

  get streams (): Stream[] {
    return Array.from(this._streams.values())
  }

  newStream (name?: string | undefined): YamuxStream {
    const id = this.nextStreamID
    this.nextStreamID += 2

    this.log?.('new outgoing stream id=%s', id)

    const stream = this._newStream(id, name)

    // send a window update to open the stream on the receiver end
    stream.sendWindowUpdate()

    return stream
  }

  async sink (source: Source<Uint8Array>): Promise<void> {
    source = abortableSource(
      source,
      this._init.signal !== undefined
        ? anySignal([this.closeController.signal, this._init.signal])
        : this.closeController.signal,
      { returnOnAbort: true }
    )

    let reason, error
    try {
      const decoder = new Decoder(source)
      await pipe(
        decoder.emitFrames.bind(decoder),
        async source => {
          for await (const { header, readData } of source) {
            await this.handleFrame(header, readData)
          }
        }
      )

      reason = GoAwayCode.NormalTermination
    } catch (err: unknown) {
      // either a protocol or internal error
      const errCode = (err as {code?: string}).code
      if (errCode === ERR_INVALID_FRAME || errCode === ERR_UNREQUESTED_PING || errCode === ERR_NOT_MATCHING_PING) {
        this.log?.error('protocol error in sink', err)
        reason = GoAwayCode.ProtocolError
      } else {
        this.log?.error('internal error in sink', err)
        reason = GoAwayCode.InternalError
      }

      error = err as Error
    }

    this.log?.('muxer sink ended')

    void error
    void reason
    this.close(reason, error)
  }

  /**
   * Close the muxer
   *
   * @param reason - If provided, will trigger a GoAway message to be sent with this code
   * @param err - If provided, will be passed to underlying streams
   */
  close (reason?: GoAwayCode, err?: Error): void {
    if (this.closeController.signal.aborted) {
      // already closed
      return
    }

    this.log?.('muxer close reason=%s error=%s', GoAwayCode[reason ?? GoAwayCode.NormalTermination], err)

    this.closeController.abort()

    // Abort all underlying streams
    for (const stream of this._streams.values()) {
      stream.abort(err)
    }

    // If a reason was given, send it to the other side, allow the other side to close gracefully
    if (reason != null) {
      this.sendGoAway(reason)
    }

    this.source.end(err)
  }

  /** Create a new stream and set it in the stream mapping */
  private _newStream (id: number, name?: string | undefined, state = StreamState.Init): YamuxStream {
    if (this._streams.get(id) != null) {
      throw errcode(new Error('Stream already exists'), ERR_STREAM_ALREADY_EXISTS, { id })
    }

    const stream = new YamuxStream({
      id,
      name,
      state,
      sendFrame: this.sendFrame.bind(this),
      onStreamEnd: () => {
        this.closeStream(id)
        this.onStreamEnd?.(stream)
      },
      log: this.log,
      config: this.config,
      getRTT: () => this.rtt
    })

    this.log?.trace('new stream id=%s state=%s', id, StreamState[state])

    this._streams.set(id, stream)
    return stream
  }

  /**
   * closeStream is used to close a stream once both sides have
   * issued a close.
   */
  private closeStream (id: number): void {
    this._streams.delete(id)
  }

  private async keepAlive (): Promise<void> {
    const abortPromise = new Promise((_resolve, reject) => this.closeController.signal.addEventListener('abort', reject, { once: true }))
    while (true) {
      try {
        await Promise.race([
          abortPromise,
          new Promise((resolve) => setTimeout(resolve, this.config.keepAliveInterval))
        ])
        this.sendPing(this.nextPingID++)
      } catch (e) {
        // closed
        return
      }
    }
  }

  private async handleFrame (header: FrameHeader, readData?: () => Promise<Uint8Array>): Promise<void> {
    const {
      streamID,
      type,
      length
    } = header
    this.log?.trace('received frame %s', stringifyHeader(header))

    if (streamID === 0) {
      switch (type) {
        case FrameType.Ping:
          return this.handlePing(header)
        case FrameType.GoAway:
          return this.handleGoAway(length)
        default:
          // Invalid state
          throw errcode(new Error('Invalid frame type'), ERR_INVALID_FRAME, { header })
      }
    } else {
      switch (header.type) {
        case FrameType.Data:
        case FrameType.WindowUpdate:
          return await this.handleStreamMessage(header, readData)
        default:
          // Invalid state
          throw errcode(new Error('Invalid frame type'), ERR_INVALID_FRAME, { header })
      }
    }
  }

  private handlePing (header: FrameHeader): void {
    // If the ping  is initiated by the sender, send a response
    if (header.flag === Flag.SYN) {
      this.sendPing(length, Flag.ACK)
    } else if (header.flag === Flag.ACK) {
      this.handlePingResponse(length)
    } else {
      // Invalid state
      throw errcode(new Error('Invalid frame flag'), ERR_INVALID_FRAME, { header })
    }
  }

  private handlePingResponse (pingId: number): void {
    if (this.activePing == null) {
      // this ping was not requested
      throw errcode(new Error('ping not requested'), ERR_UNREQUESTED_PING)
    }
    if (this.activePing.id !== pingId) {
      // this ping doesn't match our active ping request
      throw errcode(new Error('ping doesn\'t match our id'), ERR_NOT_MATCHING_PING)
    }

    // valid ping response

    // update RTT
    this.rtt = Date.now() - this.activePing.started

    // clear the active ping
    delete this.activePing
  }

  private handleGoAway (reason: GoAwayCode): void {
    this.log?.('received GoAway reason=%s', GoAwayCode[reason] ?? 'unknown')
    this.close()
  }

  private async handleStreamMessage (header: FrameHeader, readData?: () => Promise<Uint8Array>): Promise<void> {
    const { streamID, flag, type } = header

    if ((flag & Flag.SYN) === Flag.SYN) {
      this.incomingStream(streamID)
    }

    const stream = this._streams.get(streamID)
    if (stream === undefined) {
      if (type === FrameType.Data) {
        this.log?.('discarding data for stream id=%s', streamID)
        if (readData === undefined) {
          throw new Error('unreachable')
        }
        await readData()
      } else {
        this.log?.('frame for missing stream id=%s', streamID)
      }
      return
    }

    switch (type) {
      case FrameType.WindowUpdate: {
        return stream.handleWindowUpdate(header)
      }
      case FrameType.Data: {
        if (readData === undefined) {
          throw new Error('unreachable')
        }

        return await stream.handleData(header, readData)
      }
      default:
        throw new Error('unreachable')
    }
  }

  private incomingStream (id: number): void {
    if (this._streams.has(id)) {
      return
    }
    if (this.client !== (id % 2 === 0)) {
      throw errcode(new Error('both endpoints are clients'), ERR_BOTH_CLIENTS)
    }

    this.log?.('new incoming stream id=%s', id)

    if (this.goAway.local !== undefined) {
      // reject (reset) immediately if we are doing a go away
      return this.sendFrame({
        type: FrameType.WindowUpdate,
        flag: Flag.RST,
        streamID: id,
        length: 0
      })
    }

    // allocate a new stream
    const stream = this._newStream(id, undefined, StreamState.SYNReceived)
    this.onIncomingStream?.(stream)
  }

  private sendFrame (header: FrameHeader, data?: Uint8Array): void {
    this.log?.trace('sending frame %s', stringifyHeader(header))
    this.source.push(encodeFrame(header, data))
  }

  private sendPing (pingId: number, flag: Flag = Flag.SYN): void {
    if (flag === Flag.SYN) {
      if (this.activePing != null) {
        // We already have an active ping, don't send another
        return
      }
      this.activePing = { id: pingId, started: Date.now() }
    }
    this.log?.('sending ping pingId=%s', pingId)
    this.sendFrame({
      type: FrameType.Ping,
      flag: flag,
      streamID: 0,
      length: pingId
    })
  }

  private sendGoAway (reason: GoAwayCode = GoAwayCode.NormalTermination): void {
    this.log?.('sending GoAway reason=%s', GoAwayCode[reason])
    this.goAway.local = reason
    this.sendFrame({
      type: FrameType.GoAway,
      flag: 0,
      streamID: 0,
      length: reason
    })
  }
}
