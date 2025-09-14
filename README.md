# Duosmium MCP

This repository implements a [Model Context Protocol](https://modelcontextprotocol.io) server for [Duosmium](https://www.duosmium.org), a Science Olympiad results database. The MCP server exposes Duosmium's YAML data files as resources and provides several tools to query data in insightful ways.

## Setup

```bash
cp .env.example .env # edit .env
npm install
npm run build
npm start
```

You should put this behind a reverse proxy that can terminate TLS for you.

## Usage

ChatGPT and Claude both support custom MCPs. Just set the URL to `http(s)://<your URL>/mcp`, e.g., `https://mcp.duosmium.org/mcp`.

This requires a Duosmium Git repo located at `$DUOSMIUM_PATH` for the MCP server to retrieve files from. This application does not use any AI models itself, and there are no AI expenses involved with running this server.
