# Shared API Infrastructure

Cross-cutting code only. Feature business rules belong in `src/modules/*`.

```text
shared/
├── errors/          # Typed application and HTTP error mapping
├── http/            # Request IDs, envelopes, pagination
├── logging/         # Pino setup and privacy redaction
├── security/        # Auth middleware, RBAC, rate limits
├── validation/      # Shared schema helpers
└── types/           # Infrastructure-neutral shared types
```

Do not create a generic dumping ground. Code must be used by at least two
modules before moving here.
