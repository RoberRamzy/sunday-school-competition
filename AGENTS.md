# Sunday School Competition

Read [the implementation plan](sunday-school-competition-implementation-plan.md) before implementing features. It defines the Next.js frontend, NestJS modular monolith, Prisma ORM, PostgreSQL database, and deployment targets.

## Skills

- Use `nestjs` and `nestjs-feature` for API structure, modules, endpoints, and request validation. Use `nestjs-testing` for backend integration and end-to-end tests.
- Use `prisma-orm-setup` for Prisma setup and database connectivity. Use `prisma-cli` for schema and migration operations supported by the selected Prisma version. Use PostgreSQL locally and Neon for the hosted database.
- Use `impeccable` when designing, building, or reviewing frontend interfaces. Use `playwright` to verify student and staff workflows in a browser.
- Use `security-best-practices` when a security review is requested.
- Use `nestjs-production` for API configuration, OpenAPI, logging, health checks, and deployment readiness. Use `neon` and `neon-postgres` for Neon setup and operations, `render-deploy` for deploying the API to Render, and `vercel:deployments-cicd` for deploying the frontend to Vercel. Follow the plan's free-tier requirements.

## Backend design

- Before writing the first migration, define the attempt lifecycle, database constraints, transaction boundaries, and timeout finalization. Resolve how an authorized replacement can coexist with the invalidated attempt while preserving one valid attempt per student per competition.
- Enforce eligibility, student ownership, servant grade scope, deadlines, scoring, and result publication on the server.
- Make attempt start, answer saving, and submission safe to retry. Test concurrent starts, answer writes around the deadline, reconnection, and replacement attempts against PostgreSQL.
