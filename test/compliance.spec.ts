/* eslint-env mocha */

import tests from '@libp2p/interface-stream-muxer-compliance-tests'
import { TestYamux } from './util.js'

describe('compliance', () => {
  tests({
    async setup () {
      return new TestYamux({})
    },
    async teardown () {}
  })
})
