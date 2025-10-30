# Changelog

## [0.10.1](https://github.com/terrazul-ai/cli/compare/v0.10.0...v0.10.1) (2025-10-30)


### Bug Fixes

* Fixes --model default, as this causes Claude Code to fail ([#32](https://github.com/terrazul-ai/cli/issues/32)) ([8d2b400](https://github.com/terrazul-ai/cli/commit/8d2b400a986c2f3b4eca742d6fb0dc5de48e60e7))

## [0.10.0](https://github.com/terrazul-ai/cli/compare/v0.9.0...v0.10.0) (2025-10-29)


### Features

* **create:** Introduces the 'tz create' CLI command ([#33](https://github.com/terrazul-ai/cli/issues/33)) ([05eab7e](https://github.com/terrazul-ai/cli/commit/05eab7e68d59306ce696b04a8fe5ebcc1b84aa29))

## [0.9.0](https://github.com/terrazul-ai/cli/compare/v0.8.0...v0.9.0) (2025-10-29)


### Features

* **apply tools:** Add snippet-based template processing ([#29](https://github.com/terrazul-ai/cli/issues/29)) ([fa59f13](https://github.com/terrazul-ai/cli/commit/fa59f13abe73bb2d0fc6ad4f69cf2e42c4f3f2c7))

## [0.8.0](https://github.com/terrazul-ai/cli/compare/v0.7.4...v0.8.0) (2025-10-08)


### Features

* **commands:** add install command ([#28](https://github.com/terrazul-ai/cli/issues/28)) ([0406f56](https://github.com/terrazul-ai/cli/commit/0406f564d6ae53d6a041d45805083550e7ef0121))
* **mcp:** extract mcp from codex ([#27](https://github.com/terrazul-ai/cli/issues/27)) ([279e393](https://github.com/terrazul-ai/cli/commit/279e3935db95b6c3b3186f9cb55541bf1460d5a2))


### Bug Fixes

* **commands:** default extract package version to 0.0.0 ([#25](https://github.com/terrazul-ai/cli/issues/25)) ([edb4e5a](https://github.com/terrazul-ai/cli/commit/edb4e5adf6177e053fd0486b1385e444e8e85d05))

## [0.7.4](https://github.com/terrazul-ai/cli/compare/v0.7.3...v0.7.4) (2025-10-07)


### Bug Fixes

* **commands:** sea build issue ([5e4a81c](https://github.com/terrazul-ai/cli/commit/5e4a81cd2b1893749d3f915b1db12f30f9318c63))
* **commands:** sea build issue ([31b21cb](https://github.com/terrazul-ai/cli/commit/31b21cb0ff4a21b937c14018ac59ace734f156f0))

## [0.7.3](https://github.com/terrazul-ai/cli/compare/v0.7.2...v0.7.3) (2025-10-07)


### Bug Fixes

* **extract:** include selected MCP configs in extract ([cde108f](https://github.com/terrazul-ai/cli/commit/cde108f468d802716721c195a60e29a3364831f5))
* **extract:** include selected MCP configs in extract ([b77d188](https://github.com/terrazul-ai/cli/commit/b77d1888de8e07424fe5e901b91d1837335ed78b))

## [0.7.2](https://github.com/terrazul-ai/cli/compare/v0.7.1...v0.7.2) (2025-10-06)


### Bug Fixes

* **ci:** prevent duplicate workflow runs and add SEA cache warnings ([929b599](https://github.com/terrazul-ai/cli/commit/929b599fdc595b2878fdec2a77a9b9ecf053bb4f))

## [0.7.1](https://github.com/terrazul-ai/cli/compare/v0.7.0...v0.7.1) (2025-10-06)


### Bug Fixes

* **tests:** use shared test helpers with auth token injection ([210a96e](https://github.com/terrazul-ai/cli/commit/210a96e533b3cff932cc8009a00bb8d76ef602c5))

## [0.7.0](https://github.com/terrazul-ai/cli/compare/v0.6.0...v0.7.0) (2025-10-06)


### Features

* **commands:** rename install command to add ([00e80da](https://github.com/terrazul-ai/cli/commit/00e80da450182ea4b2d179d2a9438f8ae0979681))
* **commands:** rename install command to add ([ac4ace5](https://github.com/terrazul-ai/cli/commit/ac4ace54d46feb9426e21699748cbce40931fe7f))

## [0.6.0](https://github.com/terrazul-ai/cli/compare/v0.5.13...v0.6.0) (2025-10-06)


### Features

* add subagent selection step to extract wizard ([02c0833](https://github.com/terrazul-ai/cli/commit/02c0833c3fe28a045b044081ece6abd4fd9818b8))
* scope extract wizard default name to profile ([592dcde](https://github.com/terrazul-ai/cli/commit/592dcdeef5b4ea0b76bc204a9073b64e82ace6a7))


### Bug Fixes

* **ci:** correct workflow location and enable full platform matrix ([63071dd](https://github.com/terrazul-ai/cli/commit/63071dd75f5b6f5161e2e2d8afab03564c75f102))
* **ci:** move Release Please workflow to correct location ([466dd2c](https://github.com/terrazul-ai/cli/commit/466dd2c7a068144b35e5d0eea1ccd256da9e6594))
* **ci:** remove restrictive path filters and fix monorepo references ([2a6edc9](https://github.com/terrazul-ai/cli/commit/2a6edc9cb546f90053d462372b2aab8b58c63d84))
* **ci:** restore RELEASE_PLEASE_TOKEN in workflow ([9aae885](https://github.com/terrazul-ai/cli/commit/9aae885835b0cda6dcfd888971c06af8913ba890))
* **ci:** update Node.js version to v18.20.4 for pnpm compatibility ([2c82786](https://github.com/terrazul-ai/cli/commit/2c82786b223a05947306a12c63b383f509c6a4bc))
* **copy:** plus ci ([b1771ea](https://github.com/terrazul-ai/cli/commit/b1771ea9807b08a676995192f139ae7b16a7f004))
* Fixes publish to use the latest api format ([869211a](https://github.com/terrazul-ai/cli/commit/869211a6e24be7399e2bb9532a4182efb507df78))
* resolve all TypeScript/ESLint errors with proper type annotations ([f73b5b6](https://github.com/terrazul-ai/cli/commit/f73b5b6a3d65f424abf1f16ac636770e24d1d717))
* **tests:** resolve ESM compatibility and test assertion issues ([a1c745b](https://github.com/terrazul-ai/cli/commit/a1c745b613f634408585b9037a3542aa9099dde5))
* **tools:** skip Node version check when not launching in verify-sea-package ([b626832](https://github.com/terrazul-ai/cli/commit/b6268323f9c9971fe5032f1ee8d5130ece5d34b6))

## [0.4.2-m0](https://github.com/terrazul-ai/terrazul/compare/v0.4.1-m0...v0.4.2-m0) (2025-10-02)


### Bug Fixes

* **cli:** improve module not found detection for ESM context ([a0db725](https://github.com/terrazul-ai/terrazul/commit/a0db72539774335464f3db3e89735db86b8ad42e))

## [0.4.1-m0](https://github.com/terrazul-ai/terrazul/compare/v0.4.0-m0...v0.4.1-m0) (2025-10-02)


### Bug Fixes

* **cli:** bundle zod in sea-fetcher runtime module ([409b137](https://github.com/terrazul-ai/terrazul/commit/409b13719205afbba2b54e5b48bf4cc147f9ae14))

## [0.4.0-m0](https://github.com/terrazul-ai/terrazul/compare/v0.3.1-m0...v0.4.0-m0) (2025-10-02)


### Features

* **publishing:** pull ([#223](https://github.com/terrazul-ai/terrazul/issues/223)) ([f7c3b12](https://github.com/terrazul-ai/terrazul/commit/f7c3b12da9923299427b8f195bfb8dce838f93ae))

## [0.3.1-m0](https://github.com/terrazul-ai/terrazul/compare/v0.3.0-m0...v0.3.1-m0) (2025-10-02)


### Bug Fixes

* **deploy:** pls work ([#218](https://github.com/terrazul-ai/terrazul/issues/218)) ([877063a](https://github.com/terrazul-ai/terrazul/commit/877063a04e182df0b4090bc427e958aec46f5e9b))

## [0.3.0-m0](https://github.com/terrazul-ai/terrazul/compare/v0.2.7-m0...v0.3.0-m0) (2025-10-01)


### Features

* **Refactor:** SEA pipeline for Node 20+ and artifact packaging ([#215](https://github.com/terrazul-ai/terrazul/issues/215)) ([8c2c4ea](https://github.com/terrazul-ai/terrazul/commit/8c2c4ea5d25670c949876f9ff6dd09520abc0a55))

## [0.2.7-m0](https://github.com/terrazul-ai/terrazul/compare/v0.2.6-m0...v0.2.7-m0) (2025-10-01)


### Bug Fixes

* **cli:** record release automation updates ([#212](https://github.com/terrazul-ai/terrazul/issues/212)) ([bfbac12](https://github.com/terrazul-ai/terrazul/commit/bfbac12e5eded3c43cf5609c4d3b6d7c99aa2912))

## [0.2.6-m0](https://github.com/terrazul-ai/terrazul/compare/v0.2.5-m0...v0.2.6-m0) (2025-09-30)


### Bug Fixes

* **cli:** add release verification note ([#209](https://github.com/terrazul-ai/terrazul/issues/209)) ([c5c791c](https://github.com/terrazul-ai/terrazul/commit/c5c791cb97600f16bf0b7346baa7537c3af3e116))

## [0.2.5-m0](https://github.com/terrazul-ai/terrazul/compare/v0.2.4-m0...v0.2.5-m0) (2025-09-30)


### Bug Fixes

* **rp:** cli release note ([#203](https://github.com/terrazul-ai/terrazul/issues/203)) ([1e07e5c](https://github.com/terrazul-ai/terrazul/commit/1e07e5c7e37c8e569126763bbeb9b041c09538c5))

## [0.2.4-m0](https://github.com/terrazul-ai/terrazul/compare/v0.2.3-m0...v0.2.4-m0) (2025-09-30)


### Bug Fixes

* **cli:** document release workflow ([#201](https://github.com/terrazul-ai/terrazul/issues/201)) ([e1731c7](https://github.com/terrazul-ai/terrazul/commit/e1731c7a33eb2eb5077c71b4a78fb187b43df268))

## [0.2.3-m0](https://github.com/terrazul-ai/terrazul/compare/v0.2.2-m0...v0.2.3-m0) (2025-09-30)


### Bug Fixes

* **release:** fix release ([#197](https://github.com/terrazul-ai/terrazul/issues/197)) ([69e0cae](https://github.com/terrazul-ai/terrazul/commit/69e0cae767cb0cca718ac93db997669dc186dae3))

## [0.2.2-m0](https://github.com/terrazul-ai/terrazul/compare/v0.2.1-m0...v0.2.2-m0) (2025-09-29)


### Bug Fixes

* **release:** tag pickup ([#195](https://github.com/terrazul-ai/terrazul/issues/195)) ([fe47a01](https://github.com/terrazul-ai/terrazul/commit/fe47a01c8b7e9920a50e8d61e6df92ef6d21d828))

## [0.2.1-m0](https://github.com/terrazul-ai/terrazul/compare/v0.2.0-m0...v0.2.1-m0) (2025-09-29)


### Bug Fixes

* **extract:** release formatting ([#193](https://github.com/terrazul-ai/terrazul/issues/193)) ([445f26f](https://github.com/terrazul-ai/terrazul/commit/445f26f9d506d4a1aa8351273dba6a605461ea44))

## [0.2.0-m0](https://github.com/terrazul-ai/terrazul/compare/v0.1.0-m0...v0.2.0-m0) (2025-09-29)

### Features

- **extract:** Interactive ux ([#188](https://github.com/terrazul-ai/terrazul/issues/188)) ([dd60231](https://github.com/terrazul-ai/terrazul/commit/dd6023114dbdc1e2d588d4bd10854bd4eb617f26))

## [0.1.0-m0](https://github.com/terrazul-ai/terrazul/compare/v0.0.2-m0...v0.1.0-m0) (2025-09-19)

### Features

- publish scoped CLI package ([#161](https://github.com/terrazul-ai/terrazul/issues/161)) ([32aa7da](https://github.com/terrazul-ai/terrazul/commit/32aa7da41158b42042a792c8ddcf0e3dd8efbe4f))

### Bug Fixes

- **ci:** trigger ([#157](https://github.com/terrazul-ai/terrazul/issues/157)) ([88c06a0](https://github.com/terrazul-ai/terrazul/commit/88c06a0aefa56ebd3173959dc520eb97b3210bb6))

## [0.0.2-m0](https://github.com/terrazul-ai/terrazul/compare/terrazul-cli-v0.0.1-m0...terrazul-cli-v0.0.2-m0) (2025-09-19)

### Bug Fixes

- **ci:** trigger ([#157](https://github.com/terrazul-ai/terrazul/issues/157)) ([88c06a0](https://github.com/terrazul-ai/terrazul/commit/88c06a0aefa56ebd3173959dc520eb97b3210bb6))

## [0.0.1-m0](https://github.com/terrazul-ai/terrazul/compare/terrazul-cli-v0.0.0-m0...terrazul-cli-v0.0.1-m0) (2025-09-19)

### Bug Fixes

- **ci:** trigger ([#157](https://github.com/terrazul-ai/terrazul/issues/157)) ([88c06a0](https://github.com/terrazul-ai/terrazul/commit/88c06a0aefa56ebd3173959dc520eb97b3210bb6))
