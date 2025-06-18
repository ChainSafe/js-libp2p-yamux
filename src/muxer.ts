import { InvalidParametersError, MuxerClosedError, TooManyOutboundProtocolStreamsError, serviceCapabilities, setMaxListeners } from '@libp2p/interface'
import { getIterator } from 'get-iterator'
import { pushable } from 'it-pushable'
import { raceSignal } from 'race-signal'
import { Uint8ArrayList } from 'uint8arraylist'
import { defaultConfig, verifyConfig } from './config.js'
import { PROTOCOL_ERRORS } from './constants.js'
import { Decoder } from './decode.js'
import { encodeHeader } from './encode.js'
import { InvalidFrameError, NotMatchingPingError, UnrequestedPingError } from './errors.js'
import { Flag, FrameType, GoAwayCode } from './frame.js'
import { StreamState, YamuxStream } from './stream.js'
import type { Config } from './config.js'
import type { FrameHeader } from './frame.js'
import type { YamuxMuxerComponents } from './index.js'
import type { AbortOptions, ComponentLogger, Logger, Stream, StreamMuxer, StreamMuxerFactory, StreamMuxerInit } from '@libp2p/interface'
import type { Pushable } from 'it-pushable'
import type { Sink, Source } from 'it-stream-types'

const YAMUX_PROTOCOL_ID = '/yamux/1.0.0'
const CLOSE_TIMEOUT = 500

export interface YamuxMuxerInit extends StreamMuxerInit, Partial<Config> {
}

export class Yamux implements StreamMuxerFactory {
  protocol = YAMUX_PROTOCOL_ID
  private readonly _components: YamuxMuxerComponents
  private readonly _init: YamuxMuxerInit

  constructor (components: YamuxMuxerComponents, init: YamuxMuxerInit = {}) {
    this._components = components
    this._init = init
  }

  readonly [Symbol.toStringTag] = '@chainsafe/libp2p-yamux'

  readonly [serviceCapabilities]: string[] = [
    '@libp2p/stream-multiplexing'
  ]

  createStreamMuxer (init?: YamuxMuxerInit): YamuxMuxer {
    return new YamuxMuxer(this._components, {
      ...this._init,
      ...init
    })
  }
}

export interface CloseOptions extends AbortOptions {
  reason?: GoAwayCode
}

export class YamuxMuxer implements StreamMuxer {
  protocol = YAMUX_PROTOCOL_ID
  source: Pushable<Uint8ArrayList | Uint8Array>
  sink: Sink<Source<Uint8ArrayList | Uint8Array>, Promise<void>>

  private readonly config: Config
  private readonly log?: Logger
  private readonly logger: ComponentLogger

  /** Used to close the muxer from either the sink or source */
  private readonly closeController: AbortController

  /** The next stream id to be used when initiating a new stream */
  private nextStreamID: number
  /** Primary stream mapping, streamID => stream */
  private readonly _streams: Map<number, YamuxStream>

  /** The next ping id to be used when pinging */
  private nextPingID: number
  /** Tracking info for the currently active ping */
  private activePing?: { id: number, promise: Promise<void>, resolve(): void }
  /** Round trip time */
  private rtt: number

  /** True if client, false if server */
  private readonly client: boolean

  private localGoAway?: GoAwayCode
  private remoteGoAway?: GoAwayCode

  /** Number of tracked inbound streams */
  private numInboundStreams: number
  /** Number of tracked outbound streams */
  private numOutboundStreams: number

  private readonly onIncomingStream?: (stream: Stream) => void
  private readonly onStreamEnd?: (stream: Stream) => void

  constructor (components: YamuxMuxerComponents, init: YamuxMuxerInit) {
    this.client = init.direction === 'outbound'
    this.config = { ...defaultConfig, ...init }
    this.logger = components.logger
    this.log = this.logger.forComponent('libp2p:yamux')
    verifyConfig(this.config)

    this.closeController = new AbortController()
    setMaxListeners(Infinity, this.closeController.signal)

    this.onIncomingStream = init.onIncomingStream
    this.onStreamEnd = init.onStreamEnd

    this._streams = new Map()

    this.source = pushable({
      onEnd: (): void => {
        this.log?.trace('muxer source ended')

        this._streams.forEach(stream => {
          stream.destroy()
        })
      }
    })

    this.sink = async (source: Source<Uint8ArrayList | Uint8Array>): Promise<void> => {
      const shutDownListener = (): void => {
        const iterator = getIterator(source)

        if (iterator.return != null) {
          const res = iterator.return()

          if (isPromise(res)) {
            res.catch(err => {
              this.log?.('could not cause sink source to return', err)
            })
          }
        }
      }

      let reason, error
      try {
        const decoder = new Decoder(source)

        try {
          this.closeController.signal.addEventListener('abort', shutDownListener)

          for await (const frame of decoder.emitFrames()) {
            await this.handleFrame(frame.header, frame.readData)
          }
        } finally {
          this.closeController.signal.removeEventListener('abort', shutDownListener)
        }

        reason = GoAwayCode.NormalTermination
      } catch (err: any) {
        // either a protocol or internal error
        if (PROTOCOL_ERRORS.has(err.name)) {
          this.log?.error('protocol error in sink', err)
          reason = GoAwayCode.ProtocolError
        } else {
          this.log?.error('internal error in sink', err)
          reason = GoAwayCode.InternalError
        }

        error = err as Error
      }

      this.log?.trace('muxer sink ended')

      if (error != null) {
        this.abort(error, reason)
      } else {
        await this.close({ reason })
      }
    }

    this.numInboundStreams = 0
    this.numOutboundStreams = 0

    // client uses odd streamIDs, server uses even streamIDs
    this.nextStreamID = this.client ? 1 : 2

    this.nextPingID = 0
    this.rtt = -1

    this.log?.trace('muxer created')

    if (this.config.enableKeepAlive) {
      this.keepAliveLoop().catch(e => this.log?.error('keepalive error: %s', e))
    }

    // send an initial ping to establish RTT
    this.ping().catch(e => this.log?.error('ping error: %s', e))
  }

