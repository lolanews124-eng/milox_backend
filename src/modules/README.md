# API Domain Modules

Every backend feature is an isolated module under this directory:

```text
modules/
├── auth/
├── users/
├── media/
├── posts/
├── feed/
├── comments/
├── follows/
├── interests/
├── chat/
├── notifications/
├── moderation/
├── admin/
└── audit/
```

Each implemented module follows this internal structure:

```text
<module>/
├── domain/          # Entities, value objects, policies, repository ports
├── application/     # Use cases and orchestration
├── infrastructure/  # Prisma repositories and external adapters
├── presentation/    # Express routes, request schemas, DTO mappers
└── index.ts          # Public module composition API
```

Rules:

- A module may import only another module's exported application API.
- Domain code cannot import Express, Prisma, Socket.IO, or filesystem APIs.
- Presentation DTOs must be explicit; Prisma records are never returned directly.
- Sensitive account fields cannot be exported from public profile DTOs.
- Feature implementation begins in Modules 5–14 of the delivery sequence.
