# Syncbook

Syncbook is a Simplenote-like note application with login, live editing, checklists, and history. It uses **Yjs CRDT updates over WebSocket** rather than sending whole documents per keystroke: concurrent edits merge safely, and the same binary protocol can be implemented by the native Android client without JavaScript.

## Quickstart

Copy `.env.example` to `.env`, then run `docker compose up --build`. The web app is at `http://localhost:8080`; the server health endpoint is `http://localhost:3000/api/health`.

## API

All routes except auth and health use `Authorization: Bearer <JWT>`. Auth payloads are `{ "email": "...", "password": "..." }`. `POST /api/auth/register` and `POST /api/auth/login` return `{token,user}`. `GET /api/me` returns `{user}`.

`GET /api/notes` returns owner notes as `{id,title,excerpt,updated_at,deleted_at}`. `POST /api/notes` creates an empty note. `DELETE /api/notes/:id` soft-deletes; `POST /api/notes/:id/restore` undeletes.

`GET /api/notes/:id/history` returns `{id,created_at,excerpt}` versions. `GET /api/notes/:id/history/:snapshotId` returns the version including `state`, a base64 Yjs update. `POST /api/notes/:id/history/:snapshotId/restore` restores through a CRDT update, preserving history. Snapshots are taken after idle edits and can be compacted as deployments grow.

## WebSocket protocol

Connect to `GET /ws?noteId=<uuid>&token=<jwt>`. The server speaks the standard y-websocket framing: each binary message begins with varuint `0` (sync) or `1` (awareness), followed by the `y-protocols/sync` or awareness payload. Sync uses sync-step-1, sync-step-2, and update messages. Invalid tokens and notes not owned by the subject are rejected during upgrade. Android can use the Rust `yrs` sync protocol implementation and base64 only for HTTP history responses; live updates are binary.

## Development

`npm install`, then `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test`. Set `DATABASE_URL` and `JWT_SECRET` for local server development.
