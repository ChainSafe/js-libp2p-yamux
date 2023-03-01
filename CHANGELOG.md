## [3.0.7](https://github.com/ChainSafe/js-libp2p-yamux/compare/v3.0.6...v3.0.7) (2023-03-01)


### Bug Fixes

* catch stream sink errors ([#25](https://github.com/ChainSafe/js-libp2p-yamux/issues/25)) ([7c7fd07](https://github.com/ChainSafe/js-libp2p-yamux/commit/7c7fd07338379d57b6d0bd1dde12e36797cf3c50))

## [3.0.6](https://github.com/ChainSafe/js-libp2p-yamux/compare/v3.0.5...v3.0.6) (2023-02-24)


### Dependencies

* **dev:** bump it-pair from 2.0.3 to 2.0.4 ([#22](https://github.com/ChainSafe/js-libp2p-yamux/issues/22)) ([f908735](https://github.com/ChainSafe/js-libp2p-yamux/commit/f908735bbbd921b0806ffe4a3cec6176662e1f3c))

## [3.0.5](https://github.com/ChainSafe/js-libp2p-yamux/compare/v3.0.4...v3.0.5) (2023-01-16)


### Dependencies

* **dev:** bump aegir from 37.12.1 to 38.1.0 ([#20](https://github.com/ChainSafe/js-libp2p-yamux/issues/20)) ([0cf9a86](https://github.com/ChainSafe/js-libp2p-yamux/commit/0cf9a865bff5f82b3fe03bf2a718b22f1cd1ef5d))


### Trivial Changes

* replace err-code with CodeError ([#21](https://github.com/ChainSafe/js-libp2p-yamux/issues/21)) ([8c2ba01](https://github.com/ChainSafe/js-libp2p-yamux/commit/8c2ba01f5dbeb736e94cf6df3ab140494a2b184d))

## [3.0.4](https://github.com/ChainSafe/js-libp2p-yamux/compare/v3.0.3...v3.0.4) (2023-01-06)


### Bug Fixes

* remove unused deps ([#19](https://github.com/ChainSafe/js-libp2p-yamux/issues/19)) ([beb4707](https://github.com/ChainSafe/js-libp2p-yamux/commit/beb47073fc1f919def45db262ed58f7d1f3a7a96))

## [3.0.3](https://github.com/ChainSafe/js-libp2p-yamux/compare/v3.0.2...v3.0.3) (2022-11-05)


### Bug Fixes

* remove metrics from component ([#17](https://github.com/ChainSafe/js-libp2p-yamux/issues/17)) ([c396f8c](https://github.com/ChainSafe/js-libp2p-yamux/commit/c396f8c1b99f3c68104c894a1ac88a805bff68a3))

## [3.0.2](https://github.com/ChainSafe/js-libp2p-yamux/compare/v3.0.1...v3.0.2) (2022-10-17)


### Dependencies

* **dev:** bump @libp2p/mplex from 6.0.2 to 7.0.0 ([#14](https://github.com/ChainSafe/js-libp2p-yamux/issues/14)) ([4085a05](https://github.com/ChainSafe/js-libp2p-yamux/commit/4085a05d169b6aea212f995044512ee011e15e07))

## [3.0.1](https://github.com/ChainSafe/js-libp2p-yamux/compare/v3.0.0...v3.0.1) (2022-10-17)


### Dependencies

* **dev:** bump @libp2p/interface-stream-muxer-compliance-tests from 5.0.0 to 6.0.0 ([#15](https://github.com/ChainSafe/js-libp2p-yamux/issues/15)) ([b6a02d1](https://github.com/ChainSafe/js-libp2p-yamux/commit/b6a02d1613df746f626ea75bfa3b9d601d34e071))
* **dev:** bump it-drain from 1.0.5 to 2.0.0 ([#16](https://github.com/ChainSafe/js-libp2p-yamux/issues/16)) ([399a49c](https://github.com/ChainSafe/js-libp2p-yamux/commit/399a49ce7b539ab5643491938cb13cb1857a2bc1))

## [3.0.0](https://github.com/ChainSafe/js-libp2p-yamux/compare/v2.0.0...v3.0.0) (2022-10-12)


### ⚠ BREAKING CHANGES

* modules no longer implement `Initializable` instead switching to constructor injection

### Bug Fixes

* remove @libp2p/components ([#13](https://github.com/ChainSafe/js-libp2p-yamux/issues/13)) ([3fafe00](https://github.com/ChainSafe/js-libp2p-yamux/commit/3fafe0053c6e752e86d0c68549a62b231b16d4ac))

## [2.0.0](https://github.com/ChainSafe/js-libp2p-yamux/compare/v1.0.1...v2.0.0) (2022-10-07)


### ⚠ BREAKING CHANGES

* **deps:** bump @libp2p/interface-stream-muxer from 2.0.2 to 3.0.0 (#9)
* **deps:** bump @libp2p/components from 2.1.1 to 3.0.0 (#7)

### Bug Fixes

* update project config ([#10](https://github.com/ChainSafe/js-libp2p-yamux/issues/10)) ([b752604](https://github.com/ChainSafe/js-libp2p-yamux/commit/b752604f371a51d7efe02fea499a8e8c4f4e435c))


### Trivial Changes

* **deps-dev:** bump @libp2p/interface-stream-muxer-compliance-tests from 4.0.0 to 5.0.0 ([#8](https://github.com/ChainSafe/js-libp2p-yamux/issues/8)) ([af8c3ae](https://github.com/ChainSafe/js-libp2p-yamux/commit/af8c3ae6b708ed43b02f7021e19ae10466653a5e))
* **deps:** bump @libp2p/components from 2.1.1 to 3.0.0 ([#7](https://github.com/ChainSafe/js-libp2p-yamux/issues/7)) ([2c31bce](https://github.com/ChainSafe/js-libp2p-yamux/commit/2c31bceffdb120d044a4bfd612c94f3d28ff8540))
* **deps:** bump @libp2p/interface-stream-muxer from 2.0.2 to 3.0.0 ([#9](https://github.com/ChainSafe/js-libp2p-yamux/issues/9)) ([3235d5f](https://github.com/ChainSafe/js-libp2p-yamux/commit/3235d5fbf1fe91e0a6ec8d8356c97951d261b931))
