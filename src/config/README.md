# Runtime Configuration

This directory will own environment validation and typed configuration.

Rules:

- Validate required variables at startup.
- Never provide insecure production secret defaults.
- Never log secret values.
- Keep environment-specific values outside source control.

See `apps/api/.env.example` for the documented variable contract.
