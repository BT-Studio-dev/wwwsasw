# BT Panel

BT Panel is an independent, self-hosted control-panel application with a BT-branded interface and workflows inspired by common Pterodactyl panel patterns. It is not an official Pterodactyl distribution, and this project does not bundle Pterodactyl source code. See [Pterodactyl Panel](https://github.com/pterodactyl/panel) for the upstream project.

## Requirements

- Node.js 22 LTS
- npm
- A MySQL-compatible database

## Local development

1. Copy `.env.example` to `.env`.
2. Set `APP_ID`, `APP_SECRET`, and `DATABASE_URL` in `.env`.
3. Install dependencies with `npm ci`.
4. Start the development server with `npm run dev`.

The Vite development server runs on port `3000` by default.

## Production

```sh
npm ci
npm run check
npm run build
NODE_ENV=production npm start
```

Set the required environment variables in the production environment before starting the server. The frontend is built to `dist/public`, and the bundled API server is written to `dist/boot.js`.

## Project checks

- `npm run check` runs TypeScript project checks.
- `npm run lint` runs ESLint.
- `npm test` runs Vitest tests.
- `npm run build` builds the frontend and bundles the API server.

## Pterodactyl integration

BT Panel includes an admin-only **Pterodactyl** page that reads live server, node, nest, egg, and allocation data through Pterodactyl's Application API. It can create node allocations and suspend or unsuspend a server; these actions are sent to the configured Pterodactyl panel, not simulated in BT Panel. Existing BT Panel records and the original local resource screens remain separate.

1. Create an Application API key in Pterodactyl with read access to servers, nodes, allocations, nests, and eggs. To enable the included write actions, grant write access to allocations and servers. Use the narrowest permissions that fit your setup.
2. Set `PTERODACTYL_URL`, `PTERODACTYL_APPLICATION_TOKEN`, and optionally `PTERODACTYL_TIMEOUT_MS` in the BT Panel server environment. Copy `.env.example` for local setup.
3. Restart BT Panel and open **Service Management → Pterodactyl** as an owner or administrator.

Keep the Application API token in the backend environment or a server-side secret manager. Do not add it to frontend variables, browser storage, source control, or a request from the browser. The BT Panel API never returns the token. Use HTTPS between BT Panel and Pterodactyl in production.

The current Application API integration shows a node's maintenance state and resources, not a live Wings heartbeat. Runtime console, file transfer, and start/stop/restart controls require a separate authenticated Pterodactyl Client API integration; no Wings or daemon credentials are collected by this feature. Allocation creation and server suspension are explicit operations; suspension asks for confirmation in BT Panel.

This integration uses Pterodactyl's documented public API and does not bundle Pterodactyl source code. BT Panel is independent and is not an official Pterodactyl distribution. Upstream project and license: [Pterodactyl Panel](https://github.com/pterodactyl/panel) (MIT).
