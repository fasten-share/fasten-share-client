# Fasten Share Client

English | [中文](./README_zh.md)

Fasten Share Client is the open-source local client for Fasten Share. It provides a browser-based control panel and a local Node.js producer process so you can:

- share your own local or online model backend as a producer;
- discover shared model nodes as a consumer;
- generate compatible service endpoints for tools and API clients;
- keep upstream API keys on your own machine instead of sending them to other users.

If you only want to use the packaged desktop app, download it from the desktop releases page:

- Desktop releases: <https://github.com/fasten-share/fasten-share-desktop/releases>

## What You Can Do

### Use shared model nodes

Use the client as a consumer to search available producers by model/protocol, select a consumer API key, and copy a generated endpoint for compatible AI tools or OpenAI/Anthropic-style clients.

Consumer model traffic goes through the Fasten Share service endpoint you copy from the UI. It does not pass through your local Next.js page.

### Share your own backend

Use the client as a producer to publish a backend such as:

- local Ollama, LM Studio, vLLM, or another OpenAI-compatible service;
- online OpenAI-compatible or Anthropic-compatible endpoints;
- Azure OpenAI-style deployments, when configured with the correct API version.

The client opens an outbound producer WebSocket to the Fasten Share service, runs health checks, and forwards streamed requests to your configured backend.

### Keep credentials local

When you share a backend, its upstream API key/token is stored on your machine and injected locally when forwarding requests to that backend. Do not share a backend unless you have the right to do so under the relevant provider terms.

## Recommended Usage

For most users, use the desktop app from:

<https://github.com/fasten-share/fasten-share-desktop/releases>

The desktop app wraps this client and provides a simpler installation path for Windows and macOS. Linux users can run this client directly or follow the latest instructions in this repository.

## Run From Source

Requirements:

- Node.js compatible with the version required by this project;
- access to a Fasten Share service endpoint;
- a local or online model backend if you want to act as a producer.

For normal use, run the production build instead of the development server:

```bash
npm install
npm run build
npm run start
```

Then open:

```text
http://localhost:8086
```

Default local ports:

- UI: `8086`
- local status WebSocket: `8087`

For server or always-on usage, Docker Compose is usually the simpler path. See [Docker](#docker).

> Maintainer note: if you are working in WSL in this repository, follow the local project instructions and avoid running npm commands there.

## Configuration

The client can be configured from the UI. It also supports environment variables for local development and headless producer deployments.

### Service connection

| Variable | Description | Default |
| --- | --- | --- |
| `FS_WS_PORT` | Local browser status WebSocket port | `8087` |
| `FS_WS_HOST` | Local browser status WebSocket host | `127.0.0.1` |
| `FS_DATA_DIR` | Directory for local client config | `~/.fasten-share` |

### Producer backend seed

For a single backend:

| Variable | Description |
| --- | --- |
| `FS_BACKEND_BASEURL` | Backend base URL, excluding API version path |
| `FS_BACKEND_APIKEY` | Backend API key/token, optional for local backends |
| `FS_BACKEND_PROTOCOL` | Protocol, for example `openai`, `anthropic`, or `azure-openai` |
| `FS_BACKEND_APIVERSION` | Azure OpenAI API version, when needed |
| `FS_BACKEND_VERSION_PREFIX` | Version prefix forwarded after the peer id, for example `/v1` |
| `FS_BACKEND_MODELS` | Comma-separated model names for discovery |
| `FS_BACKEND_COST_MULTIPLIER` | Credit cost multiplier |
| `FS_BACKEND_MAX_CONCURRENCY` | Maximum concurrent producer requests |

For multiple backends, set `FS_BACKENDS` to a JSON array of backend objects. The UI will persist normalized backend IDs and configuration under `FS_DATA_DIR`.

## Docker

A Docker Compose file is included for running the client as a standalone service:

```bash
docker compose up -d --build
```

Then open:

```text
http://localhost:8086
```

Before deploying with Docker Compose, review the compose file and set the service endpoint to your actual Fasten Share service URL.

## Development

Use the development server only when you are modifying the client source code:

```bash
npm install
npm run dev
```

The development server runs the same local UI port (`8086`) but is not the recommended way to run the client for regular users.

## Typical Producer Setup

1. Sign in to the client.
2. Open the producer/share tab.
3. Add a backend.
4. Enter the backend base URL without the API version path.
5. Select the protocol and version prefix.
6. Enter exposed model names for discovery.
7. Set concurrency and credit multiplier.
8. Save and start sharing.

Example for local Ollama:

| Field | Example |
| --- | --- |
| Base URL | `http://localhost:11434` |
| Protocol | OpenAI-compatible preset, if exposed through a compatible endpoint |
| API key | Leave empty if your local backend does not require one |
| Models | `llama3.1`, `qwen2.5`, or your local model names |

Use the in-app base URL guide for protocol-specific examples.

## Typical Consumer Setup

1. Sign in to the client.
2. Create or select a consumer API key.
3. Search for a model node by model name or protocol.
4. Pick a producer node.
5. Copy the generated service endpoint or use the tool-configuration helper.
6. Use that endpoint in a compatible client or AI tool.

## Credits, Ratings, And Social Features

The client displays consumer credits and producer credits separately. It also supports producer follows and monthly ratings so consumers can evaluate producer quality over time.

## Security Notes

- Upstream producer API keys are intended to stay on the producer machine.
- Generated consumer API keys should be treated as secrets.
- Sharing a model backend or account quota is your own decision and may violate provider terms.
- Always use a trusted Fasten Share service URL.
- Stop sharing immediately if you suspect credential exposure, unexpected usage, or provider-policy issues.

## Project Structure

```text
app/                 Next.js pages, API routes, and UI components
lib/client/          Browser/client helpers
lib/server/          Local Node producer, config, protocol, and tool helpers
lib/i18n/            English and Chinese UI dictionaries
public/              Static assets
```

## License

This repository is released under the MIT License. See [LICENSE](./LICENSE).
