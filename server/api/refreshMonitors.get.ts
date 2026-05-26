import { refreshSiteData } from "../utils/monitors";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const cronSecret = process.env.CRON_SECRET || "";
  const authHeader = getHeader(event, "authorization") || "";
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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
