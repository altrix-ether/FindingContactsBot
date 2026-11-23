export function noopProgress() {}

export function createSseResponder(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  return (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
}