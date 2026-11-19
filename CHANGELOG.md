# Changelog

## 1.4.0

### Server instructions

The server now sends instructions describing what it is for, so a client can
tell an agent how to use these tools without being told separately.

### Idempotent hints

Read-only tools are annotated as idempotent. A client that retries a failed
call can now tell which tools are safe to retry on their own.

## Earlier versions

Releases before 1.4.0 predate this file and have no entry here. The commit
history on GitHub is the record for those.
