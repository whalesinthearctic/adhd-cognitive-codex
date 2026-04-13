# The ADHD Cognitive Codex – Landing Page

**DJ Scott Consulting** | Email collection landing page

## Quick Start

```bash
# No dependencies to install! Just run:
node server.js

# Visit http://localhost:3000
```

## How It Works

- Visitors enter their email on the landing page
- Emails are stored in a local JSON file (`emails.json`)
- The file is created automatically on first run
- Zero npm dependencies — uses only Node.js built-in modules

## Admin Endpoints

View your subscribers and export them as CSV. The default admin token is `djscott2026` — change it by setting the `ADMIN_TOKEN` environment variable.

| Endpoint | Method | Description |
|---|---|---|
| `/api/admin/subscribers?token=djscott2026` | GET | View all subscribers as JSON |
| `/api/admin/export?token=djscott2026` | GET | Download subscribers as CSV |

### Change the admin token

```bash
ADMIN_TOKEN=your_secret_here node server.js
```

## Deploying

This runs on any server with Node.js installed (no npm install needed):

- **Railway / Render / Fly.io** – push the folder, set `PORT` env var
- **VPS** – clone, run `node server.js`, use nginx as reverse proxy
- **Local** – just `node server.js`

## Files

| File | Purpose |
|---|---|
| `index.html` | The landing page |
| `server.js` | HTTP server + JSON email storage |
| `package.json` | Project metadata |
| `emails.json` | Subscriber database (auto-created) |
