import { CodeError } from '@libp2p/interface/errors'
import { logger, type Logger } from '@libp2p/logger'
import { ERR_INVALID_CONFIG, INITIAL_STREAM_WINDOW, MAX_STREAM_WINDOW } from './constants.js'

// TOOD use config items or delete them
export interface Config {
  /**
   * Used to control the log destination
   *
   * It can be disabled by explicitly setting to `undefined`
   */
  log?: Logger

  /**
   * Used to do periodic keep alive messages using a ping.
   */
  enableKeepAlive: boolean

  /**
   * How often to perform the keep alive
   *
   * measured in milliseconds
   */
  keepAliveInterval: number

  /**
   * Maximum number of concurrent inbound streams that we accept.
   * If the peer tries to open more streams, those will be reset immediately.
   */
  maxInboundStreams: number

  /**
   * Maximum number of concurrent outbound streams that we accept.
   * If the application tries to open more streams, the call to `newStream` will throw
   */
  maxOutboundStreams: number

  /**
   * Used to control the initial window size that we allow for a stream.
   *
   * measured in bytes
   */
  initialStreamWindowSize: number

  /**
   * Used to control the maximum window size that we allow for a stream.
   */
  maxStreamWindowSize: number

  /**
   * Maximum size of a message that we'll send on a stream.
   * This ensures that a single stream doesn't hog a connection.
   */
  maxMessageSize: number

  /**
   * Each byte array written into a multiplexed stream is converted to one or
   * more messages which are sent as byte arrays to the remote node. Sending
   * lots of small messages can be expensive - use this setting to batch up
   * the serialized bytes of all messages sent during the current tick up to
   * this limit to send in one go similar to Nagle's algorithm. N.b. you
   * should benchmark your application carefully when using this setting as it
   * may cause the opposite of the desired effect. Omit this setting to send
   * all messages as they become available. (default: 0)
   */
  minSendBytes: number
}

export const defaultConfig: Config = {
  log: logger('libp2p:yamux'),
  enableKeepAlive: true,
  keepAliveInterval: 30_000,
  maxInboundStreams: 1_000,
  maxOutboundStreams: 1_000,
  initialStreamWindowSize: INITIAL_STREAM_WINDOW,
  maxStreamWindowSize: MAX_STREAM_WINDOW,
  maxMessageSize: 64 * 1024,
  minSendBytes: 0
}

export function verifyConfig (config: Config): void {
  if (config.keepAliveInterval <= 0) {
    throw new CodeError('keep-alive interval must be positive', ERR_INVALID_CONFIG)
  }
  if (config.maxInboundStreams < 0) {
    throw new CodeError('max inbound streams must be larger or equal 0', ERR_INVALID_CONFIG)
  }
  if (config.maxOutboundStreams < 0) {
    throw new CodeError('max outbound streams must be larger or equal 0', ERR_INVALID_CONFIG)
  }
  if (config.initialStreamWindowSize < INITIAL_STREAM_WINDOW) {
    throw new CodeError('InitialStreamWindowSize must be larger or equal 256 kB', ERR_INVALID_CONFIG)
  }
  if (config.maxStreamWindowSize < config.initialStreamWindowSize) {
    throw new CodeError('MaxStreamWindowSize must be larger than the InitialStreamWindowSize', ERR_INVALID_CONFIG)
  }
  if (config.maxStreamWindowSize > 2 ** 32 - 1) {
    throw new CodeError('MaxStreamWindowSize must be less than equal MAX_UINT32', ERR_INVALID_CONFIG)
  }
  if (config.maxMessageSize < 1024) {
    throw new CodeError('MaxMessageSize must be greater than a kilobyte', ERR_INVALID_CONFIG)
  }
  if (config.minSendBytes < 0) {
    throw new CodeError('MinSendBytes must be greater or equal to 0', ERR_INVALID_CONFIG)
  }
}
