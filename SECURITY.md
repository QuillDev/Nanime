# Security policy

## Report a vulnerability

Use GitHub's private **Report a vulnerability** flow under the repository's
Security tab. Do not open a public issue. Include the affected revision,
reproduction steps, and impact. Do not access other people's data, disrupt a
deployment, or publish details before a fix is available.

## Support

Security fixes target the latest commit on the default branch. Older releases
are not maintained.

## Operations

Run Nanime behind a TLS reverse proxy with minimum filesystem privileges. Keep
dependencies current, protect the database and qBittorrent credentials, and
back up persistent state.
