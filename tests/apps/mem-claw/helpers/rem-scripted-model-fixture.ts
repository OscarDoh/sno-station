import { createServer, type Server } from "node:http";

export interface RemScriptedModelFixture {
	close(): Promise<void>;
	requestCount(): number;
	url: string;
}

export async function startRemScriptedModelFixture(
	replies:
		| readonly string[]
		| { chatReplies: readonly string[]; completionReplies: readonly string[] },
): Promise<RemScriptedModelFixture> {
	let requestCount = 0;
	let chatRequestCount = 0;
	let completionRequestCount = 0;
	const server = createServer(async (request, response) => {
		if (request.method !== "POST") {
			response.writeHead(405).end();
			return;
		}
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
		const completionRequest = "prompt" in body;
		const content = Array.isArray(replies)
			? replies[requestCount]
			: completionRequest
				? replies.completionReplies[completionRequestCount++]
				: replies.chatReplies[chatRequestCount++];
		requestCount += 1;
		if (content === undefined) {
			response.writeHead(500, { "Content-Type": "application/json" });
			response.end(JSON.stringify({ error: "scripted model reply exhausted" }));
			return;
		}
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(
			JSON.stringify(completionRequest ? {
				id: `rem-scripted-${requestCount}`,
				object: "text_completion",
				created: 0,
				model: "rem-scripted-model",
				choices: [{ index: 0, text: content, finish_reason: "stop" }],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			} : {
				id: `rem-scripted-${requestCount}`,
				object: "chat.completion",
				created: 0,
				model: "rem-scripted-model",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content },
						finish_reason: "stop",
					},
				],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			}),
		);
	});
	await listen(server);
	const address = server.address();
	if (address === null || typeof address === "string") {
		await close(server);
		throw new Error("scripted REM model did not bind a TCP port");
	}
	return {
		url: `http://127.0.0.1:${address.port}/v1/chat/completions`,
		requestCount: () => requestCount,
		close: async () => close(server),
	};
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
