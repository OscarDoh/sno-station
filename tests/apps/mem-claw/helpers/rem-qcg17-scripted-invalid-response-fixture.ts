import { createHash } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

const invalidBody = "{qcg17-scripted-invalid-response";

export interface Qcg17ScriptedInvalidResponseFixture {
	close(): Promise<void>;
	observation(): {
		forwardedCalls: number;
		injectedCalls: number;
		requestBodySha256: string[];
		requestPaths: string[];
	};
	url: string;
}

/**
 * Scripts an invalid model response for a prompt carrying `invalidPromptMarker`, then forwards
 * everything else byte-for-byte to the real upstream route.
 *
 * `maxInjectedCalls` decides what a RETRY of the marked prompt gets, and the two callers need
 * opposite answers, so it is a parameter rather than a constant. The client retries an invalid
 * response, and a retry is the same call again, not another request:
 *
 * - Default 1: the retry reaches the live model. A caller proving "one bad answer degrades the write
 *   and the wave still completes" needs that second attempt to succeed.
 * - Higher: every attempt is scripted. A caller whose route has no upstream that can answer it needs
 *   this — measured 2026-08-12, the verdict route takes a raw-completions body and ccproxy has no
 *   completions endpoint at all (404), so a forwarded retry there died on a converted-request 400 and
 *   killed the whole wave, in a test whose subject was what happens after ONE invalid response.
 */
export async function startQcg17ScriptedInvalidResponseFixture(input: {
	invalidPromptMarker: string;
	upstreamUrl: string;
	maxInjectedCalls?: number;
}): Promise<Qcg17ScriptedInvalidResponseFixture> {
	const maxInjectedCalls = input.maxInjectedCalls ?? 1;
	let forwardedCalls = 0;
	let injectedCalls = 0;
	const requestBodySha256: string[] = [];
	const requestPaths: string[] = [];
	const server = createServer(async (request, response) => {
		try {
			if (request.method !== "POST") {
				response.writeHead(405).end();
				return;
			}
			const body = await readBody(request);
			requestBodySha256.push(createHash("sha256").update(body).digest("hex"));
			requestPaths.push(request.url ?? "");
			if (body.includes(input.invalidPromptMarker) && injectedCalls < maxInjectedCalls) {
				injectedCalls += 1;
				response.writeHead(200, { "Content-Type": "application/json" });
				response.end(JSON.stringify(scriptedResponse(request.url ?? "")));
				return;
			}

			forwardedCalls += 1;
			const upstream = await fetch(input.upstreamUrl, {
				method: "POST",
				headers: forwardedHeaders(request.headers),
				body,
				signal: AbortSignal.timeout(60_000),
			});
			response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
			response.end(Buffer.from(await upstream.arrayBuffer()));
		} catch (error) {
			response.writeHead(502, { "Content-Type": "application/json" });
			response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
		}
	});

	await listen(server);
	const address = server.address();
	if (address === null || typeof address === "string") {
		await close(server);
		throw new Error("QCG-17 fixture did not bind a TCP port");
	}
	return {
		url: `http://127.0.0.1:${address.port}/v1/chat/completions`,
		observation: () => ({
			forwardedCalls,
			injectedCalls,
			requestBodySha256: [...requestBodySha256],
			requestPaths: [...requestPaths],
		}),
		close: async () => close(server),
	};
}

/**
 * Answers in the shape the route's caller reads. Two routes reach this fixture: `/chat/completions`
 * is read as `choices[0].message.content`, and the verdict route `/completions` as
 * `choices[0].text`. One chat-shaped reply satisfied only the first — the verdict caller reported
 * `B-profile extraction response is missing choices[0].text`, which looks like a broken model and is
 * a broken fixture.
 *
 * Keyed on the path, not on the request body: both callers send `prompt`, so a body-shape test
 * answers the wrong question and gets the chat route wrong instead.
 */
function scriptedResponse(path: string): Record<string, unknown> {
	const rawCompletion = !path.endsWith("/chat/completions");
	return {
		id: "qcg17-scripted-invalid-only",
		object: rawCompletion ? "text_completion" : "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: "qcg17-scripted-invalid-only",
		choices: [
			rawCompletion
				? { index: 0, text: invalidBody, finish_reason: "stop" }
				: {
					index: 0,
					message: { role: "assistant", content: invalidBody },
					finish_reason: "stop",
				},
		],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	};
}

function forwardedHeaders(headers: IncomingHttpHeaders): Headers {
	const forwarded = new Headers();
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined || ["content-length", "host"].includes(name.toLowerCase())) continue;
		forwarded.set(name, Array.isArray(value) ? value.join(", ") : value);
	}
	return forwarded;
}

async function readBody(request: NodeJS.ReadableStream): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
	}
	return Buffer.concat(chunks).toString("utf8");
}

async function listen(server: Server): Promise<void> {
	server.listen(0, "127.0.0.1");
	await new Promise<void>((resolvePromise, reject) => {
		server.once("listening", resolvePromise);
		server.once("error", reject);
	});
}

async function close(server: Server): Promise<void> {
	if (!server.listening) return;
	await new Promise<void>((resolvePromise, reject) => {
		server.close((error) => (error ? reject(error) : resolvePromise()));
	});
}
