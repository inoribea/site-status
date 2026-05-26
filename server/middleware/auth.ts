export default defineEventHandler((event) => {
  const referer = event.node.req.headers.referer;
  const path = getRequestURL(event).pathname;
  const isRefreshEndpoint = path === "/api/refresh" || path === "/api/refreshMonitors";
  // 无来源直接拒绝
  if (!referer && path.startsWith("/api") && !isRefreshEndpoint) {
    event.node.res.statusCode = 403;
    event.node.res.end("Access Denied");
    return;
  }
});
