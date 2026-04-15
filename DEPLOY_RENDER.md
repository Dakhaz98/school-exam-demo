# Deploy on Render (free web service)

This app is a **single Node process**: Express serves `/public` and Socket.IO shares the same origin. No separate front-end build step.

## Prerequisites

- GitHub (or GitLab / Bitbucket) repository containing this project **without** `node_modules` committed (`.gitignore` is included).
- A Render account: https://dashboard.render.com/register

## Option A — Blueprint (`render.yaml`)

1. Push this repo to GitHub.
2. Render Dashboard → **New** → **Blueprint**.
3. Connect the repository and select the branch.
4. Confirm the web service `school-exam-demo1` (free). Deploy.

## Option B — Manual Web Service

1. **New** → **Web Service** → connect the repo.
2. Settings:
   - **Runtime:** Node
   - **Build command:** `npm ci` (or `npm install` if you omit the lockfile)
   - **Start command:** `npm start`
   - **Instance type:** Free
3. **Health check path:** `/api/health`
4. Deploy. Your URL will look like `https://school-exam-demo1.onrender.com`.

Render sets `PORT` automatically; `server.js` already uses `process.env.PORT`.

## After deploy

1. Open `https://<your-service>.onrender.com/api/health` — expect `"ok": true` and `"service": "school-exam-demo"`.
2. Open the site root in **three tabs** for the full walkthrough (admin / proctor / student). Each tab uses its own `sessionStorage` login.
3. **Free tier:** the service **spins down after ~15 minutes** without traffic; the first load after idle can take **~1 minute**. Wake it a few minutes before a demo. See [Render free tier](https://render.com/docs/free).
4. **Data:** exam state and audit log are **in-memory** — they reset when the instance restarts or spins down. This is expected for the trial build.

## Procurement JSON

Share `GET /api/platform/status` with IT or procurement — it lists **shipped** features vs **roadmap** in structured form.
