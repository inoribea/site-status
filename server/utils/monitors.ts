import dayjs from "dayjs";
import { setSiteDataCache } from "./status-cache";
import { formatSiteData } from "~/utils/format";

type RuntimeConfig = ReturnType<typeof useRuntimeConfig>;

const normalizeApiUrl = (url: string): string =>
  url.endsWith("/") ? url : `${url}/`;

const getApiUrls = (config: RuntimeConfig): string[] => {
  const values = [
    config.apiUrl,
    ...String(config.apiUrls || "")
      .split(",")
      .map((url) => url.trim()),
  ];
  return Array.from(new Set(values.filter(Boolean).map(normalizeApiUrl)));
};

const getRanges = ():
  | {
      dates: dayjs.Dayjs[];
      start: number;
      end: number;
      ranges: string;
    }
  | undefined => {
  try {
    const dates = [];
    const config = useRuntimeConfig();
    const days = config.public.countDays;
    const today = dayjs(new Date().setHours(0, 0, 0, 0));
    for (let d = 0; d < days; d++) dates.push(today.subtract(d, "day"));
    const ranges = dates.map(
      (date) => `${date.unix()}_${date.add(1, "day").unix()}`,
    );
    const start = dates[dates.length - 1].unix();
    const end = dates[0].add(1, "day").unix();
    ranges.push(`${start}_${end}`);
    return { dates, start, end, ranges: ranges.join("-") };
  } catch (error) {
    console.error(error);
    return undefined;
  }
};

const fetchMonitors = async (
  apiUrls: string[],
  body: Record<string, string | number>,
): Promise<unknown> => {
  let lastError: unknown;
  const attempts = apiUrls.length === 1 ? [apiUrls[0], apiUrls[0]] : apiUrls;
  for (const apiUrl of attempts) {
    try {
      return await $fetch(`${apiUrl}getMonitors`, {
        method: "POST",
        body,
        timeout: 8000,
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Upstream request failed");
};

export const refreshSiteData = async () => {
  const config = useRuntimeConfig();
  const { apiKey } = config;
  const apiUrls = getApiUrls(config);
  if (!apiUrls.length || !apiKey) {
    throw new Error("Missing API url or API key");
  }
  const rangesData = getRanges();
  if (!rangesData) throw new Error("Missing");
  const { dates, ranges, start, end } = rangesData;
  const body = {
    api_key: apiKey,
    format: "json",
    logs: 1,
    log_types: "1-2",
    logs_start_date: start,
    logs_end_date: end,
    custom_uptime_ranges: ranges,
  };
  const result = await fetchMonitors(apiUrls, body);
  const data = formatSiteData(result, dates);
  await setSiteDataCache(data);
  return data;
};
