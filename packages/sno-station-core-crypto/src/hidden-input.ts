import { StringDecoder } from "node:string_decoder";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
type Signal = (typeof SIGNALS)[number];

export async function readHiddenLineFromTty(prompt: string): Promise<string> {
	const input = process.stdin;
	if (!input.isTTY || typeof input.setRawMode !== "function") {
		throw new Error("hidden prompt requires an interactive terminal");
	}
	process.stderr.write(prompt);
	const wasRaw = input.isRaw;
	const wasPaused = input.isPaused();
	input.setRawMode(true);
	input.resume();

	return await new Promise<string>((resolve, reject) => {
		const decoder = new StringDecoder("utf8");
		let line = "";
		let settled = false;
		const signalHandlers = new Map<Signal, () => void>();

		const cleanup = (): void => {
			if (settled) return;
			settled = true;
			input.off("data", onData);
			for (const [sig, handler] of signalHandlers) {
				process.off(sig, handler);
			}
			signalHandlers.clear();
			input.setRawMode(wasRaw);
			if (wasPaused) input.pause();
			process.stderr.write("\n");
		};

		const finish = (): void => {
			cleanup();
			resolve(line);
		};

		const fail = (message: string): void => {
			cleanup();
			reject(new Error(message));
		};

		const onData = (chunk: Buffer): void => {
			const text = decoder.write(chunk);
			for (const ch of text) {
				if (ch === "\r" || ch === "\n") {
					finish();
					return;
				}
				if (ch === "\u0003") {
					fail("input cancelled");
					return;
				}
				if (ch === "\u0004" && line.length === 0) {
					fail("input closed");
					return;
				}
				if (ch === "\b" || ch === "\u007f") {
					line = line.slice(0, -1);
					continue;
				}
				if (ch === "\u0015") {
					line = "";
					continue;
				}
				line += ch;
			}
		};

		input.on("data", onData);
		// Out-of-band signals must restore the terminal before propagating;
		// otherwise the parent shell is left in raw mode with echo off. After
		// cleanup we re-raise the signal so the process terminates with the
		// conventional signal-exit code instead of being silently absorbed by
		// a caller's try/catch on the rejected promise.
		for (const sig of SIGNALS) {
			const handler = (): void => {
				fail(`input interrupted by ${sig}`);
				process.kill(process.pid, sig);
			};
			signalHandlers.set(sig, handler);
			process.once(sig, handler);
		}
	});
}
