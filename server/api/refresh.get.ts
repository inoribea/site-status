import { refreshSiteData } from "../utils/monitors";

const isAuthorized = (event: Parameters<typeof getHeader>[0]): boolean => {
  const cronSecret = process.env.CRON_SECRET || "";
  if (!cronSecret) return true;
  return (getHeader(event, "authorization") || "") === `Bearer ${cronSecret}`;
};

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  if (!isAuthorized(event)) {
    setResponseStatus(event, 401);
    return { code: 401, message: "Unauthorized" };
  }
  if (!config.apiKey) {
    setResponseStatus(event, 500);
    return { code: 500, message: "Missing API key" };
  }
  const data = await refreshSiteData();
  return { code: 200, message: "success", source: "api", data };
});
