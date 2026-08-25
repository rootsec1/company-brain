# Security policy

## Supported versions

Aperture is pre-1.0. Security fixes are applied to the latest `main` branch and the most recent tagged release.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository. Include the affected revision, reproduction steps, impact, and any suggested mitigation.

You should receive an acknowledgement within five business days. We will coordinate disclosure after a fix is available.

## Deployment boundary

Aperture v1 has no application authentication and is designed for a single trusted workspace. The Compose file binds the web interface to `127.0.0.1`; do not expose it directly to an untrusted network. Put an authenticated reverse proxy and appropriate network policy in front of it before any shared deployment.

External integrations are read-only by policy. Treat changes to action filtering, OAuth callbacks, URL fetching, file parsing, MCP tools, citation rendering, object keys, and archive extraction as security-sensitive.

Never attach `.env`, provider tokens, live company content, raw indexed objects, or unredacted request traces to an issue.
