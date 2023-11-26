import { Yamux } from './muxer.js'
import type { YamuxMuxerInit } from './muxer.js'
import type { ComponentLogger } from '@libp2p/interface'
import type { StreamMuxerFactory } from '@libp2p/interface/stream-muxer'
export { GoAwayCode } from './frame.js'

export interface YamuxComponents {
  logger: ComponentLogger
}

export function yamux (init: YamuxMuxerInit = {}): (components: YamuxComponents) => StreamMuxerFactory {
  return (components) => new Yamux(components, init)
}
