import type { StreamStat } from '@libp2p/interface-connection'
import type { Sink, Source } from 'it-stream-types'
import { CodeError } from '@libp2p/interfaces/errors'
import { abortableSource } from 'abortable-iterator'
import { Uint8ArrayList } from 'uint8arraylist'
import { Flag, FrameHeader, FrameType, HEADER_LENGTH } from './frame.js'
import { ERR_RECV_WINDOW_EXCEEDED, ERR_STREAM_ABORT, INITIAL_STREAM_WINDOW } from './constants.js'
import type { Logger } from '@libp2p/logger'
import type { Config } from './config.js'
import { AbstractStream, type AbstractStreamInit } from '@libp2p/interface-stream-muxer/stream'

export enum StreamState {
  Init,
  SYNSent,
  SYNReceived,
  Established,
  Finished,
}

export enum HalfStreamState {
  Open,
  Closed,
  Reset,
}

export interface YamuxStreamInit extends AbstractStreamInit {
  id: string
  name?: string
  sendFrame: (header: FrameHeader, body?: Uint8ArrayList) => void
  onEnd?: (err?: Error) => void
  getRTT: () => number
  config: Config
  state: StreamState
  log?: Logger
  direction: 'inbound' | 'outbound'
}

/** YamuxStream is used to represent a logical stream within a session */
export class YamuxStream extends AbstractStream {
  id: string
  name?: string
  stat: StreamStat
  metadata: Record<string, any>

  state: StreamState
  /** Used to track received FIN/RST */
  readState: HalfStreamState
  /** Used to track sent FIN/RST */
  writeState: HalfStreamState

  /** Write side of the stream */
  sink: Sink<Source<Uint8ArrayList | Uint8Array>, Promise<void>>

  private readonly config: Config
  private readonly log?: Logger
  private readonly _id: number

  /** The number of available bytes to send */
  private sendWindowCapacity: number
  /** Callback to notify that the sendWindowCapacity has been updated */
  private sendWindowCapacityUpdate?: () => void

  /** The number of bytes available to receive in a full window */
  private recvWindow: number
  /** The number of available bytes to receive */
  private recvWindowCapacity: number

  /**
   * An 'epoch' is the time it takes to process and read data
   *
   * Used in conjunction with RTT to determine whether to increase the recvWindow
   */
  private epochStart: number
  private readonly getRTT: () => number

  private readonly sendFrame: (header: FrameHeader, body?: Uint8ArrayList) => void

  private readonly abortObserver: AbortController

  constructor (init: YamuxStreamInit) {
    super(init)

    this.config = init.config
    this.id = init.id
    this._id = parseInt(init.id)
    this.name = init.name
    this.stat = {
      direction: init.direction,
      timeline: {
        open: Date.now()
      }
    }
    this.metadata = {}

    this.state = init.state
    this.readState = HalfStreamState.Open
    this.writeState = HalfStreamState.Open

    this.sendWindowCapacity = INITIAL_STREAM_WINDOW
    this.recvWindow = this.config.initialStreamWindowSize
    this.recvWindowCapacity = this.recvWindow
    this.epochStart = Date.now()
    this.getRTT = init.getRTT

    this.sendFrame = init.sendFrame
    this.log = init.log

    this.abortObserver = new AbortController()

    this.sink = async (source: Source<Uint8ArrayList | Uint8Array>): Promise<void> => {
      if (this.writeState !== HalfStreamState.Open) {
        throw new Error('stream closed for writing')
      }

      source = abortableSource(source, this.abortObserver.signal, { returnOnAbort: true })

      try {
        for await (let data of source) {
          // send in chunks, waiting for window updates
          while (data.length !== 0) {
            // wait for the send window to refill
            if (this.sendWindowCapacity === 0) await this.waitForSendWindowCapacity()

            // send as much as we can
            const toSend = Math.min(this.sendWindowCapacity, this.config.maxMessageSize - HEADER_LENGTH, data.length)

            this.sendData(new Uint8ArrayList(data.subarray(0, toSend)))
            this.sendWindowCapacity -= toSend
            data = data.subarray(toSend)
          }
        }
      } catch (e) {
        this.log?.error('stream sink error id=%s', this._id, e)
      } finally {
        this.log?.trace('stream sink ended id=%s', this._id)
        this.closeWrite()
      }
    }

    this.sink = this.sink.bind(this)
  }

  closeWrite (): void {
    if (this.state === StreamState.Finished) {
      return
    }

    if (this.writeState !== HalfStreamState.Open) {
      return
    }

    this.log?.trace('stream close write id=%s', this._id)

    this.writeState = HalfStreamState.Closed

    this.sendClose()

    // close the sink
    this.abortController.abort()

    // If the both read and write are closed, finish it
    if (this.readState !== HalfStreamState.Open) {
      this.finish()
    }
  }

