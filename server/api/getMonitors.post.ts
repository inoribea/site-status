import {
  getFreshSiteData,
  getStaleSiteData,
} from "../utils/status-cache";
import type { MonitorsDataResult, MonitorsResult } from "~~/types/main";

/**
 * 获取站点数据
 */
export default defineEventHandler(async (event): Promise<MonitorsResult> => {
  try {
    const config = useRuntimeConfig();
    const { sitePassword, siteSecretKey } = config;
    // 若登录-验证 token
    if (sitePassword && siteSecretKey) {
      const token = getCookie(event, "authToken");
      if (!token) throw new Error("Please log in first");
      // 验证 Token
      const isLogin = await verifyJwt(token);
      if (!isLogin) throw new Error("Invalid or expired token");
    }
    // 检查缓存
    const cachedData = getFreshSiteData();
    if (cachedData) {
      return {
        code: 200,
        message: "success",
        source: "cache",
        data: cachedData as MonitorsDataResult,
      };
    }
    throw new Error("No cached monitor data available");
  } catch (error) {
    const staleData = await getStaleSiteData();
    if (staleData) {
      return {
        code: 200,
        message: "success (stale)",
        source: "cache",
        data: staleData as MonitorsDataResult,
      };
    }
    setResponseStatus(event, 500);
    return {
      code: 500,
      message: error instanceof Error ? error.message : "Unknown error",
      source: "api",
      data: undefined,
    };
  }
});
