import type { StreamMuxerFactory } from '@libp2p/interface-stream-muxer'
import { Yamux } from './muxer.js'
import type { YamuxMuxerInit, YamuxComponents } from './muxer.js'
export { GoAwayCode } from './frame.js'

export function yamux (init: YamuxMuxerInit = {}): (components?: YamuxComponents) => StreamMuxerFactory {
  return (components: YamuxComponents = {}) => new Yamux(components, init)
}
