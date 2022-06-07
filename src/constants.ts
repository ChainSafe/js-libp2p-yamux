/** Protocol violation error */
export const ERR_INVALID_FRAME = 'ERR_INVALID_FRAME'
/** Protocol violation error */
export const ERR_UNREQUESTED_PING = 'ERR_UNREQUESTED_PING'
/** Protocol violation error */
export const ERR_NOT_MATCHING_PING = 'ERR_NOT_MATCHING_PING'
/** Protocol violation error */
export const ERR_STREAM_ALREADY_EXISTS = 'ERR_STREAM_ALREADY_EXISTS'
/** Protocol violation error */
export const ERR_INVALID_STREAM_ID = 'ERR_INVALID_STREAM_ID'

export const ERR_INVALID_CONFIG = 'ERR_INVALID_CONFIG'

export const ERR_DECODE_INVALID_VERSION = 'ERR_DECODE_INVALID_VERSION'

export const ERR_DECODE_LENGTH_GT_WINDOW = 'ERR_DECODE_LENGTH_GT_WINDOW'

export const ERR_BOTH_CLIENTS = 'ERR_BOTH_CLIENTS'

export const ERR_NO_DATA_IN_DATA_FRAME = 'ERR_NO_DATA_IN_DATA_FRAME'

export const ERR_DECODE_NO_HEADER = 'ERR_DECODE_NO_HEADER'

export const ERR_RECV_WINDOW_EXCEEDED = 'ERR_RECV_WINDOW_EXCEEDED'

/**
 * INITIAL_STREAM_WINDOW is the initial stream window size.
 *
 * Not an implementation choice, this is defined in the specification
 */
export const INITIAL_STREAM_WINDOW = 256 * 1024
export const MAX_STREAM_WINDOW = 16 * 1024 * 1024

export const MAX_UINT32 = 2 ** 32 - 1
