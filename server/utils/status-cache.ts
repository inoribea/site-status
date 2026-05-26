import { kv } from "@vercel/kv";
import type { MonitorsDataResult } from "~~/types/main";
import { getCache, setCache } from "~/utils/cache-server";

const freshKey = "site-data";
const staleKey = "site-data:stale";
const hasKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

export const getFreshSiteData = (): MonitorsDataResult | undefined =>
  getCache<MonitorsDataResult>(freshKey);

export const getStaleSiteData = async (): Promise<
  MonitorsDataResult | undefined
> => {
  const hotCache = getCache<MonitorsDataResult>(staleKey);
  if (hotCache) return hotCache;
  if (!hasKv) return undefined;
  try {
    const stored = await kv.get<MonitorsDataResult>(staleKey);
    if (stored) setCache(staleKey, stored);
    return stored || undefined;
  } catch (error) {
    console.error("KV read failed:", error);
    return undefined;
  }
};

export const setSiteDataCache = async (
  data: MonitorsDataResult,
): Promise<void> => {
  setCache(freshKey, data, 1000 * 60 * 2);
  setCache(staleKey, data);
  if (!hasKv) return;
  try {
    await kv.set(staleKey, data, { ex: 60 * 60 * 24 * 7 });
  } catch (error) {
    console.error("KV write failed:", error);
  }
};
