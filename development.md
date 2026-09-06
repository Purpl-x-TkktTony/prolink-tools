# Development

Install dependencies with pnpm, then build the Electron app:

```sh
pnpm install
pnpm build
pnpm start
```

For development, start the watcher/dev-server stack in one terminal:

```sh
pnpm start-dev
```

After the renderer dev server reports that it is running on port `2003`, start
Electron from another terminal:

```sh
pnpm start
```

The development stack also starts the website dev server on port `2004`, the
overlay dev server on port `2005`, and the API server on port `8888`.

## Tests

The local playback API (see [docs/local-api.md](docs/local-api.md)) has unit
tests using Node's built-in test runner:

```sh
pnpm test:playback-api
```
