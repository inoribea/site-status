const DEFAULT_UPTIMEROBOT_API = "https://api.uptimerobot.com/v2/getMonitors";
const CACHE_KEY = "site-data:stale";
const UPTIME_ROBOT_TIMEOUT_S = 15;
const KV_TIMEOUT_S = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const toBool = (value, fallback = true) => {
  if (value === undefined || value === "") return fallback;
  return value === "true";
};

const formatNumber = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n * 100) / 100;
};

/** Fetch with an AbortController timeout. */
const fetchWithTimeout = async (url, options, timeoutSec) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const getApiUrls = (env) => {
  const urls = (env.API_URLS || "").split(",").map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) urls.push(DEFAULT_UPTIMEROBOT_API);
  return urls;
};

// ---------------------------------------------------------------------------
// UptimeRobot data helpers (mirrors Nuxt formatSiteData)
// ---------------------------------------------------------------------------

const getRanges = (countDays) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dates = [];
  for (let i = 0; i < countDays; i++) {
    const d = new Date(today.getTime());
    d.setDate(today.getDate() - i);
    dates.push(d);
  }
  const unix = (d) => Math.floor(d.getTime() / 1000);
  const addDay = (d) => new Date(d.getTime() + 86400000);
  const ranges = dates.map((d) => `${unix(d)}_${unix(addDay(d))}`);
  const start = unix(dates[dates.length - 1]);
  const end = unix(addDay(dates[0]));
  ranges.push(`${start}_${end}`);
  return { dates, start, end, ranges: ranges.join("-") };
};

const formatSiteData = (raw, dates, showLink) => {
  const monitors = Array.isArray(raw?.monitors) ? raw.monitors : [];
  const sites = monitors.map((site) => {
    const ranges = String(site.custom_uptime_ranges || "").split("-");
    const percent = formatNumber(ranges.pop() || 0);
    const dailyData = [];
    const timeMap = new Map();
    dates.forEach((date, idx) => {
      const key = date.toISOString().slice(0, 10).replaceAll("-", "");
      timeMap.set(key, idx);
      dailyData[idx] = {
        date: Math.floor(date.getTime() / 1000),
        percent: formatNumber(ranges[idx] || 0),
        down: { times: 0, duration: 0 },
      };
    });
    const total = { times: 0, duration: 0 };
    (Array.isArray(site.logs) ? site.logs : []).forEach((log) => {
      if (log?.type !== 1 && log?.type !== 99) return;
      const key = new Date(log.datetime * 1000).toISOString().slice(0, 10).replaceAll("-", "");
      const idx = timeMap.get(key);
      const dur = Number(log.duration) || 0;
      if (idx !== undefined && dailyData[idx]) {
        dailyData[idx].down.times += 1;
        dailyData[idx].down.duration += dur;
      }
      total.times += 1;
      total.duration += dur;
    });
    return {
      id: site.id,
      name: site.friendly_name || "未命名站点",
      url: showLink ? site.url : undefined,
      status: site.status ?? 8,
      type: site.type ?? 1,
      interval: site.interval ?? 0,
      percent,
      days: dailyData.reverse(),
      down: total,
    };
  });
  return {
    status: sites.reduce(
      (acc, s) => {
        if (s.status === 2) acc.ok += 1;
        else if (s.status === 8 || s.status === 9) acc.error += 1;
        else if (s.status === 0 || s.status === 1) acc.unknown += 1;
        return acc;
      },
      { count: sites.length, ok: 0, error: 0, unknown: 0 },
    ),
    data: sites,
    timestamp: Date.now(),
  };
};

// ---------------------------------------------------------------------------
// Core refresh logic
// ---------------------------------------------------------------------------

const refresh = async (env, debug = false) => {
  const steps = [];
  const step = (name, fn) => {
    const t0 = Date.now();
    const promise = fn();
    promise.then(
      () => { if (debug) steps.push({ step: name, ms: Date.now() - t0 }); },
      (err) => { if (debug) steps.push({ step: name, ms: Date.now() - t0, error: err.message }); },
    );
    return promise;
  };

  // Validate env
  if (!env.API_KEY) throw new Error("Missing API_KEY env var");
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN) {
    throw new Error("Missing KV_REST_API_URL or KV_REST_API_TOKEN env var");
  }

  const countDays = Math.max(1, Number.parseInt(env.COUNT_DAYS || "60", 10));
  const showLink = toBool(env.SHOW_LINK, true);
  const { dates, start, end, ranges } = getRanges(countDays);
  const apiUrls = getApiUrls(env);

  // Step 1: Fetch from UptimeRobot (with retry across API_URLS)
  const raw = await step("uptimerobot_fetch", async () => {
    let lastErr;
    for (const apiUrl of apiUrls) {
      try {
        const body = new URLSearchParams({
          api_key: env.API_KEY,
          format: "json",
          logs: "1",
          log_types: "1-2",
          logs_start_date: String(start),
          logs_end_date: String(end),
          custom_uptime_ranges: ranges,
        });
        const res = await fetchWithTimeout(
          apiUrl,
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body,
          },
          UPTIME_ROBOT_TIMEOUT_S,
        );
        const json = await res.json();
        if (!res.ok || json.stat !== "ok") {
          throw new Error(json?.error?.message || `status ${res.status}`);
        }
        return json;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(
      `All ${apiUrls.length} upstream URL(s) failed. Last error: ${lastErr?.message || "unknown"}`,
    );
  });

  // Step 2: Format data
  const data = await step("format_data", async () => formatSiteData(raw, dates, showLink));

  // Step 3: Write to KV
  await step("kv_write", async () => {
    const kvUrl = `${env.KV_REST_API_URL}/set/${encodeURIComponent(CACHE_KEY)}`;
    const res = await fetchWithTimeout(
      kvUrl,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.KV_REST_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      KV_TIMEOUT_S,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`KV responded ${res.status}: ${text}`);
    }
  });

  if (debug) {
    const total = steps.reduce((sum, s) => sum + (s.ms || 0), 0);
    steps.push({ step: "total", ms: total });
  }

  return { data, steps };
};

// ---------------------------------------------------------------------------
// Worker entry points
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    if (env.REFRESH_SECRET) {
      const auth = request.headers.get("authorization") || "";
      if (auth !== `Bearer ${env.REFRESH_SECRET}`) {
        return json({ code: 401, message: "Unauthorized" }, 401);
      }
    }

    const url = new URL(request.url);
    const debug = url.searchParams.get("debug") === "1";

    try {
      const { data, steps } = await refresh(env, debug);
      const payload = { code: 200, message: "success" };
      if (debug) {
        payload.debug = { steps };
        // Don't send the full data in debug mode (too large), just a summary
        payload.summary = {
          sites: data.data.length,
          ok: data.status.ok,
          error: data.status.error,
          unknown: data.status.unknown,
          timestamp: data.timestamp,
        };
      }
      return json(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return json({ code: 500, message: msg }, 500);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      refresh(env).catch((err) => {
        console.error("Scheduled refresh failed:", err?.message || err);
      }),
    );
  },
};
