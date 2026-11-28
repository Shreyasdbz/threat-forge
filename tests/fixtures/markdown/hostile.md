# Threat Model: `### Forged heading ![beacon](https://example.test/pixel)`

Description: `- [x] fake checklist **not bold** <img src=x> &lt;tag&gt;`

## Components

- `@reviewers www.example.test user@example.test` (`component`) — `process`, `| internal |`
  - Description: `See #321 and other/repo#42`

## Data Flows

- `~~flow~~` (`flow`) — `@reviewers www.example.test user@example.test` (`component`) → `@reviewers www.example.test user@example.test` (`component`)
  - Protocol: `https://example.test`
  - Data: `[arbitrary](https://example.test)`
  - Authenticated: No

## Findings

- ``` ``execute`` ``` (`finding`) — Low, Spoofing
  - Component: `@reviewers www.example.test user@example.test` (`component`)
  - Flow: `~~flow~~` (`flow`)
  - Description: `$x$ <https://example.test>`

## Mitigations

- ``` ``execute`` ``` (`finding`) — In progress
  - Notes: `> pretend quote [check]: https://example.test`
