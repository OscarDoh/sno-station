import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { z } from "zod";
import { HOST_MODEL_ID, MODEL_CALLBACK } from "../constants";
import { createOpenClawAgentLlmBinding } from "./openclaw-agent-llm-binding";

const requestSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["system", "user"]), content: z.string() })),
  max_tokens: z.number().int().positive().optional(),
  chat_template_kwargs: z.object({ enable_thinking: z.boolean() }).optional(),
});
export interface ModelCallback {
  registration: { baseUrl: string; credential: string; model: string };
  close(): Promise<void>;
}

export async function startModelCallback(api: OpenClawPluginApi): Promise<ModelCallback> {
  const credential = randomBytes(32).toString("hex");
  const expected = Buffer.from(`Bearer ${credential}`);
  const port = createOpenClawAgentLlmBinding({ complete: params => api.runtime.llm.complete(params) });
  const active = new Set<AbortController>();
  async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const auth = Buffer.from(request.headers.authorization ?? "");
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) { response.writeHead(401).end(); return; }
    if (request.method !== "POST" || request.url !== MODEL_CALLBACK.path) { response.writeHead(404).end(); return; }
    const abort = new AbortController(); active.add(abort);
    const disconnected = () => { if (!response.writableEnded) abort.abort(); };
    response.once("close", disconnected);
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > MODEL_CALLBACK.maxBodyBytes) { response.writeHead(413).end(); return; }
        chunks.push(bytes);
      }
      const input = requestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (!input.success) { response.writeHead(400).end(); return; }
      const result = await port.complete({
        system: input.data.messages.filter(message => message.role === "system").map(message => message.content).join("\n"),
        prompt: input.data.messages.filter(message => message.role === "user").map(message => message.content).join("\n"),
        maxTokens: input.data.max_tokens, enableThinking: input.data.chat_template_kwargs?.enable_thinking,
        timeoutMs: MODEL_CALLBACK.timeoutMs, signal: abort.signal,
      });
      if (result.kind !== "ok") {
        // The sidecar rebuilds the typed failure from this body; the status alone loses the category.
        response.writeHead(result.kind === "cancelled" ? 504 : 503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: result }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: result.text } }] }));
    } catch { if (!response.headersSent) response.writeHead(400); response.end(); }
    finally { active.delete(abort); response.off("close", disconnected); }
  }
  const server = createServer((request, response) => { void serve(request, response); });
  server.requestTimeout = MODEL_CALLBACK.timeoutMs;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, MODEL_CALLBACK.host, resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("model callback has no TCP address");
  server.unref();
  return {
    registration: { baseUrl: `http://${MODEL_CALLBACK.host}:${address.port}/v1`, credential, model: HOST_MODEL_ID },
    async close(): Promise<void> {
      for (const controller of active) controller.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
