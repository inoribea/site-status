export default defineEventHandler((event) => {
  const referer = event.node.req.headers.referer;
  const url = event.node.req.url;
  // 无来源直接拒绝
  if (!referer && url?.startsWith("/api") && !url.startsWith("/api/refreshMonitors")) {
    event.node.res.statusCode = 403;
    event.node.res.end("Access Denied");
    return;
  }
});
