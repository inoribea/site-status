export default defineEventHandler((event) => {
  const referer = event.node.req.headers.referer;
  const path = getRequestURL(event).pathname;
  // 无来源直接拒绝
  if (!referer && path.startsWith("/api") && path !== "/api/refreshMonitors") {
    event.node.res.statusCode = 403;
    event.node.res.end("Access Denied");
    return;
  }
});
