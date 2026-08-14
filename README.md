# Syncbook

Syncbook is a Simplenote-like notes app with login, live editing, checklists, per-note history, and offline cache. The server stores Yjs CRDT updates and relays them over WebSocket. It does not send whole documents on each keystroke, so concurrent edits merge and a native client can use the same protocol without JavaScript.

## Quickstart

Copy `.env.example` to `.env` for host-side development, or run:

```sh
docker compose up --build
```

The web app is at `http://localhost:8080`, the API is at `http://localhost:3000`, and health is `GET /api/health`. Compose provides the server's in-container `DATABASE_URL`; the localhost value in `.env.example` is for running the server directly on the host.

## HTTP API

All requests and responses are JSON. Except for registration, login, and health, send:

```http
Authorization: Bearer <jwt>
```

Authentication:

```http
POST /api/auth/register
{"email":"philipp@example.com","password":"correct horse battery staple"}

201 {"token":"<jwt>","user":{"id":"<uuid>","email":"philipp@example.com","created_at":"<timestamp>"}}
```

`POST /api/auth/login` accepts the same request and returns the same response. Failed login always returns `401 {"error":"Invalid email or password"}` without revealing whether an email exists. Invalid registration input returns `400`; duplicate email returns `409`.

```http
GET /api/me
200 {"user":{"id":"<uuid>","email":"philipp@example.com","created_at":"<timestamp>"}}

GET /api/notes
200 [{"id":"<uuid>","title":"First line","excerpt":"First line...","updated_at":"<timestamp>","deleted_at":null}]

GET /api/notes?trash=true
200 [{"id":"<uuid>","title":"Deleted","excerpt":"...","updated_at":"<timestamp>","deleted_at":"<timestamp>"}]

POST /api/notes
201 {"id":"<uuid>","title":"","excerpt":"","updated_at":"<timestamp>","deleted_at":null}

DELETE /api/notes/:id
204

POST /api/notes/:id/restore
204
```

Deleted notes are excluded from the default list and are visible with `trash=true`.

History:

```http
GET /api/notes/:id/history
200 [{"id":"<uuid>","created_at":"<timestamp>","excerpt":"First line"}]

GET /api/notes/:id/history/:snapshotId
200 {"id":"<uuid>","created_at":"<timestamp>","excerpt":"First line","state":"<base64-yjs-update>"}

POST /api/notes/:id/history/:snapshotId/restore
204
```

Restore computes a Yjs diff and appends it as a normal update. It never replaces or deletes history, and connected clients receive the update live. Title and excerpt are always derived server-side from the first non-empty line; clients must not maintain these fields.

## WebSocket protocol

Connect to:

```text
GET /ws?noteId=<uuid>&token=<jwt>
```

The token is checked during the HTTP upgrade. An invalid, expired, absent, or non-owner token receives:

```http
HTTP/1.1 401 Unauthorized
Connection: close
```

and the TCP connection is closed. The web provider also uses the equivalent `/ws/<noteId>?token=<jwt>` room path.

Every binary message starts with a lib0 varuint message prefix:

| Prefix | Meaning   | Remaining bytes                                                                                            |
| ------ | --------- | ---------------------------------------------------------------------------------------------------------- |
| `0`    | sync      | another varuint: `0` sync-step-1, `1` sync-step-2, or `2` update; update payloads are a varuint byte-array |
| `1`    | awareness | a varuint byte-array containing the y-protocols awareness update                                           |

Sync step 1 carries the sender's state vector. Sync step 2 carries a state update. Update messages carry only the changed Yjs update. The server sends its sync step 1 to a new peer, responds to that peer's handshake messages, and broadcasts only actual update messages to the other peers in the same note room. Awareness messages are relayed to the other room peers and are not persisted. A client should use the standard `y-protocols/sync` and `y-protocols/awareness` framing: all integers are lib0 varuints, and byte arrays are encoded as varuint length followed by raw bytes.

The document's ProseMirror XML fragment is named `prosemirror`. TipTap uses this exact field name, and a non-JS client should use the same Yjs root fragment for editor content. The server persists updates, periodically writes snapshots with a sequence watermark, and compacts old updates after the log exceeds the threshold.

## Development

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
```

The server tests expect PostgreSQL at `DATABASE_URL`; `docker compose up -d postgres` is sufficient for local DB-backed tests.
