# Background Jobs

PostgreSQL-backed workers live here:

- Transactional outbox publisher
- Transactional email delivery
- Expired-token and soft-delete cleanup
- Feed score recomputation

No Redis-backed queue is permitted. Jobs must support retries, idempotency,
dead-letter/error state, and observable processing lag.
