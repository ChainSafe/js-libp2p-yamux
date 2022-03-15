import type { Stream as IStream, Timeline } from '@libp2p/interfaces/connection'
import { abortableSource } from 'abortable-iterator/dist/src'
import anySignal from 'any-signal'
import { Pushable, pushable } from 'it-pushable'
import { Source } from 'it-stream-types'
import { concat } from 'uint8arrays/concat'

import { STREAM_STATES, FLAGS, TYPES, initialStreamWindow, VERSION, ERRORS } from './constants'
import { Header } from './header'
import { Session } from './session'

export class Stream implements IStream {
  public id: string
  public timeline: Timeline
  public source: Pushable<Uint8Array>;

  private recvWindow: number
  private sendWindow: number
  private _id: number
  private session: Session
  private state: STREAM_STATES
  private recvBuf?: Uint8Array
  private controlHdr?: Header

  constructor(session: Session, id: number, state: STREAM_STATES) {
    this.session = session
    this._id = id
    this.id = String(id)
    this.state = state
    this.timeline = {
      open: Date.now()
    }
    this.source = pushable()

    this.recvWindow = initialStreamWindow
    this.sendWindow = initialStreamWindow
  }

  public _read(size: number): void {
    if (size > this.recvWindow) {
      this.session.config.logger(
        '[ERR] yamux: receive window exceeded (stream: %d, remain: %d, recv: %d)',
        this._id,
        this.recvWindow,
        size
      )
      this.emit('error', ERRORS.errRecvWindowExceeded)
    }
  }

  public async sink(source: Source<Uint8Array>): Promise<void> {
    const abortController = new AbortController()
    const resetController = new AbortController()

    source = abortableSource(source, anySignal([
      abortController.signal,
      resetController.signal
    ]))

    try {
      for await (const chunk of source) {
        switch (this.state) {
          case STREAM_STATES.LocalClose:
          case STREAM_STATES.RemoteClose:
          case STREAM_STATES.Closed:
            throw ERRORS.errStreamClosed
          case STREAM_STATES.Reset:
            throw ERRORS.errConnectionReset
          default:
            if (this.sendWindow === 0) {
              setTimeout(() => this._write(chunk, encoding, cb), 100)
              return
            }
            const flags = this.sendFlags()
            const packetLength = Math.min(this.sendWindow, chunk.length)
            const sendHdr = new Header(VERSION, TYPES.Data, flags, this._id, packetLength)
            const buffers = [sendHdr.encode(), chunk]
            const packet = concat(buffers)

            const rest = packet.slice(packetLength + Header.LENGTH)
            const packetToSend = packet.slice(0, packetLength + Header.LENGTH)
            this.sendWindow -= packetLength

            const writeTimeout = setTimeout(() => {
              this.emit('error', ERRORS.errConnectionWriteTimeout)
              clearTimeout(writeTimeout)
            }, this.session.config.connectionWriteTimeout * 1000)
            this.session.push(packetToSend)
            clearTimeout(writeTimeout)

            if (rest.length > 0) {
              return this._write(rest, encoding, cb)
            }

            break
        }

      }
    }
  }

  public _write(chunk: any, encoding: BufferEncoding, cb: (error?: Error | null) => void): void {
    switch (this.state) {
      case STREAM_STATES.LocalClose:
      case STREAM_STATES.RemoteClose:
      case STREAM_STATES.Closed:
        this.emit('error', ERRORS.errStreamClosed)
        break
      case STREAM_STATES.Reset:
        this.emit('error', ERRORS.errConnectionReset)
        break
      default:
        if (this.sendWindow === 0) {
          setTimeout(() => this._write(chunk, encoding, cb), 100)
          return
        }
        const flags = this.sendFlags()
        const packetLength = Math.min(this.sendWindow, chunk.length)
        const sendHdr = new Header(VERSION, TYPES.Data, flags, this._id, packetLength)
        const buffers = [sendHdr.encode(), chunk]
        const packet = concat(buffers)

        const rest = packet.slice(packetLength + Header.LENGTH)
        const packetToSend = packet.slice(0, packetLength + Header.LENGTH)
        this.sendWindow -= packetLength

        const writeTimeout = setTimeout(() => {
          this.emit('error', ERRORS.errConnectionWriteTimeout)
          clearTimeout(writeTimeout)
        }, this.session.config.connectionWriteTimeout * 1000)
        this.session.push(packetToSend, encoding)
        clearTimeout(writeTimeout)

        if (rest.length > 0) {
          return this._write(rest, encoding, cb)
        }

        break
    }

    return cb()
  }

