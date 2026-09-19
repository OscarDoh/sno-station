import {
	closeSync,
	constants as fsc,
	fstatSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Canonical create-and-open recipe for `~/.config/sno-station-core/key` (and any other
 * mode-0o600 secret-state file). Implements design D7: `O_CREAT | O_EXCL |
 * O_WRONLY | O_NOFOLLOW`, write via fd, `fsync(fd)`, `fstat(fd)` verify mode
 * is exactly `0o600` (delete + throw on mismatch), `close(fd)`.
 *
 * `chmod`-after-open is forbidden because it leaves a window where the file
 * is world-readable on a hostile umask.
 */
export function writeNewSecretFile(path: string, data: string | Buffer): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const flags = fsc.O_CREAT | fsc.O_EXCL | fsc.O_WRONLY | fsc.O_NOFOLLOW;
	const fd = openSync(path, flags, 0o600);
	let needsUnlinkOnError = true;
	try {
		const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
		// Short-write defense: writeSync may write fewer bytes than requested
		// (POSIX behavior). Loop until the full buffer is durably written; throw
		// on zero progress so partial state is never advertised as durable.
		let written = 0;
		while (written < buf.length) {
			const n = writeSync(fd, buf, written, buf.length - written, written);
			if (n <= 0) {
				throw new Error(
					`writeSync returned ${n} for ${path} after ${written}/${buf.length} bytes`,
				);
			}
			written += n;
		}
		fsyncSync(fd);
		const st = fstatSync(fd);
		if ((st.mode & 0o777) !== 0o600) {
			throw new Error(
				`secret file ${path} created with mode ${(st.mode & 0o777).toString(8)}, expected 0600`,
			);
		}
		needsUnlinkOnError = false;
	} finally {
		try {
			closeSync(fd);
		} catch {
			// ignore double-close
		}
		if (needsUnlinkOnError) {
			try {
				unlinkSync(path);
			} catch {
				// ignore — the file may already be gone
			}
		}
	}
}

/**
 * Atomically replace `path` with `data`. Uses the canonical recipe on a
 * temp file in the same directory, then `rename` over the target, then
 * `fsync` the parent directory.
 */
export async function atomicReplaceSecretFile(
	path: string,
	data: string | Buffer,
): Promise<void> {
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
	writeNewSecretFile(tmp, data);
	try {
		await rename(tmp, path);
	} catch (err) {
		// best-effort cleanup of the temp file
		try {
			await unlink(tmp);
		} catch {
			// ignore
		}
		throw err;
	}
	// fsync the parent dir so the rename is durable
	const dirHandle = await open(dir, "r");
	try {
		await dirHandle.sync();
	} finally {
		await dirHandle.close();
	}
}

/** Synchronous variant of {@link readSecretFile} for use in sync entry points. */
export function readSecretFileSync(path: string): Buffer {
	const fd = openSync(path, fsc.O_RDONLY | fsc.O_NOFOLLOW);
	try {
		const st = fstatSync(fd);
		const buf = Buffer.alloc(st.size);
		let read = 0;
		while (read < buf.length) {
			const n = readSync(fd, buf, read, buf.length - read, read);
			if (n <= 0) break;
			read += n;
		}
		return buf.subarray(0, read);
	} finally {
		try {
			closeSync(fd);
		} catch {
			// ignore
		}
	}
}

/**
 * Read a secret file with `O_NOFOLLOW`. A pre-placed symlink at `path` makes
 * the open call fail rather than redirecting through the symlink target.
 */
export async function readSecretFile(path: string): Promise<Buffer> {
	const handle = await open(path, fsc.O_RDONLY | fsc.O_NOFOLLOW);
	try {
		const st = await handle.stat();
		const buf = Buffer.alloc(st.size);
		let read = 0;
		while (read < buf.length) {
			const { bytesRead } = await handle.read(
				buf,
				read,
				buf.length - read,
				read,
			);
			if (bytesRead <= 0) break;
			read += bytesRead;
		}
		return buf.subarray(0, read);
	} finally {
		await handle.close();
	}
}
