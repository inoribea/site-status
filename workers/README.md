# Cloudflare Worker refresher

Vercel Hobby only allows one cron run per day, so the status cache refresher can run on Cloudflare Workers instead.

## Deploy

1. Create a Cloudflare Worker.
2. Paste `refresh-status.js` as the Worker code.
3. Add a Cron Trigger, for example every 5 minutes.
4. Add these Worker environment variables:

```env
API_KEY=your-uptimerobot-read-only-api-key
COUNT_DAYS=60
SHOW_LINK=true
KV_REST_API_URL=https://your-upstash-host.upstash.io
KV_REST_API_TOKEN=your-upstash-token
REFRESH_SECRET=optional-manual-refresh-secret
```

`KV_REST_API_URL` and `KV_REST_API_TOKEN` are the same Upstash/Vercel Redis REST values used by the Nuxt app.

## Manual refresh

If `REFRESH_SECRET` is empty:

```bash
curl https://your-worker.workers.dev
```

If `REFRESH_SECRET` is set:

```bash
curl -H "Authorization: Bearer $REFRESH_SECRET" https://your-worker.workers.dev
```

The Worker writes formatted monitor data to Upstash key `site-data:stale`, which the Vercel app reads without calling UptimeRobot during page requests.
