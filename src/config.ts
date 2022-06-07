import { logger, Logger } from '@libp2p/logger'
import errcode from 'err-code'
import { ERR_INVALID_CONFIG, INITIAL_STREAM_WINDOW, MAX_STREAM_WINDOW, MAX_UINT32 } from './constants.js'

// TOOD use config items or delete them
export interface Config {
  /**
   * AcceptBacklog is used to limit how many streams may be
   * waiting an accept.
   */
  acceptBacklog: number

  /**
   * PingBacklog is used to limit how many ping acks we can queue.
   */
  pingBacklog: number

  /**
   * EnableKeepalive is used to do a period keep alive
   * messages using a ping.
   */
  enableKeepAlive: boolean

  /**
   * KeepAliveInterval is how often to perform the keep alive
   *
   * measured in milliseconds
   */
  keepAliveInterval: number

  /**
   * ConnectionWriteTimeout is meant to be a "safety valve" timeout after
   * we which will suspect a problem with the underlying connection and
   * close it. This is only applied to writes, where's there's generally
   * an expectation that things will move along quickly.
   *
   * measured in milliseconds
   */
  connectionWriteTimeout: number

  /**
   * MaxIncomingStreams is maximum number of concurrent incoming streams
   * that we accept. If the peer tries to open more streams, those will be
   * reset immediately.
   */
  maxIncomingStreams: number

  /**
   * InitialStreamWindowSize is used to control the initial
   * window size that we allow for a stream.
   *
   * measured in bytes
   */
  initialStreamWindowSize: number

  /**
   * MaxStreamWindowSize is used to control the maximum
   * window size that we allow for a stream.
   */
  maxStreamWindowSize: number

  /**
   * Log is used to control the log destination
   *
   * It can be disabled by explicitly setting to `undefined`
   */
  log?: Logger

  /**
   * ReadBufSize controls the size of the read buffer.
   *
   * Set to 0 to disable it.
   */
  readBufSize: number

  /**
   * MaxMessageSize is the maximum size of a message that we'll send on a
   * stream. This ensures that a single stream doesn't hog a connection.
   */
  maxMessageSize: number
}

export const defaultConfig: Config = {
  acceptBacklog: 256,
  pingBacklog: 32,
  enableKeepAlive: true,
  keepAliveInterval: 30_000,
  connectionWriteTimeout: 10_000,
  maxIncomingStreams: 1_000,
  initialStreamWindowSize: INITIAL_STREAM_WINDOW,
  maxStreamWindowSize: MAX_STREAM_WINDOW,
  log: logger('libp2p:yamux'),
  readBufSize: 4096,
  maxMessageSize: 64 * 1024
}

export function verifyConfig (config: Config): void {
  if (config.acceptBacklog <= 0) {
    throw errcode(new Error('backlog must be positive'), ERR_INVALID_CONFIG)
  }
  if (config.keepAliveInterval <= 0) {
    throw errcode(new Error('keep-alive interval must be positive'), ERR_INVALID_CONFIG)
  }
  if (config.initialStreamWindowSize < INITIAL_STREAM_WINDOW) {
    throw errcode(new Error('InitialStreamWindowSize must be larger or equal 256 kB'), ERR_INVALID_CONFIG)
  }
  if (config.maxStreamWindowSize < config.initialStreamWindowSize) {
    throw errcode(new Error('MaxStreamWindowSize must be larger than the InitialStreamWindowSize'), ERR_INVALID_CONFIG)
  }
  if (config.maxStreamWindowSize > MAX_UINT32) {
    throw errcode(new Error('MaxStreamWindowSize must be less than equal MAX_UINT32'), ERR_INVALID_CONFIG)
  }
  if (config.maxMessageSize < 1024) {
    throw errcode(new Error('MaxMessageSize must be greater than a kilobyte'), ERR_INVALID_CONFIG)
  }
  if (config.pingBacklog < 1) {
    throw errcode(new Error('PingBacklog must be > 0'), ERR_INVALID_CONFIG)
  }
}
