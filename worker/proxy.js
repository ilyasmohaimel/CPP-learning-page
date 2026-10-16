const COOKIE = "cforge_session";
const MAX_BODY = 4 * 1024 * 1024;
const writes = new Set(["POST", "PUT", "PATCH", "DELETE"]);
function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
function sessionCookie(request) {
  const pair = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(COOKIE + "="));
  if (!pair || !/^[A-Za-z0-9_-]{32,128}$/.test(pair.slice(COOKIE.length + 1)))
    return "";
  return pair;
}
function cookies(response) {
  if (typeof response.headers.getSetCookie === "function")
    return response.headers.getSetCookie();
  if (typeof response.headers.getAll === "function")
    return response.headers.getAll("set-cookie");
  const value = response.headers.get("set-cookie");
  return value ? [value] : [];
}
export async function proxyAPI(request, env) {
  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith("/api/"))
    return json({ error: "Route not found." }, 404);
  if (
    !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
      request.method,
    )
  )
    return json({ error: "Method not allowed." }, 405);
  if (incoming.pathname === "/api/auth/setup")
    return json(
      {
        error: "Administrator setup is not available through the public Site.",
      },
      403,
    );
  const origin = request.headers.get("origin");
  if (
    writes.has(request.method) &&
    (request.headers.get("sec-fetch-site") === "cross-site" ||
      (origin &&
        origin !== incoming.origin &&
        origin !== env.CFORGE_SITE_ORIGIN))
  )
    return json(
      { error: "This request must come from the C Forge Site." },
      403,
    );
  let base;
  try {
    base = new URL(env.CFORGE_BACKEND_URL);
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !base.pathname.endsWith("/")
    )
      throw Error();
  } catch {
    return json(
      { error: "The C Forge backend connection is not configured." },
      503,
    );
  }
  const target = new URL(incoming.pathname.slice(1) + incoming.search, base);
  if (
    target.origin !== base.origin ||
    !target.pathname.startsWith(base.pathname + "api/")
  )
    return json({ error: "Invalid API path." }, 400);
  const headers = new Headers();
  for (const key of [
    "accept",
    "content-type",
    "if-none-match",
    "x-cforge-account-id",
  ]) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  const cookie = sessionCookie(request);
  if (cookie) headers.set("cookie", cookie);
  // Platform identity, service access tokens, and unrelated cookies stay on Sites.
  headers.set("origin", base.origin);
  if (env.CFORGE_PROXY_SECRET) {
    headers.set("x-cforge-proxy-secret", env.CFORGE_PROXY_SECRET);
    const visitorIP = request.headers.get("cf-connecting-ip");
    if (visitorIP) headers.set("x-cforge-client-ip", visitorIP);
  }
  let body;
  if (!["GET", "HEAD"].includes(request.method)) {
    const claimed = Number(request.headers.get("content-length") ?? 0);
    if (!Number.isFinite(claimed) || claimed > MAX_BODY)
      return json({ error: "Request exceeds the 4 MiB limit." }, 413);
    const reader = request.body?.getReader();
    let total = 0;
    const chunks = [];
    if (reader) {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > MAX_BODY) {
          await reader.cancel();
          return json({ error: "Request exceeds the 4 MiB limit." }, 413);
        }
        chunks.push(part.value);
      }
    }
    body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }

  let response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return json(
      {
        error:
          "The C Forge server is unavailable. Your device recovery buffer is separate; retry when its connection returns.",
      },
      503,
    );
  }
  if (
    request.method !== "HEAD" &&
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  ) {
    console.error(
      "C Forge upstream returned a non-API response",
      JSON.stringify({ host: target.host, status: response.status }),
    );
    return json(
      {
        error:
          "The C Forge gateway did not return an API response. Your device draft can be recovered; retry the account connection.",
      },
      502,
    );
  }
  const output = new Headers();
  for (const key of ["content-type", "etag", "retry-after"]) {
    const value = response.headers.get(key);
    if (value) output.set(key, value);
  }
  output.set("cache-control", "no-store");
  output.set("x-content-type-options", "nosniff");
  output.set("referrer-policy", "same-origin");
  for (const value of cookies(response)) {
    if (!value.startsWith(COOKIE + "=")) continue;
    let scoped = value
      .replace(/;\s*Path=\/forge\//i, "; Path=/")
      .replace(/;\s*Domain=[^;]+/gi, "")
      .replace(/;\s*SameSite=Lax/i, "; SameSite=None");
    if (!/;\s*Secure(?:;|$)/i.test(scoped)) scoped += "; Secure";
    if (!/;\s*HttpOnly(?:;|$)/i.test(scoped)) scoped += "; HttpOnly";
    scoped += "; Partitioned";
    output.append("set-cookie", scoped);
  }
  return new Response(response.body, {
    status: response.status,
    headers: output,
  });
}
