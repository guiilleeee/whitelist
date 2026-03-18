# FiveM Whitelist

Monorepo with:
- `apps/web`: Next.js + Tailwind frontend
- `apps/api`: Node.js + Express backend
- `db`: PostgreSQL schema + seed data

## Local setup (PostgreSQL)
1. Create database: `createdb whitelist`
2. Apply schema: `psql -d whitelist -f db/schema.sql`
3. Seed questions: `psql -d whitelist -f db/seed_questions.sql`
4. Configure API env: copy `apps/api/.env.example` to `apps/api/.env`
5. Configure Web env: copy `apps/web/.env.example` to `apps/web/.env`
6. Start API: `cd apps/api && npm install && npm run dev`
7. Start Web: `cd apps/web && npm install && npm run dev`

## Deploy
- Web: Vercel
- API: Railway or similar
- DB: Supabase or Railway Postgres

Ensure `WEB_URL` and `NEXT_PUBLIC_API_URL` point to the deployed domains.
