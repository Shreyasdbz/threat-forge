# Threat Model: `Checkout Café`

Description: `Checkout on the web`

## Components

- `Orders` (`orders`) — `data_store`, `internal`
  - Description: `Stores fulfilled orders`
- `Storefront` (`web-app`) — `process`, `public`

## Data Flows

- `Read order` (`read-order`) — `Orders` (`orders`) → `Storefront` (`web-app`)
  - Authenticated: No
- `Write order` (`write-order`) — `Storefront` (`web-app`) → `Orders` (`orders`)
  - Protocol: `PostgreSQL/TLS`
  - Data: `Order record`
  - Authenticated: Yes

## Findings

- `Read another customer’s order` (`leak`) — Medium, Information Disclosure
  - Component: `Storefront` (`web-app`)
  - Description: `A response could include an unrelated order`
- `Replay a write` (`replay`) — High, Tampering
  - Flow: `Write order` (`write-order`)

## Mitigations

- `Read another customer’s order` (`leak`) — Not recorded
- `Replay a write` (`replay`) — Mitigated
  - Notes: `Enforce idempotency keys`
