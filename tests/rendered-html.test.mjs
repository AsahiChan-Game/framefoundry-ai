import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
  );
}

test("server-renders the FrameFoundry AI console", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>帧造工场 · FrameFoundry AI<\/title>/i);
  assert.match(html, /把灵感锻造成每一帧/);
  assert.match(html, /本地节点/);
  assert.match(html, /安全模拟/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("declares the Chinese document language", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /<html[^>]*lang="zh-CN"/i);
});
