/* eslint-env mocha */

import { Components } from '@libp2p/components'
import tests from '@libp2p/interface-stream-muxer-compliance-tests'
import { TestYamux } from './util.js'

describe('compliance', () => {
  tests({
    async setup () {
      return new TestYamux(new Components())
    },
    async teardown () {}
  })
})
