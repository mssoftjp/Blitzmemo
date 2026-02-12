# Building (ZIP for macOS / Windows)

## Prerequisites

- Node.js + npm
- `npm ci` (or `npm install`)

## macOS + Windows (ZIP)

Run on macOS:

```sh
npm run package:macwin:zip
```

Artifacts are written under `release/<timestamp>/`:

- `Blitzmemo-darwin-arm64.zip` (contains `Blitzmemo-darwin-arm64/Blitzmemo.app`)
- `Blitzmemo-win32-x64.zip` (contains `Blitzmemo-win32-x64/`)

## Single platform (ZIP)

Current platform:

```sh
npm run package -- --zip
```

Windows x64 (from macOS is OK):

```sh
npm run package:win -- --zip
```
