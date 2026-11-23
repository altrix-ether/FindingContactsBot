export async function lookupWithProgress(url, onEvent) {
  const res = await fetch("/api/lookup/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!res.ok && res.headers.get("content-type")?.includes("application/json")) {
    const data = await res.json();
    const err = new Error(data.error || "Lookup failed");
    err.status = data.status ?? res.status;
    err.rateLimit = data.rateLimit ?? null;
    throw err;
  }

  if (!res.body) {
    throw new Error("Streaming not supported");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const payload = JSON.parse(line.slice(6));
      onEvent(payload);
      if (payload.event === "error") {
        const err = new Error(payload.error || "Lookup failed");
        err.status = payload.status;
        err.rateLimit = payload.rateLimit ?? null;
        throw err;
      }
    }
  }
}