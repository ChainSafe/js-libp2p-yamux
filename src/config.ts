import { logger, Logger } from '@libp2p/logger'
import errcode from 'err-code'
import { ERR_INVALID_CONFIG, INITIAL_STREAM_WINDOW, MAX_STREAM_WINDOW, MAX_UINT32 } from './constants.js'

// TOOD use config items or delete them
export interface Config {
  /**
   * Log is used to control the log destination
   *
   * It can be disabled by explicitly setting to `undefined`
   */
  log?: Logger

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
   * MaxMessageSize is the maximum size of a message that we'll send on a
   * stream. This ensures that a single stream doesn't hog a connection.
   */
  maxMessageSize: number
}

export const defaultConfig: Config = {
  log: logger('libp2p:yamux'),
  enableKeepAlive: true,
  keepAliveInterval: 30_000,
  maxIncomingStreams: 1_000,
  initialStreamWindowSize: INITIAL_STREAM_WINDOW,
  maxStreamWindowSize: MAX_STREAM_WINDOW,
  maxMessageSize: 64 * 1024
}

export function verifyConfig (config: Config): void {
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
}
