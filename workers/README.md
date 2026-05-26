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
API_URLS=optional-comma-separated-fallback-urls
```

`API_URLS` is optional. If set, the Worker tries each URL in order (with a 15 s timeout per URL). When empty, the default `https://api.uptimerobot.com/v2/getMonitors` is used.

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

## Debug mode

Add `?debug=1` to see per-step timing without returning the full payload:

```bash
curl "https://your-worker.workers.dev?debug=1"
```

Example response:

```json
{
  "code": 200,
  "message": "success",
  "summary": { "sites": 5, "ok": 4, "error": 1, "unknown": 0, "timestamp": 1716720000000 },
  "debug": {
    "steps": [
      { "step": "uptimerobot_fetch", "ms": 2341 },
      { "step": "format_data", "ms": 15 },
      { "step": "kv_write", "ms": 312 },
      { "step": "total", "ms": 2668 }
    ]
  }
}
```

## Timeouts

The Worker has built-in timeouts to avoid hanging:

- **UptimeRobot fetch**: 15 seconds per URL
- **KV write**: 10 seconds

These are hardcoded in the Worker and do not require environment variables.
