import type { Components } from '@libp2p/interfaces/components'
import type { Stream } from '@libp2p/interfaces/connection'
import type { StreamMuxer, StreamMuxerFactory, StreamMuxerInit } from '@libp2p/interfaces/stream-muxer'
import { abortableSource } from 'abortable-iterator'
import { pipe } from 'it-pipe'
import type { Sink, Source } from 'it-stream-types'
import { trackedMap } from '@libp2p/tracked-map'
import { pushable, Pushable } from 'it-pushable'
import errcode from 'err-code'
import anySignal from 'any-signal'
import { Flag, FrameHeader, FrameType, GoAwayCode, stringifyHeader } from './frame.js'
import { StreamState, YamuxStream } from './stream.js'
import { encodeFrame } from './encode.js'
import { ERR_BOTH_CLIENTS, ERR_INVALID_FRAME, ERR_MUXER_LOCAL_CLOSED, ERR_MUXER_REMOTE_CLOSED, ERR_NOT_MATCHING_PING, ERR_STREAM_ALREADY_EXISTS, ERR_UNREQUESTED_PING, PROTOCOL_ERRORS } from './constants.js'
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
  sink: Sink<Uint8Array>

  private readonly _init: YamuxMuxerInit
  private readonly config: Config
  private readonly log?: Logger

  /** Used to close the muxer from either the sink or source */
  private readonly closeController: AbortController

  /** The next stream id to be used when initiating a new stream */
  private nextStreamID: number
  /** Primary stream mapping, streamID => stream */
  private readonly _streams: Map<number, YamuxStream>

  /** The next ping id to be used when pinging */
  private nextPingID: number
  /** Tracking info for the currently active ping */
  private activePing?: { id: number, promise: Promise<void>, resolve: () => void }
  /** Round trip time */
  private rtt: number

  /** True if client, false if server */
  private readonly client: boolean

  private localGoAway?: GoAwayCode
  private remoteGoAway?: GoAwayCode

  /** Number of tracked incoming streams */
  private numIncomingStreams: number

  private readonly onIncomingStream?: (stream: Stream) => void
  private readonly onStreamEnd?: (stream: Stream) => void

  constructor (components: Components, init: YamuxMuxerInit = {}) {
    this._init = init
    this.client = Boolean(init.client)
    this.config = { ...defaultConfig, ...init }
    this.log = this.config.log
    verifyConfig(this.config)

    this.closeController = new AbortController()

    this.onIncomingStream = init.onIncomingStream
    this.onStreamEnd = init.onStreamEnd

    this._streams = trackedMap({ metrics: components.getMetrics(), component: 'yamux', metric: 'streams' })

    this.source = pushable({
      onEnd: (err?: Error): void => {
        this.log?.('muxer source ended')
        this.close(err != null ? GoAwayCode.InternalError : GoAwayCode.NormalTermination, err)
      }
    })

    this.sink = async (source: Source<Uint8Array>): Promise<void> => {
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
        const errCode = (err as {code: string}).code
        if (PROTOCOL_ERRORS.includes(errCode)) {
          this.log?.error('protocol error in sink', err)
          reason = GoAwayCode.ProtocolError
        } else {
          this.log?.error('internal error in sink', err)
          reason = GoAwayCode.InternalError
        }

        error = err as Error
      }

      this.log?.('muxer sink ended')

      this.close(reason, error)
    }

    this.numIncomingStreams = 0

    // client uses odd streamIDs, server uses even streamIDs
    this.nextStreamID = this.client ? 1 : 2

    this.nextPingID = 0
    this.rtt = 0

    this.log?.('muxer created')

    if (this.config.enableKeepAlive) {
      void this.keepAliveLoop()
    }
  }

  get streams (): YamuxStream[] {
    return Array.from(this._streams.values())
  }

  newStream (name?: string | undefined): YamuxStream {
    if (this.remoteGoAway !== undefined) {
      throw errcode(new Error('muxer closed remotely'), ERR_MUXER_REMOTE_CLOSED)
    }
    if (this.localGoAway !== undefined) {
      throw errcode(new Error('muxer closed locally'), ERR_MUXER_LOCAL_CLOSED)
    }

    const id = this.nextStreamID
    this.nextStreamID += 2

    this.log?.('new outgoing stream id=%s', id)

    const stream = this._newStream(id, name)
    this._streams.set(id, stream)

    // send a window update to open the stream on the receiver end
    stream.sendWindowUpdate()

    return stream
  }

  /**
   * Initiate a ping and wait for a response
   *
   * Note: only a single ping will be initiated at a time.
   * If a ping is already in progress, a new ping will not be initiated.
   *
   * @returns the round-trip-time in milliseconds
   */
  async ping (): Promise<number> {
    if (this.remoteGoAway !== undefined) {
      throw errcode(new Error('muxer closed remotely'), ERR_MUXER_REMOTE_CLOSED)
    }
    if (this.localGoAway !== undefined) {
      throw errcode(new Error('muxer closed locally'), ERR_MUXER_LOCAL_CLOSED)
    }

    // An active ping does not yet exist, handle the process here
    if (this.activePing === undefined) {
      // create active ping
      let _resolve = () => {}
      this.activePing = {
        id: this.nextPingID++,
        // this promise awaits resolution or the close controller aborting
        promise: new Promise<void>((resolve, reject) => {
          const closed = () => {
            reject(errcode(new Error('muxer closed locally'), ERR_MUXER_LOCAL_CLOSED))
          }
          this.closeController.signal.addEventListener('abort', closed, { once: true })
          _resolve = () => {
            this.closeController.signal.removeEventListener('abort', closed)
            resolve()
          }
        }),
        resolve: _resolve
      }
      // send ping
      const start = Date.now()
      this.sendPing(this.activePing.id)
      // await pong
      try {
        await this.activePing.promise
      } finally {
        // clean-up active ping
        delete this.activePing
      }
      // update rtt
      const end = Date.now()
      this.rtt = end - start
    } else {
      // an active ping is already in progress, piggyback off that
      await this.activePing.promise
    }
    return this.rtt
  }

  /**
   * Get the ping round trip time
   *
   * Note: Will return 0 if no successful ping has yet been completed
   *
   * @returns the round-trip-time in milliseconds
   */
  getRTT (): number {
    return this.rtt
  }

  /**
   * Close the muxer
   *
   * @param reason - The GoAway reason to be sent
   * @param err - Provided for logging purposes
   */
  close (reason = GoAwayCode.NormalTermination, err?: Error): void {
    if (this.closeController.signal.aborted) {
      // already closed
      return
    }

    this.log?.('muxer close reason=%s error=%s', GoAwayCode[reason ?? GoAwayCode.NormalTermination], err)

    // send reason to the other side, allow the other side to close gracefully
    this.sendGoAway(reason)

    this._closeMuxer()
  }

  isClosed (): boolean {
    return this.closeController.signal.aborted
  }

  /**
   * Called when either the local or remote shuts down the muxer
   */
  private _closeMuxer (): void {
    // stop the sink and any other processes
    this.closeController.abort()

    // reset all underlying streams
    // not using abort because we expect a GoAway (muxer-level abort) has already been issued
    for (const stream of this._streams.values()) {
      stream.reset()
    }

    this.source.end()
  }

  /** Create a new stream */
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

    return stream
  }

  /**
   * closeStream is used to close a stream once both sides have
   * issued a close.
   */
  private closeStream (id: number): void {
    if (this.client === (id % 2 === 0)) {
      this.numIncomingStreams--
    }
    this._streams.delete(id)
  }

  private async keepAliveLoop (): Promise<void> {
    const abortPromise = new Promise((_resolve, reject) => this.closeController.signal.addEventListener('abort', reject, { once: true }))
    this.log?.('muxer keepalive enabled interval=%s', this.config.keepAliveInterval)
    while (true) {
      let timeoutId
      try {
        await Promise.race([
          abortPromise,
          new Promise((resolve) => {
            timeoutId = setTimeout(resolve, this.config.keepAliveInterval)
          })
        ])
        void this.ping().catch(e => this.log?.error('ping error: %s', e))
      } catch (e) {
        // closed
        clearInterval(timeoutId)
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
      this.log?.('received ping request pingId=%s', header.length)
      this.sendPing(header.length, Flag.ACK)
    } else if (header.flag === Flag.ACK) {
      this.log?.('received ping response pingId=%s', header.length)
      this.handlePingResponse(header.length)
    } else {
      // Invalid state
      throw errcode(new Error('Invalid frame flag'), ERR_INVALID_FRAME, { header })
    }
  }

  private handlePingResponse (pingId: number): void {
    if (this.activePing === undefined) {
      // this ping was not requested
      throw errcode(new Error('ping not requested'), ERR_UNREQUESTED_PING)
    }
    if (this.activePing.id !== pingId) {
      // this ping doesn't match our active ping request
      throw errcode(new Error('ping doesn\'t match our id'), ERR_NOT_MATCHING_PING)
    }

    // valid ping response
    this.activePing.resolve()
  }

  private handleGoAway (reason: GoAwayCode): void {
    this.log?.('received GoAway reason=%s', GoAwayCode[reason] ?? 'unknown')
    this.remoteGoAway = reason
    this._closeMuxer()
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
    if (this.client !== (id % 2 === 0)) {
      throw errcode(new Error('both endpoints are clients'), ERR_BOTH_CLIENTS)
    }
    if (this._streams.has(id)) {
      return
    }

    this.log?.('new incoming stream id=%s', id)

    if (this.localGoAway !== undefined) {
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

    // check against our configured maximum number of incoming streams
    if (this.numIncomingStreams >= this.config.maxIncomingStreams) {
      this.log?.('maxIncomingStreams exceeded, forcing stream reset')
      return this.sendFrame({
        type: FrameType.WindowUpdate,
        flag: Flag.RST,
        streamID: id,
        length: 0
      })
    }

    this.numIncomingStreams++
    // the stream should now be tracked
    this._streams.set(id, stream)

    this.onIncomingStream?.(stream)
  }

  private sendFrame (header: FrameHeader, data?: Uint8Array): void {
    this.log?.trace('sending frame %s', stringifyHeader(header))
    this.source.push(encodeFrame(header, data))
  }

  private sendPing (pingId: number, flag: Flag = Flag.SYN): void {
    if (flag === Flag.SYN) {
      this.log?.('sending ping request pingId=%s', pingId)
    } else {
      this.log?.('sending ping response pingId=%s', pingId)
    }
    this.sendFrame({
      type: FrameType.Ping,
      flag: flag,
      streamID: 0,
      length: pingId
    })
  }

  private sendGoAway (reason: GoAwayCode = GoAwayCode.NormalTermination): void {
    this.log?.('sending GoAway reason=%s', GoAwayCode[reason])
    this.localGoAway = reason
    this.sendFrame({
      type: FrameType.GoAway,
      flag: 0,
      streamID: 0,
      length: reason
    })
  }
}
