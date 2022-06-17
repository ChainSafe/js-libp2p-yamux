// Protocol violation errors

export const ERR_INVALID_FRAME = 'ERR_INVALID_FRAME'
export const ERR_UNREQUESTED_PING = 'ERR_UNREQUESTED_PING'
export const ERR_NOT_MATCHING_PING = 'ERR_NOT_MATCHING_PING'
export const ERR_STREAM_ALREADY_EXISTS = 'ERR_STREAM_ALREADY_EXISTS'
export const ERR_DECODE_INVALID_VERSION = 'ERR_DECODE_INVALID_VERSION'
export const ERR_BOTH_CLIENTS = 'ERR_BOTH_CLIENTS'
export const ERR_RECV_WINDOW_EXCEEDED = 'ERR_RECV_WINDOW_EXCEEDED'

export const PROTOCOL_ERRORS = [
  ERR_INVALID_FRAME,
  ERR_UNREQUESTED_PING,
  ERR_NOT_MATCHING_PING,
  ERR_STREAM_ALREADY_EXISTS,
  ERR_DECODE_INVALID_VERSION,
  ERR_BOTH_CLIENTS,
  ERR_RECV_WINDOW_EXCEEDED
]

// local errors

export const ERR_INVALID_CONFIG = 'ERR_INVALID_CONFIG'
export const ERR_MUXER_LOCAL_CLOSED = 'ERR_MUXER_LOCAL_CLOSED'
export const ERR_MUXER_REMOTE_CLOSED = 'ERR_MUXER_REMOTE_CLOSED'
export const ERR_STREAM_RESET = 'ERR_STREAM_RESET'
export const ERR_STREAM_ABORT = 'ERR_STREAM_ABORT'
export const ERR_MAX_OUTBOUND_STREAMS_EXCEEDED = 'ERROR_MAX_OUTBOUND_STREAMS_EXCEEDED'

/**
 * INITIAL_STREAM_WINDOW is the initial stream window size.
 *
 * Not an implementation choice, this is defined in the specification
 */
export const INITIAL_STREAM_WINDOW = 256 * 1024

/**
 * Default max stream window
 */
export const MAX_STREAM_WINDOW = 16 * 1024 * 1024
