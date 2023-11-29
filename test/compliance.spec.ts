/* eslint-env mocha */

import tests from '@libp2p/interface-compliance-tests/stream-muxer'
import { defaultLogger } from '@libp2p/logger'
import { TestYamux } from './util.js'

describe('compliance', () => {
  tests({
    async setup () {
      return new TestYamux({
        logger: defaultLogger()
      })
    },
    async teardown () {}
  })
})
