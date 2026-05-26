const UPTIMEROBOT_API = "https://api.uptimerobot.com/v2/getMonitors";
const CACHE_KEY = "site-data:stale";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
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

const getRanges = (countDays) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dates = [];
  for (let index = 0; index < countDays; index += 1) {
    const date = new Date(today.getTime());
    date.setDate(today.getDate() - index);
    dates.push(date);
  }
  const unix = (date) => Math.floor(date.getTime() / 1000);
  const addDay = (date) => new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const ranges = dates.map((date) => `${unix(date)}_${unix(addDay(date))}`);
  const start = unix(dates[dates.length - 1]);
  const end = unix(addDay(dates[0]));
  ranges.push(`${start}_${end}`);
  return { dates, start, end, ranges: ranges.join("-") };
};

const formatSiteData = (data, dates, showLink) => {
  const monitors = Array.isArray(data?.monitors) ? data.monitors : [];
  const sites = monitors.map((site) => {
    const ranges = String(site.custom_uptime_ranges || "").split("-");
    const percent = formatNumber(ranges.pop() || 0);
    const dailyData = [];
    const timeMap = new Map();
    dates.forEach((date, index) => {
      const key = date.toISOString().slice(0, 10).replaceAll("-", "");
      timeMap.set(key, index);
      dailyData[index] = {
        date: Math.floor(date.getTime() / 1000),
        percent: formatNumber(ranges[index] || 0),
        down: { times: 0, duration: 0 },
      };
    });
    const total = { times: 0, duration: 0 };
    (Array.isArray(site.logs) ? site.logs : []).forEach((log) => {
      if (log?.type !== 1 && log?.type !== 99) return;
      const key = new Date(log.datetime * 1000).toISOString().slice(0, 10).replaceAll("-", "");
      const dateIndex = timeMap.get(key);
      const duration = Number(log.duration) || 0;
      if (dateIndex !== undefined && dailyData[dateIndex]) {
        dailyData[dateIndex].down.times += 1;
        dailyData[dateIndex].down.duration += duration;
      }
      total.times += 1;
      total.duration += duration;
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
      (acc, site) => {
        if (site.status === 2) acc.ok += 1;
        else if (site.status === 8 || site.status === 9) acc.error += 1;
        else if (site.status === 0 || site.status === 1) acc.unknown += 1;
        return acc;
      },
      { count: sites.length, ok: 0, error: 0, unknown: 0 },
    ),
    data: sites,
    timestamp: Date.now(),
  };
};

const refresh = async (env) => {
  if (!env.API_KEY) throw new Error("Missing API_KEY");
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN) {
    throw new Error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");
  }
  const countDays = Math.max(1, Number.parseInt(env.COUNT_DAYS || "60", 10));
  const showLink = toBool(env.SHOW_LINK, true);
  const { dates, start, end, ranges } = getRanges(countDays);
  const body = new URLSearchParams({
    api_key: env.API_KEY,
    format: "json",
    logs: "1",
    log_types: "1-2",
    logs_start_date: String(start),
    logs_end_date: String(end),
    custom_uptime_ranges: ranges,
  });
  const response = await fetch(UPTIMEROBOT_API, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const raw = await response.json();
  if (!response.ok || raw.stat !== "ok") {
    throw new Error(raw?.error?.message || `UptimeRobot failed: ${response.status}`);
  }
  const data = formatSiteData(raw, dates, showLink);
  const kvResponse = await fetch(`${env.KV_REST_API_URL}/set/${CACHE_KEY}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.KV_REST_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!kvResponse.ok) {
    throw new Error(`KV write failed: ${kvResponse.status}`);
  }
  return data;
};

export default {
  async fetch(request, env) {
    if (env.REFRESH_SECRET) {
      const auth = request.headers.get("authorization") || "";
      if (auth !== `Bearer ${env.REFRESH_SECRET}`) return json({ code: 401, message: "Unauthorized" }, 401);
    }
    try {
      const data = await refresh(env);
      return json({ code: 200, message: "success", data });
    } catch (error) {
      return json({ code: 500, message: error instanceof Error ? error.message : "Unknown error" }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refresh(env));
  },
};
