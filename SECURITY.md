# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x (latest) | ✅ |
| < 1.0 | ❌ |

Only the latest release is supported for security fixes. If you're running an
older version, upgrade to the latest Docker image tag or git tag.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.** Public issues are
visible to everyone, including the people who would exploit the bug.

To report a vulnerability:

1. Email the maintainer at the address on the
   [GitHub profile](https://github.com/drbiobit), or
2. Use GitHub's private vulnerability reporting:
   [Report a vulnerability](https://github.com/drbiobit/snag/security/advisories/new).

Please include:

- A description of the issue and its impact.
- Steps to reproduce, or a proof of concept where possible.
- The version or commit you found it in.

## Disclosure policy

- The maintainer will acknowledge receipt within a few days.
- We aim to release a fix within a reasonable timeframe and will coordinate
  on timing before any public disclosure.
- Credit is given in the advisory unless you prefer to remain anonymous.

## Security-relevant design notes

For context on how Snag handles credentials and sessions (useful if you're
auditing it):

- **Passwords** are hashed with PBKDF2-SHA256 (200 000 iterations, random
  per-user salt). Plaintext is never stored.
- **Sessions** use signed Flask cookies (`HttpOnly`, `SameSite=Lax`, 7-day
  lifetime). The signing key is auto-generated on first start and persisted to
  `data/secret`.
- **`/health`** is intentionally unauthenticated so container healthchecks
  work; it exposes no data.
- Snag is designed to be **self-hosted behind your own authentication or a
  reverse proxy**. If you expose it to the internet, put it behind TLS and
  consider additional access controls.
