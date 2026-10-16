import test from "node:test";
import assert from "node:assert/strict";
import { proxyAPI } from "../worker/proxy.js";
const env = {
  CFORGE_BACKEND_URL: "https://backend.example/forge/",
  CFORGE_SITE_ORIGIN: "https://workshop.example",
  CFORGE_PROXY_SECRET: "fictional-proxy-secret-only",
  CFORGE_BOOTSTRAP_SECRET: "stale-bootstrap-must-never-be-used",
};
const original = globalThis.fetch;
test("proxy rejects cross-site writes before contacting backend", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw Error();
  };
  try {
    const r = await proxyAPI(
      new Request("https://workshop.example/api/drafts/x", {
        method: "PUT",
        headers: { origin: "https://attacker.example" },
        body: "{}",
      }),
      env,
    );
    assert.equal(r.status, 403);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});
test("public Site never authorizes owner setup, even with a trusted platform identity or stale bootstrap env", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw Error();
  };
  try {
    const r = await proxyAPI(
      new Request("https://workshop.example/api/auth/setup", {
        method: "POST",
        headers: {
          "oai-authenticated-user-id": "visitor",
          "oai-authenticated-user-email": "visitor@example.test",
        },
        body: "{}",
      }),
      env,
    );
    assert.equal(r.status, 403);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});
test("signup forwards only learner session/scope and authenticated visitor-IP metadata", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return Response.json(
      { id: "8fd1d478-af43-405d-bf6d-1d272236938f" },
      {
        headers: {
          "set-cookie":
            "cforge_session=" +
            "a".repeat(43) +
            "; Path=/forge/; HttpOnly; Secure; SameSite=Lax",
        },
      },
    );
  };
  try {
    const payload = { username: "friend", password: "fictional-password-only" };
    const r = await proxyAPI(
      new Request("https://workshop.example/api/auth/register", {
        method: "POST",
        headers: {
          origin: "https://workshop.example",
          "OAI-Sites-Authorization": "Bearer never-forward",
          "oai-authenticated-user-id": "never-forward",
          cookie:
            "platform_secret=never-forward; cforge_session=" + "b".repeat(43),
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.9",
          "x-cforge-client-ip": "spoofed",
          "x-cforge-proxy-secret": "spoofed",
          "x-cforge-account-id": "account-scope",
        },
        body: JSON.stringify(payload),
      }),
      env,
    );
    assert.equal(r.status, 200);
    assert.equal(
      captured.url,
      "https://backend.example/forge/api/auth/register",
    );
    assert.equal(
      captured.init.headers.get("cookie"),
      "cforge_session=" + "b".repeat(43),
    );
    assert.equal(captured.init.headers.get("OAI-Sites-Authorization"), null);
    assert.equal(captured.init.headers.get("oai-authenticated-user-id"), null);
    assert.equal(
      captured.init.headers.get("x-cforge-account-id"),
      "account-scope",
    );
    assert.equal(
      captured.init.headers.get("x-cforge-client-ip"),
      "203.0.113.9",
    );
    assert.equal(
      captured.init.headers.get("x-cforge-proxy-secret"),
      env.CFORGE_PROXY_SECRET,
    );
    assert.deepEqual(
      JSON.parse(new TextDecoder().decode(captured.init.body)),
      payload,
    );
    assert.match(r.headers.get("set-cookie"), /Path=\/;/);
    assert.match(r.headers.get("set-cookie"), /SameSite=None/);
    assert.match(r.headers.get("set-cookie"), /Partitioned/);
  } finally {
    globalThis.fetch = original;
  }
});
test("anonymous visitors can see registration status without platform identity or bootstrap disclosure", async () => {
  globalThis.fetch = async () =>
    Response.json({ setupRequired: false, registrationOpen: true });
  try {
    const r = await proxyAPI(
      new Request("https://workshop.example/api/auth/status"),
      env,
    );
    const body = await r.json();
    assert.deepEqual(body, { setupRequired: false, registrationOpen: true });
    assert(!JSON.stringify(body).includes(env.CFORGE_BOOTSTRAP_SECRET));
  } finally {
    globalThis.fetch = original;
  }
});
test("unavailable backend returns an honest unavailable response", async () => {
  globalThis.fetch = async () => {
    throw Error("network");
  };
  try {
    const r = await proxyAPI(
      new Request("https://workshop.example/api/health"),
      env,
    );
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /server is unavailable/);
  } finally {
    globalThis.fetch = original;
  }
});
test("an upstream gateway rejection is infrastructure feedback, not a learner failure", async () => {
  globalThis.fetch = async () =>
    new Response("error code: 1003", {
      status: 403,
      headers: { "content-type": "text/plain" },
    });
  try {
    const r = await proxyAPI(
      new Request("https://workshop.example/api/health"),
      env,
    );
    assert.equal(r.status, 502);
    assert.match(
      (await r.json()).error,
      /gateway did not return an API response/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
