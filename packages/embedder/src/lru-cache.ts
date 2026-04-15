/**
 * LRU-cached embedding provider wrapper.
 *
 * Wraps any EmbeddingProvider with an LRU cache (TTL + max-size eviction).
 * Extracted from claw-storix-plugin's Embedder cache pattern,
 * upgraded to use the `lru-cache` package instead of a hand-rolled Map.
 */

import { LRUCache } from "lru-cache";
import { LRU_CACHE_MAX_DEFAULT, LRU_CACHE_TTL_MS_DEFAULT } from "./constants";
import type {
	CacheConfig,
	DisposableProvider,
	EmbeddingProvider,
} from "./types";

/** Key prefixes prevent collision between passage and query embeddings for the same text. */
const PASSAGE_PREFIX = "p:";
const QUERY_PREFIX = "q:";

export class CachedEmbeddingProvider implements DisposableProvider {
	private readonly inner: EmbeddingProvider;
	private readonly cache: LRUCache<string, number[]>;
	private readonly inflight = new Map<string, Promise<number[]>>();

	get dimension(): number {
		return this.inner.dimension;
	}

	constructor(provider: EmbeddingProvider, config?: CacheConfig) {
		this.inner = provider;
		this.cache = new LRUCache<string, number[]>({
			max: config?.maxSize ?? LRU_CACHE_MAX_DEFAULT,
			ttl: config?.ttlMs ?? LRU_CACHE_TTL_MS_DEFAULT,
		});
	}

	private async getOrLoad(
		key: string,
		load: () => Promise<number[]>,
	): Promise<number[]> {
		const cached = this.cache.get(key);
		if (cached) return [...cached];

		const pending = this.inflight.get(key);
		if (pending) {
			return [...(await pending)];
		}

		const created = (async () => {
			const result = await load();
			const cloned = [...result];
			this.cache.set(key, cloned);
			return cloned;
		})();
		this.inflight.set(key, created);

		try {
			return [...(await created)];
		} catch (error) {
			// Remove failed promise from inflight before re-throwing so concurrent
			// waiters that haven't awaited yet fall through to create their own
			// request instead of receiving a stale rejection.
			if (this.inflight.get(key) === created) {
				this.inflight.delete(key);
			}
			throw error;
		} finally {
			if (this.inflight.get(key) === created) {
				this.inflight.delete(key);
			}
		}
	}

	async embed(text: string): Promise<number[]> {
		const key = `${PASSAGE_PREFIX}${text}`;
		return this.getOrLoad(key, async () => this.inner.embed(text));
	}

	async embedQuery(text: string): Promise<number[]> {
		const key = `${QUERY_PREFIX}${text}`;
		return this.getOrLoad(key, async () => this.inner.embedQuery(text));
	}

	async embedDocuments(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];

		const results = new Array<Promise<number[]> | undefined>(texts.length);
		const batchKeys: string[] = [];
		const batchTexts: string[] = [];
		const batchIndicesByKey = new Map<string, number[]>();

		for (let i = 0; i < texts.length; i++) {
			const text = texts[i];
			if (text === undefined) continue;
			const key = `${PASSAGE_PREFIX}${text}`;
			const cached = this.cache.get(key);
			if (cached) {
				results[i] = Promise.resolve([...cached]);
				continue;
			}

			const pending = this.inflight.get(key);
			if (pending) {
				results[i] = pending.then((embedding) => [...embedding]);
				continue;
			}

			const existingBatch = batchIndicesByKey.get(key);
			if (existingBatch) {
				existingBatch.push(i);
				continue;
			}

			batchKeys.push(key);
			batchTexts.push(text);
			batchIndicesByKey.set(key, [i]);
		}

		if (batchTexts.length > 0) {
			const batchPromises = new Map<string, Promise<number[]>>();
			const freshEmbeddingsPromise = this.inner
				.embedDocuments(batchTexts)
				.then((freshEmbeddings) => {
					if (freshEmbeddings.length !== batchTexts.length) {
						throw new Error(
							`inner.embedDocuments returned ${freshEmbeddings.length} results ` +
								`for ${batchTexts.length} inputs`,
						);
					}
					return freshEmbeddings.map((embedding) => [...embedding]);
				});

			for (let j = 0; j < batchKeys.length; j++) {
				const key = batchKeys[j];
				if (key === undefined) continue;
				const indices = batchIndicesByKey.get(key);
				if (indices === undefined) continue;

				const keyPromise = freshEmbeddingsPromise.then((freshEmbeddings) => {
					const embedding = freshEmbeddings[j];
					if (embedding === undefined) {
						throw new Error(`Missing fresh embedding at batch index ${j}`);
					}
					this.cache.set(key, embedding);
					return embedding;
				});
				batchPromises.set(key, keyPromise);
				this.inflight.set(key, keyPromise);
				for (const idx of indices) {
					results[idx] = keyPromise.then((embedding) => [...embedding]);
				}
			}

			try {
				await freshEmbeddingsPromise;
			} finally {
				for (const [key, keyPromise] of batchPromises) {
					if (this.inflight.get(key) === keyPromise) {
						this.inflight.delete(key);
					}
				}
			}
		}

		return Promise.all(
			results.map((result, index) => {
				if (result === undefined) {
					throw new Error(`Missing embedding at index ${index}`);
				}
				return result;
			}),
		);
	}

	async dispose(): Promise<void> {
		this.cache.clear();
		this.inflight.clear();
		if ("dispose" in this.inner && typeof this.inner.dispose === "function") {
			await (this.inner as DisposableProvider).dispose();
		}
	}

	/** Clear the cache without disposing the inner provider */
	clear(): void {
		this.cache.clear();
		this.inflight.clear();
	}

	/** Current cache size */
	get size(): number {
		return this.cache.size;
	}
}
