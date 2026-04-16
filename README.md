# School exam platform

Monorepo-style layout: **exam-realtime** at the repository root (Express + `public/`), **console-web** in [`web/`](web/README.md).

- Product scope (4-day window, stack, deferrals): [`docs/saas-scope-4d.md`](docs/saas-scope-4d.md)
- Service map: [`services/README.md`](services/README.md)
- Realtime HTTP/Socket contract (draft): [`docs/api-contract-exam-realtime.md`](docs/api-contract-exam-realtime.md)

**Production (Render):** `npm ci` → `npm start` — see [`DEPLOY_RENDER.md`](DEPLOY_RENDER.md).

**Next.js console:** set `EXAM_REALTIME_URL` in `web/.env.local` to the same public URL as the Render service so `/exam/[id]` can open the realtime student client with a safe prefill link.
