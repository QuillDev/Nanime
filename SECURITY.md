# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use the
repository's private **Report a vulnerability** flow under the Security tab.
Include affected versions, reproduction steps, impact, and any suggested fix.

Do not access data that is not yours, disrupt a running deployment, or publish
details before a fix is available.

## Supported version

Security fixes target the latest commit on the default branch. This project does
not currently maintain older release branches.

## Operator responsibilities

Nanime is designed to run behind a TLS reverse proxy. Operators are responsible
for access control at the network edge, timely dependency updates, protecting
the SQLite database and qBittorrent credentials, backing up state, and running
the service with minimum filesystem privileges.