  get streams (): YamuxStream[] {
    return Array.from(this._streams.values())
  }

  newStream (name?: string | undefined): YamuxStream {
    if (this.remoteGoAway !== undefined) {
      throw new MuxerClosedError('Muxer closed remotely')
    }
    if (this.localGoAway !== undefined) {
      throw new MuxerClosedError('Muxer closed locally')
    }

    const id = this.nextStreamID
    this.nextStreamID += 2

    // check against our configured maximum number of outbound streams
    if (this.numOutboundStreams >= this.config.maxOutboundStreams) {
      throw new TooManyOutboundProtocolStreamsError('max outbound streams exceeded')
    }

    this.log?.trace('new outgoing stream id=%s', id)

    const stream = this._newStream(id, name, StreamState.Init, 'outbound')
    this._streams.set(id, stream)

    this.numOutboundStreams++

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
      throw new MuxerClosedError('Muxer closed remotely')
    }
    if (this.localGoAway !== undefined) {
      throw new MuxerClosedError('Muxer closed locally')
    }

    // An active ping does not yet exist, handle the process here
    if (this.activePing === undefined) {
      // create active ping
      let _resolve = (): void => {}
      this.activePing = {
        id: this.nextPingID++,
        // this promise awaits resolution or the close controller aborting
        promise: new Promise<void>((resolve, reject) => {
          const closed = (): void => {
            reject(new MuxerClosedError('Muxer closed locally'))
          }
          this.closeController.signal.addEventListener('abort', closed, { once: true })
          _resolve = (): void => {
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
   */
  async close (options: CloseOptions = {}): Promise<void> {
    if (this.closeController.signal.aborted) {
      // already closed
      return
    }

    const reason = options?.reason ?? GoAwayCode.NormalTermination

    this.log?.trace('muxer close reason=%s', reason)

    if (options.signal == null) {
      const signal = AbortSignal.timeout(CLOSE_TIMEOUT)
      setMaxListeners(Infinity, signal)

      options = {
        ...options,
        signal
      }
    }

    try {
      await Promise.all(
        [...this._streams.values()].map(async s => s.close(options))
      )

      // send reason to the other side, allow the other side to close gracefully
      this.sendGoAway(reason)

      this._closeMuxer()
    } catch (err: any) {
      this.abort(err)
    }
  }

  abort (err: Error, reason?: GoAwayCode): void {
    if (this.closeController.signal.aborted) {
      // already closed
      return
    }

    reason = reason ?? GoAwayCode.InternalError

    // If reason was provided, use that, otherwise use the presence of `err` to determine the reason
    this.log?.error('muxer abort reason=%s error=%s', reason, err)

    // Abort all underlying streams
    for (const stream of this._streams.values()) {
      stream.abort(err)
    }

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

    // stop the source
    this.source.end()
  }

  /** Create a new stream */
  private _newStream (id: number, name: string | undefined, state: StreamState, direction: 'inbound' | 'outbound'): YamuxStream {
    if (this._streams.get(id) != null) {
      throw new InvalidParametersError('Stream already exists with that id')
    }

    const stream = new YamuxStream({
      id: id.toString(),
      name,
      state,
      direction,
      sendFrame: this.sendFrame.bind(this),
      onEnd: () => {
        this.closeStream(id)
        this.onStreamEnd?.(stream)
      },
      log: this.logger.forComponent(`libp2p:yamux:${direction}:${id}`),
      config: this.config,
      getRTT: this.getRTT.bind(this)
    })

    return stream
  }

  /**
   * closeStream is used to close a stream once both sides have
   * issued a close.
   */
  private closeStream (id: number): void {
    if (this.client === (id % 2 === 0)) {
      this.numInboundStreams--
    } else {
      this.numOutboundStreams--
    }
    this._streams.delete(id)
  }

  private async keepAliveLoop (): Promise<void> {
    this.log?.trace('muxer keepalive enabled interval=%s', this.config.keepAliveInterval)
    while (true) {
      let timeoutId
      try {
        await raceSignal(
          new Promise((resolve) => {
            timeoutId = setTimeout(resolve, this.config.keepAliveInterval)
          }),
          this.closeController.signal
        )
        this.ping().catch(e => this.log?.error('ping error: %s', e))
      } catch (e) {
        // closed
        clearInterval(timeoutId)
        return
      }
    }
  }

  private async handleFrame (header: FrameHeader, readData?: () => Promise<Uint8ArrayList>): Promise<void> {
    const {
      streamID,
      type,
      length
    } = header
    this.log?.trace('received frame %o', header)

    if (streamID === 0) {
      switch (type) {
        case FrameType.Ping:
        { this.handlePing(header); return }
        case FrameType.GoAway:
        { this.handleGoAway(length); return }
        default:
          // Invalid state
          throw new InvalidFrameError('Invalid frame type')
      }
    } else {
      switch (header.type) {
        case FrameType.Data:
        case FrameType.WindowUpdate:
        { await this.handleStreamMessage(header, readData); return }
        default:
          // Invalid state
          throw new InvalidFrameError('Invalid frame type')
      }
    }
  }

  private handlePing (header: FrameHeader): void {
    // If the ping  is initiated by the sender, send a response
    if (header.flag === Flag.SYN) {
      this.log?.trace('received ping request pingId=%s', header.length)
      this.sendPing(header.length, Flag.ACK)
    } else if (header.flag === Flag.ACK) {
      this.log?.trace('received ping response pingId=%s', header.length)
      this.handlePingResponse(header.length)
    } else {
      // Invalid state
      throw new InvalidFrameError('Invalid frame flag')
    }
  }

  private handlePingResponse (pingId: number): void {
    if (this.activePing === undefined) {
      // this ping was not requested
      throw new UnrequestedPingError('ping not requested')
    }
    if (this.activePing.id !== pingId) {
      // this ping doesn't match our active ping request
      throw new NotMatchingPingError('ping doesn\'t match our id')
    }

    // valid ping response
    this.activePing.resolve()
  }

  private handleGoAway (reason: GoAwayCode): void {
    this.log?.trace('received GoAway reason=%s', GoAwayCode[reason] ?? 'unknown')
    this.remoteGoAway = reason

    // If the other side is friendly, they would have already closed all streams before sending a GoAway
    // In case they weren't, reset all streams
    for (const stream of this._streams.values()) {
      stream.reset()
    }

    this._closeMuxer()
  }

  private async handleStreamMessage (header: FrameHeader, readData?: () => Promise<Uint8ArrayList>): Promise<void> {
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
        this.log?.trace('frame for missing stream id=%s', streamID)
      }
      return
    }

    switch (type) {
      case FrameType.WindowUpdate: {
        stream.handleWindowUpdate(header); return
      }
      case FrameType.Data: {
        if (readData === undefined) {
          throw new Error('unreachable')
        }

        await stream.handleData(header, readData); return
      }
      default:
        throw new Error('unreachable')
    }
  }

  private incomingStream (id: number): void {
    if (this.client !== (id % 2 === 0)) {
      throw new InvalidParametersError('Both endpoints are clients')
    }
    if (this._streams.has(id)) {
      return
    }

    this.log?.trace('new incoming stream id=%s', id)

    if (this.localGoAway !== undefined) {
      // reject (reset) immediately if we are doing a go away
      this.sendFrame({
        type: FrameType.WindowUpdate,
        flag: Flag.RST,
        streamID: id,
        length: 0
      }); return
    }

    // check against our configured maximum number of inbound streams
    if (this.numInboundStreams >= this.config.maxInboundStreams) {
      this.log?.('maxIncomingStreams exceeded, forcing stream reset')
      this.sendFrame({
        type: FrameType.WindowUpdate,
        flag: Flag.RST,
        streamID: id,
        length: 0
      }); return
    }

    // allocate a new stream
    const stream = this._newStream(id, undefined, StreamState.SYNReceived, 'inbound')

    this.numInboundStreams++
    // the stream should now be tracked
    this._streams.set(id, stream)

    this.onIncomingStream?.(stream)
  }

  private sendFrame (header: FrameHeader, data?: Uint8ArrayList): void {
    this.log?.trace('sending frame %o', header)
    if (header.type === FrameType.Data) {
      if (data === undefined) {
        throw new InvalidFrameError('Invalid frame')
      }
      this.source.push(
        new Uint8ArrayList(encodeHeader(header), data)
      )
    } else {
      this.source.push(encodeHeader(header))
    }
  }

  private sendPing (pingId: number, flag: Flag = Flag.SYN): void {
    if (flag === Flag.SYN) {
      this.log?.trace('sending ping request pingId=%s', pingId)
    } else {
      this.log?.trace('sending ping response pingId=%s', pingId)
    }
    this.sendFrame({
      type: FrameType.Ping,
      flag,
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

function isPromise <T = unknown> (thing: any): thing is Promise<T> {
  return thing != null && typeof thing.then === 'function'
}