  /**
   * Wait for the send window to be non-zero
   *
   * Will throw with ERR_STREAM_ABORT if the stream gets aborted
   */
  async waitForSendWindowCapacity (): Promise<void> {
    if (this.abortObserver.signal.aborted) {
      throw new CodeError('stream aborted', ERR_STREAM_ABORT)
    }
    if (this.sendWindowCapacity > 0) {
      return
    }
    let reject: (err: Error) => void
    const abort = (): void => {
      reject(new CodeError('stream aborted', ERR_STREAM_ABORT))
    }
    this.abortObserver.signal.addEventListener('abort', abort)
    await new Promise((_resolve, _reject) => {
      this.sendWindowCapacityUpdate = () => {
        this.abortObserver.signal.removeEventListener('abort', abort)
        _resolve(undefined)
      }
      reject = _reject
    })
  }

  /**
   * handleWindowUpdate is called when the stream receives a window update frame
   */
  handleWindowUpdate (header: FrameHeader): void {
    this.log?.trace('stream received window update id=%s', this._id)
    this.processFlags(header.flag)

    // increase send window
    const available = this.sendWindowCapacity
    this.sendWindowCapacity += header.length
    // if the update increments a 0 availability, notify the stream that sending can resume
    if (available === 0 && header.length > 0) {
      this.sendWindowCapacityUpdate?.()
    }
  }

  /**
   * processFlags is used to update the state of the stream based on set flags, if any.
   */
  private processFlags (flags: number): void {
    if ((flags & Flag.ACK) === Flag.ACK) {
      if (this.state === StreamState.SYNSent) {
        this.state = StreamState.Established
      }
    }
    if ((flags & Flag.FIN) === Flag.FIN) {
      this.closeRead()
    }
    if ((flags & Flag.RST) === Flag.RST) {
      this.reset()
    }
  }

  /**
   * getSendFlags determines any flags that are appropriate
   * based on the current stream state.
   *
   * The state is updated as a side-effect.
   */
  private getSendFlags (): number {
    switch (this.state) {
      case StreamState.Init:
        this.state = StreamState.SYNSent
        return Flag.SYN
      case StreamState.SYNReceived:
        this.state = StreamState.Established
        return Flag.ACK
      default:
        return 0
    }
  }

  /**
   * handleData is called when the stream receives a data frame
   */
  async handleData (header: FrameHeader, readData: () => Promise<Uint8ArrayList>): Promise<void> {
    this.log?.trace('stream received data id=%s', this._id)

    const data = await readData()
    this.sourcePush(data)

    this.processFlags(header.flag)

    // check that our recv window is not exceeded
    if (this.recvWindowCapacity < header.length) {
      throw new CodeError('receive window exceeded', ERR_RECV_WINDOW_EXCEEDED, { available: this.recvWindowCapacity, recv: header.length })
    }

    this.recvWindowCapacity -= header.length
  }

  /**
   * potentially sends a window update enabling further writes to take place.
   */
  sendWindowUpdate (): void {
    // determine the flags if any
    const flags = this.getSendFlags()

    // If the stream has already been established
    // and we've processed data within the time it takes for 4 round trips
    // then we (up to) double the recvWindow
    const now = Date.now()
    const rtt = this.getRTT()
    if (flags === 0 && rtt > 0 && now - this.epochStart < rtt * 4) {
      // we've already validated that maxStreamWindowSize can't be more than MAX_UINT32
      this.recvWindow = Math.min(this.recvWindow * 2, this.config.maxStreamWindowSize)
    }

    if (this.recvWindowCapacity >= this.recvWindow && flags === 0) {
      // a window update isn't needed
      return
    }

    // update the receive window
    const delta = this.recvWindow - this.recvWindowCapacity
    this.recvWindowCapacity = this.recvWindow

    // update the epoch start
    this.epochStart = now

    // send window update
    this.sendFrame({
      type: FrameType.WindowUpdate,
      flag: flags,
      streamID: this._id,
      length: delta
    })
  }

  sendData (data: Uint8ArrayList): void {
    const flags = this.getSendFlags()
    this.sendFrame({
      type: FrameType.Data,
      flag: flags,
      streamID: this._id,
      length: data.length
    }, data)
  }

  sendClose (): void {
    this.sendFrame({
      type: FrameType.WindowUpdate,
      flag: Flag.RST,
      streamID: this._id,
      length: 0
    })
  }

  sendReset (): void {
    this.sendFrame({
      type: FrameType.WindowUpdate,
      flag: Flag.RST,
      streamID: this._id,
      length: 0
    })
  }

  sendNewStream (): void | Promise<void> {
    this.sendFrame({
      type: FrameType.WindowUpdate,
      flag: Flag.SYN,
      streamID: this._id,
      length: 0
    })
  }

  sendCloseRead (): void | Promise<void> {
    this.sendFrame({
      type: FrameType.WindowUpdate,
      flag: Flag.FIN,
      streamID: this._id,
      length: 0
    })
  }

  sendCloseWrite (): void | Promise<void> {
    this.sendFrame({
      type: FrameType.WindowUpdate,
      flag: Flag.FIN,
      streamID: this._id,
      length: 0
    })
  }
}