  public abort(err?: Error): void {

  }

  public reset(): void {

  }

  /**
   * sendFlags determines any flags that are appropriate
   * based on the current stream state
   */
  private sendFlags(): FLAGS {
    let flags: FLAGS = 0

    switch (this.state) {
      case STREAM_STATES.Init:
        flags = FLAGS.SYN
        this.state = STREAM_STATES.SYNSent
        break
      case STREAM_STATES.SYNReceived:
        flags = FLAGS.ACK
        this.state = STREAM_STATES.Established
    }

    return flags
  }

  /**
   * sendWindowUpdate potentially sends a window update enabling
   * further writes to take place.
   */
  public sendWindowUpdate() {
    const max = this.session.config.maxStreamWindowSize
    const delta = max - (this.recvBuf ? this.recvBuf.length : 0) - this.recvWindow

    const flags = this.sendFlags()

    if (delta < max / 2 && flags === 0) {
      return
    }

    // Update our window
    this.recvWindow += delta

    // Send the header
    this.controlHdr = new Header(VERSION, TYPES.WindowUpdate, flags, this._id, delta)
    this.session.send(this.controlHdr)
  }

  /**
   * sendClose is used to send a FIN
   */
  private sendClose() {
    const flags = FLAGS.FIN
    this.controlHdr = new Header(VERSION, TYPES.WindowUpdate, flags, this._id, 0)
    if (!this.session.isClosed()) {
      this.session.send(this.controlHdr)
    }
  }

  public close() {
    switch (this.state) {
      // Opened means we need to signal a close
      case STREAM_STATES.SYNSent:
      case STREAM_STATES.SYNReceived:
      case STREAM_STATES.Established:
        this.state = STREAM_STATES.LocalClose
        this.sendClose()

      case STREAM_STATES.LocalClose:
      case STREAM_STATES.RemoteClose:
        this.state = STREAM_STATES.LocalClose
        this.sendClose()
        this.session.closeStream(this._id)
    }
  }

  /**
   * closeTimeout is called after StreamCloseTimeout during a close to
   * close this stream.
   */
  public forceClose() {
    this.state = STREAM_STATES.Closed
  }

  private processFlags(flags: FLAGS) {
    // Close the stream without holding the state lock
    let closeStream = false
    if (flags === FLAGS.ACK) {
      if (this.state === STREAM_STATES.SYNSent) {
        this.state = STREAM_STATES.Established
      }
    }
    if (flags === FLAGS.SYN) {
      switch (this.state) {
        case STREAM_STATES.SYNSent:
        case STREAM_STATES.SYNReceived:
        case STREAM_STATES.Established:
          this.state = STREAM_STATES.RemoteClose
          break
        case STREAM_STATES.LocalClose:
          this.state = STREAM_STATES.Closed
          closeStream = true
          break
        default:
          this.session.config.logger('[ERR] yamux: unexpected FIN flag in state %d', this.state)
          this.emit('error', ERRORS.errUnexpectedFlag)
          return
      }
    }

    if (flags === FLAGS.RST) {
      this.state = STREAM_STATES.Reset
      closeStream = true
    }

    if (closeStream) {
      this.session.closeStream(this._id)
    }
  }

  public incrSendWindow(hdr: Header) {
    this.processFlags(hdr.flags)
    this.sendWindow += hdr.length
  }
}
