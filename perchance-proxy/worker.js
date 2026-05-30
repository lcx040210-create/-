export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/generate" && request.method === "POST") {
      return new Response(JSON.stringify({ success: false, images: [], error: "Not implemented" }), {
        status: 501,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    if (url.pathname === "/" && request.method === "GET") {
      return new Response("<!DOCTYPE html><html><body><h1>Perchance Proxy</h1></body></html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
