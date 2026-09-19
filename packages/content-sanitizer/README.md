# @snoai/content-sanitizer

Deterministic, storage-safe content sanitization for local agent content pipelines.

The package projects text, HTML/email, rich text, structured JSON, transcripts, and
JSONL replay inputs into extraction-ready text while redacting secrets and private
blocks. It delegates splitting to `@snoai/chunking`; it does not implement its own
chunker and does not require any hosted runtime service.

## Public APIs

- `sanitizeContentIngress(input)`
- `sanitizeAndChunkContent(input, options?)`
- `redactForStorage(text)`
- `sanitizePlainText(text, options?)`
- `projectHtml(html, options?)`
- `projectRichText(value, options?)`
- `sanitizeTranscript(value, options?)`
- `parseReplayJsonl(text, options?)`
- `validateExtractedContentForStorage(value, options?)`

Only `mode: "storage-safe"` is supported. Preview-preserving behavior belongs in a
caller-owned adapter, not this package.
