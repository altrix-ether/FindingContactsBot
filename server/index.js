import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { runLookups } from "./lookup.js";
import { fetchGithubQuota, parseGithubUrlList, rateLimitErrorMessage } from "./github.js";
import { createSseResponder, noopProgress } from "./progress.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT ?? 3001;
const token = process.env.GITHUB_TOKEN;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, githubTokenConfigured: Boolean(process.env.GITHUB_TOKEN) });
});

app.get("/api/quota", async (_req, res) => {
  try {
    const quota = await fetchGithubQuota(process.env.GITHUB_TOKEN);
    res.status(quota.error ? (quota.status ?? 502) : 200).json(quota);
  } catch (err) {
    res.status(502).json({ error: err.message ?? "Could not read GitHub rate limit" });
  }
});

async function blockedByRateLimit() {
  try {
    const quota = await fetchGithubQuota(process.env.GITHUB_TOKEN);
    if (quota?.remaining !== 0) return null;
    return {
      error: rateLimitErrorMessage(quota),
      status: 403,
      rateLimit: quota,
    };
  } catch {
    return null;
  }
}

function readUrlInput(body) {
  if (Array.isArray(body?.urls) && body.urls.length) {
    return body.urls;
  }
  if (typeof body?.url === "string" && body.url.trim()) {
    return body.url;
  }
  return null;
}

async function handleLookup(input, res, stream = false) {
  const { parsed, parseErrors } = parseGithubUrlList(input);

  if (!parsed.length) {
    const msg =
      parseErrors[0]?.error ?? "No valid GitHub URLs. Use one repo per line (owner/repo).";
    if (stream) {
      return { error: msg, status: 400 };
    }
    res.status(400).json({ error: msg, parseErrors });
    return null;
  }

  const { result } = await runLookups(parsed, token, stream ? res.emit : noopProgress);

  if (result.error) {
    const payload = {
      error: result.error,
      status: result.status ?? 502,
      rateLimit: result.rateLimit ?? null,
      parseErrors,
    };
    if (stream) return payload;
    res.status(payload.status).json(payload);
    return null;
  }

  const payload = {
    ...result,
    parseErrors: parseErrors.length ? parseErrors : null,
    parsedUrls: parsed.map((p) => (p.repo ? `${p.owner}/${p.repo}` : p.owner)),
  };

  if (stream) return { result: payload };
  res.json(payload);
  return null;
}

app.post("/api/lookup", async (req, res) => {
  const input = readUrlInput(req.body);
  if (!input) {
    return res.status(400).json({ error: "Missing url or urls in request body" });
  }
  const blocked = await blockedByRateLimit();
  if (blocked) {
    return res.status(blocked.status).json(blocked);
  }
  await handleLookup(input, res, false);
});

app.post("/api/lookup/stream", async (req, res) => {
  const input = readUrlInput(req.body);
  if (!input) {
    return res.status(400).json({ error: "Missing url or urls in request body" });
  }

  const { parsed, parseErrors } = parseGithubUrlList(input);
  if (!parsed.length) {
    return res.status(400).json({
      error: parseErrors[0]?.error ?? "No valid GitHub URLs",
      parseErrors,
    });
  }

  const blocked = await blockedByRateLimit();
  const emit = createSseResponder(res);
  if (blocked) {
    emit({ event: "error", ...blocked });
    res.end();
    return;
  }
  const keepAlive = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 15000);

  try {
    const { result } = await runLookups(parsed, token, emit);

    if (result.error) {
      emit({
        event: "error",
        error: result.error,
        status: result.status ?? 502,
        rateLimit: result.rateLimit ?? null,
      });
      res.end();
      return;
    }

    emit({
      event: "done",
      result: {
        ...result,
        parseErrors: parseErrors.length ? parseErrors : null,
        parsedUrls: parsed.map((p) => (p.repo ? `${p.owner}/${p.repo}` : p.owner)),
      },
    });
    res.end();
  } catch (err) {
    emit({ event: "error", error: err.message ?? "Lookup failed" });
    res.end();
  } finally {
    clearInterval(keepAlive);
  }
});

const server = app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(
    process.env.GITHUB_TOKEN
      ? "GITHUB_TOKEN loaded"
      : "GITHUB_TOKEN not set — add server/.env or lookups may hit rate limits"
  );
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Stop the other process or change PORT in server/.env.`
    );
    process.exit(1);
  }
  throw err;
});