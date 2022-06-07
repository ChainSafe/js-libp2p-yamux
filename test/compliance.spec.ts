/* eslint-env mocha */

import tests from '@libp2p/interface-compliance-tests/stream-muxer'
import type { Components } from '@libp2p/interfaces/components'
import { logger } from '@libp2p/logger'
import { Yamux, YamuxMuxer, YamuxMuxerInit } from '../src/muxer.js'

const isClient = (() => {
  let client = false
  return () => {
    const isClient = !client
    client = isClient
    return isClient
  }
})()

/**
 * Yamux must be configured with a client setting `client` to true
 * and a server setting `client` to falsey
 *
 * Since the compliance tests create a dialer and listener,
 * manually alternate setting `client` to true and false
 */
export class TestYamux extends Yamux {
  createStreamMuxer (components: Components, init?: YamuxMuxerInit): YamuxMuxer {
    const client = isClient()
    return super.createStreamMuxer(components, { ...init, client, log: logger(`libp2p:yamux${client ? 1 : 2}`) })
  }
}

describe('compliance', () => {
  tests({
    async setup () {
      return new TestYamux()
    },
    async teardown () {}
  })
})
