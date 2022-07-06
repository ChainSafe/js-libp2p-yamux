# js-libp2p-yamux

[![](https://img.shields.io/badge/made%20by-ChainSafe%20Systems-blue.svg?style=flat-square)](http://chainsafe.io)
[![](https://img.shields.io/badge/project-libp2p-yellow.svg?style=flat-square)](http://libp2p.io/)
[![](https://img.shields.io/codecov/c/github/chainsafe/js-libp2p-yamux.svg?style=flat-square)](https://codecov.io/gh/chainsafe/js-libp2p-yamux)
[![Build Status](https://github.com/chainsafe/js-libp2p-yamux/actions/workflows/js-test-and-release.yml/badge.svg?branch=master)](https://github.com/chainsafe/js-libp2p-yamux/actions/workflows/js-test-and-release.yml)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/feross/standard)
![](https://img.shields.io/badge/npm-%3E%3D7.0.0-orange.svg?style=flat-square)
![](https://img.shields.io/badge/Node.js-%3E%3D16.0.0-orange.svg?style=flat-square)

> JavaScript implementation of [yamux](https://github.com/hashicorp/yamux/blob/master/spec.md).

[![](https://github.com/libp2p/js-libp2p-interfaces/raw/master/packages/libp2p-interfaces/src/stream-muxer/img/badge.png)](https://github.com/libp2p/js-libp2p-interfaces/tree/master/packages/libp2p-interfaces/src/stream-muxer)

## Install

```sh
npm install @chainsafe/libp2p-yamux
```

## Usage

```js
import { YamuxMuxer } from '@chainsafe/libp2p-yamux'
import { Components } from '@libp2p/interfaces/components'
import { pipe } from 'it-pipe'
import { duplexPair } from 'it-pair/duplex'
import all from 'it-all'

// Connect two yamux muxers to demo basic stream multiplexing functionality

const clientMuxer = new YamuxMuxer(new Components(), {
  client: true,
  onIncomingStream: stream => {
    // echo data on incoming streams
    pipe(stream, stream)
  },
  onStreamEnd: stream => {
    // do nothing
  }
})

const serverMuxer = new YamuxMuxer(new Components(), {
  client: false,
  onIncomingStream: stream => {
    // echo data on incoming streams
    pipe(stream, stream)
  },
  onStreamEnd: stream => {
    // do nothing
  }
})

// `p` is our "connections", what we use to connect the two sides
// In a real application, a connection is usually to a remote computer
const p = duplexPair()

// connect the muxers together
pipe(p[0], clientMuxer, p[0])
pipe(p[1], serverMuxer, p[1])

// now either side can open streams
const stream0 = clientMuxer.newStream()
const stream1 = serverMuxer.newStream()

// Send some data to the other side
const encoder = new TextEncoder()
const data = [encoder.encode('hello'), encoder.encode('world')]
pipe(data, stream0)

// Receive data back
const result = await pipe(stream0, all)

// close a stream
stream1.close()

// close the muxer
clientMuxer.close()
```

## API

This library implements the `StreamMuxerFactory`, `StreamMuxer` and `Stream` interfaces defined in [`@libp2p/interfaces/stream-muxer`](https://github.com/libp2p/js-libp2p-interfaces/tree/master/packages/libp2p-interfaces/src/stream-muxer).

## Contribute

The libp2p implementation in JavaScript is a work in progress. As such, there are a few things you can do right now to help out:

 - Go through the modules and **check out existing issues**. This is especially useful for modules in active development. Some knowledge of IPFS/libp2p may be required, as well as the infrastructure behind it - for instance, you may need to read up on p2p and more complex operations like muxing to be able to help technically.
 - **Perform code reviews**. More eyes will help a) speed the project along b) ensure quality and c) reduce possible future bugs.

## License

Licensed under either of

 * Apache 2.0, ([LICENSE-APACHE](LICENSE-APACHE) / http://www.apache.org/licenses/LICENSE-2.0)
 * MIT ([LICENSE-MIT](LICENSE-MIT) / http://opensource.org/licenses/MIT)

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
