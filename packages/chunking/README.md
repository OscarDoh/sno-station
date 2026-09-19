# @snoai/chunking

Local deterministic text chunking for memory and retrieval pipelines.

## Install

```bash
npm install @snoai/chunking
```

## Usage

```ts
import { chunk, getCjkRatio } from "@snoai/chunking";

const chunks = chunk("user: Remember the deployment checklist.", {
	contentType: "conversation",
	targetTokens: 4096,
	maxTokens: 4096,
});

console.log(chunks.map((c) => c.chunkText));
console.log(getCjkRatio("abc 中文"));
```

The package runs locally. It does not call hosted chunking APIs, fetch implementation code during
install, require private npm credentials, or use an LLM for token counting or boundaries.
