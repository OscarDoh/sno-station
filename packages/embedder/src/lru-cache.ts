/**
 * LRU-cached embedding provider wrapper.
 *
 * Wraps any EmbeddingProvider with an LRU cache (TTL + max-size eviction).
 * Extracted from edge-claw-agent-plugin's Embedder cache pattern,
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

	async embed(text: string): Promise<number[]> {
		const key = `${PASSAGE_PREFIX}${text}`;
		const cached = this.cache.get(key);
		if (cached) return [...cached];

		const result = await this.inner.embed(text);
		this.cache.set(key, [...result]);
		return result;
	}

	async embedQuery(text: string): Promise<number[]> {
		const key = `${QUERY_PREFIX}${text}`;
		const cached = this.cache.get(key);
		if (cached) return [...cached];

		const result = await this.inner.embedQuery(text);
		this.cache.set(key, [...result]);
		return result;
	}

	async embedDocuments(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];

		// Split into cached hits and uncached misses
		const results = new Array<number[] | undefined>(texts.length);
		const uncachedIndices: number[] = [];

		for (let i = 0; i < texts.length; i++) {
			const text = texts[i];
			if (text === undefined) continue;
			const key = `${PASSAGE_PREFIX}${text}`;
			const cached = this.cache.get(key);
			if (cached) {
				results[i] = [...cached];
			} else {
				uncachedIndices.push(i);
			}
		}

		// Batch-embed uncached texts
		if (uncachedIndices.length > 0) {
			const uncachedTexts = uncachedIndices.map((i) => texts[i] as string);
			const freshEmbeddings = await this.inner.embedDocuments(uncachedTexts);

			if (freshEmbeddings.length !== uncachedIndices.length) {
				throw new Error(
					`inner.embedDocuments returned ${freshEmbeddings.length} results ` +
						`for ${uncachedIndices.length} inputs`,
				);
			}

			for (let j = 0; j < uncachedIndices.length; j++) {
				const idx = uncachedIndices[j];
				const embedding = freshEmbeddings[j];
				const text = texts[idx as number];
				if (idx !== undefined && embedding !== undefined) {
					results[idx] = embedding;
					if (text !== undefined) {
						this.cache.set(`${PASSAGE_PREFIX}${text}`, [...embedding]);
					}
				}
			}
		}

		// Validate all slots are filled — fail fast if inner provider misbehaved
		for (let i = 0; i < results.length; i++) {
			if (results[i] === undefined) {
				throw new Error(`Missing embedding at index ${i}`);
			}
		}
		return results as number[][];
	}

	async dispose(): Promise<void> {
		this.cache.clear();
		if ("dispose" in this.inner && typeof this.inner.dispose === "function") {
			await (this.inner as DisposableProvider).dispose();
		}
	}

	/** Clear the cache without disposing the inner provider */
	clear(): void {
		this.cache.clear();
	}

	/** Current cache size */
	get size(): number {
		return this.cache.size;
	}
}
