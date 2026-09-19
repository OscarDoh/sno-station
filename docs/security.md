# Security & Privacy - How SNO Station Core Protects Your Data

> **The promise**: your local memory store is encrypted on your machine with a key that is explicitly provisioned and kept on your machine. Sno does not receive your database or your Data Encryption Key (DEK).
>
> When you ask an AI model to answer with memory context, share memory, or use an explicit team feature, SNO Station Core may send only the selected data needed for that action. Outside those user-directed flows, actual memory content is not uploaded to a cloud service. Sno is not in the LLM provider path.

This document explains what we do, why the design is strong, and where the security boundary ends.

---

## Abstract

- **Local memory is the source of truth, and it is encrypted by default.** SNO Station Core memory databases are encrypted at rest from first use; outside explicit user actions such as model requests, sharing, or team collaboration, actual memory content stays on the local machine.
- **The key is local and deliberate.** A senior operator provisions the 256-bit DEK once with `sno-station-core lock --provision-key`; ordinary runtime code never generates a replacement.
- **Recovery is local and operator-controlled.** A separate durable mode-`0600` copy can restore a missing primary only through `sno-station-core lock --restore-key <operator-recovery-key-file>`; Sno never receives the copy.
- **The database format is standard, not proprietary obfuscation.** SQLite pages are encrypted through `better-sqlite3-multiple-ciphers` / SQLite3MultipleCiphers in SQLCipher v4-compatible mode, while AES, GCM, Argon2id, and SQLite bring standards-backed component assurance.
- **Our own crypto layer is deliberately small.** `@snoai/sno-station-core-crypto` is a thin first-party package over vetted libraries: SQLite3MultipleCiphers, `@napi-rs/keyring`, `argon2`, and Node's built-in `crypto`.
- **Passphrase mode is available for stronger local protection.** Opt-in passphrase wrapping uses Argon2id plus AES-256-GCM. There is no Sno escrow and no recovery backdoor.
- **Metadata is scoped to the user's action.** Operational metadata is minimized and segmented by purpose, for example model routing, sharing, team access, or troubleshooting. It is not a shadow copy of memory content.
- **We are precise about limits.** SNO Station Core protects local files and backups; it does not protect an unlocked compromised machine, malware running as your OS user, root-level memory scraping, OS swap, or data you intentionally send to your chosen LLM provider, share target, or team workspace.

---

## What Gets Encrypted

| Data | On disk | Encrypted? |
|---|---|---|
| Memory entries: text, embeddings, metadata | Local SQLite database files | **Yes** - page-level AES-256 encryption. |
| Vector store and embedding cache | Inside the same SQLite databases | **Yes** - encrypted automatically with the database pages. |
| User-created exports | `.sno-station-core` export files | **Yes** - AES-256-GCM using the same local DEK. |
| Application logs | Local log files | **No** - production logs must not contain memory content; they are limited to operational metadata such as token counts, latencies, model names, and error classes. |
| OS swap, hibernation files, crash dumps | OS-managed | **No** - outside SNO Station Core control. Full-disk encryption remains recommended. |

FileVault, BitLocker, or LUKS gives you a second layer below SNO Station Core. SNO Station Core does not require full-disk encryption, but you should enable it.

---

## Local Source Of Truth

SNO Station Core treats local memory as the authoritative store. The encrypted database on the user's machine is the single source of truth for actual memory content unless the user deliberately performs an action that needs data to leave the machine.

Those explicit actions include:

- asking a configured AI model to answer with selected memory context;
- exporting or sharing selected memory;
- enabling a team or collaboration workflow that requires selected memory to be available to other users.

In those cases, SNO Station Core should send the minimum content needed for the requested action and keep the scope visible to the user. Outside those flows, memory content is not mirrored to Sno, synced to a hidden cloud memory store, or reconstructed from telemetry.

Metadata follows the same principle. Metadata is divided by purpose and scope: local indexing metadata stays with the local database; LLM request metadata is tied to the user's configured provider call; sharing metadata is tied to the selected share; team metadata is tied to the selected workspace or permission boundary. Metadata must not become an implicit memory-content replica.

---

## How It Works

```
+--------------------------------------------------------------+
|  SNO Station Core AI plugin in the local runtime process          |
|                                                              |
|  Reads/writes memory data -----> Encrypted SQLite database    |
|                                   ^                          |
|                                   | SQLCipher-compatible      |
|                                   | page encryption           |
|                                   |                          |
|                       +-----------+------------+             |
|                       |  Data Encryption Key   |             |
|                       |  256-bit random DEK    |             |
|                       +-----------+------------+             |
|                                   |                          |
|                  +----------------v-----------------+        |
|                  |  Explicit durable key custody    |        |
|                  |   operator file: mode 0600       |        |
|                  |   or an existing OS keychain key |        |
|                  +----------------------------------+        |
+--------------------------------------------------------------+
```

Before first use, a senior operator runs `sno-station-core lock --provision-key`.
Only that deliberate command generates a random 32-byte DEK with the operating
system CSPRNG and persists it as a mode-0600 durable file. Ordinary startup
without a key stops and names the command. Existing OS-keychain keys remain
readable, but runtime code never creates a replacement. Each database is then
opened through `@snoai/sno-station-core-crypto`, which applies the raw DEK to
the SQLite engine before any application queries run.

The operator retains a separate mode-`0600` recovery copy in durable,
operator-controlled storage. If the primary file becomes unavailable while
encrypted databases are registered, runtime stops and names the explicit
restore command:

```sh
sno-station-core lock --restore-key /operator-controlled/recovery/key
```

The restore command requires the primary path to be absent, validates the
recovery copy against every registered database fingerprint before writing,
restores the primary at mode `0600`, and leaves the recovery copy unchanged.
It does not generate, delete, move, print, or send key material.

Application code continues to read and write normal rows. The encryption layer sits below the query engine: pages are decrypted in memory when read and encrypted before being written back to disk. The DEK is not sent to Sno, to an LLM provider, through environment variables, or through command-line arguments.

---

## Component Assurance

The strongest security claim we can make is not "trust our custom cryptography." It is the opposite: SNO Station Core keeps its own crypto code small and delegates to components with public designs, mature implementations, and external standards behind them.

| Layer | What we use | Assurance basis |
|---|---|---|
| SQLite encryption | `better-sqlite3-multiple-ciphers`, bundling SQLite3MultipleCiphers | SQLCipher-compatible page encryption, public C implementation, same Node API shape as `better-sqlite3`. |
| Cipher mode for DB pages | SQLCipher v4-compatible AES-256-CBC plus page authentication | SQLCipher has been public since 2008; SQLite3MultipleCiphers documents AES-256-CBC, per-page random IVs, and SHA-512 page tags for v4 compatibility. |
| SQLite storage engine | SQLite | SQLite is built with a DO-178B-inspired quality process, high-volume regression testing, malformed database tests, and fuzzing that runs about one billion mutations per day. |
| OS key custody | `@napi-rs/keyring` over native OS APIs | Delegates to platform credential stores rather than inventing our own vault: macOS Keychain Services, Windows Credential Manager / DPAPI, and Linux Secret Service. |
| Passphrase KDF | `argon2` package, Argon2id mode | Argon2 was selected by the Password Hashing Competition; Argon2id is OWASP's modern recommendation for password-derived keys. |
| DEK wrapping | Node 22 built-in `crypto`, AES-256-GCM | Uses OpenSSL-backed Node primitives and NIST SP 800-38D GCM semantics: confidentiality and authentication in one operation. |
| First-party surface | `@snoai/sno-station-core-crypto` | Single audit surface for explicit key provisioning, DB opening, passphrase wrapping, export/import, and future key rotation. Plugins do not reimplement key handling. |

Important precision: the SNO Station Core v1 package itself is not claiming FIPS 140 product validation, Common Criteria certification, SOC 2 certification, or a formal third-party audit. The credible claim is narrower and stronger: we compose standardized algorithms and established storage/keychain components, avoid custom primitives, and keep the first-party code path small enough to audit.

---

## Security Levels

### Level 1 - Default: Explicitly Provisioned

Before creating the first database:

```sh
sno-station-core lock --provision-key
```

The default durable file is `~/.config/sno-station-core/key`. Set
`SNO_STATION_CORE_KEY_FILE` before the command to use another durable path.
Temporary and disposable paths are rejected. An existing OS-keychain DEK
continues to work, but no keychain or file key is created during normal
startup.

This check is unconditional: it also rejects a pre-existing default key when
`XDG_CONFIG_HOME` resolves inside temp, scratch, cache, runtime, or per-run
state. Finding a file there never makes the path acceptable, and the resolver
does not read or delete it.

The Memora evaluation harness is intentionally narrower than the general
package API: its synchronous, non-interactive server requires the explicitly
provisioned mode-0600 operator file. It does not use keychain-only custody or
an interactive passphrase file, because either would make cleanup-safe archive
access depend on session state. The operator recovery copy must be stored
outside the evaluation server root and every runner cleanup target.

- Anyone who can fully use your unlocked OS account can usually use SNO Station Core, because the OS treats them as you.
- This protects against stolen database files, cloud backups of the database file, casual snooping by other OS users, and disk extraction without the operator key.
- On macOS, the first access can show an OS "Allow keychain access" dialog. This is the operating system protecting the keychain item, not a Sno cloud prompt.

### Level 2 - Opt-In: Passphrase-Wrapped

Run once:

```sh
sno-station-core lock --set-passphrase
```

SNO Station Core derives a Key Encryption Key from your passphrase with Argon2id, then wraps the DEK with AES-256-GCM. The wrapped DEK is stored locally. After a fresh launch, reboot, or cache expiry, SNO Station Core requires the passphrase before it can open your encrypted databases.

This mode is for users who want protection even if someone can sign in to the operating-system account. While the gateway is actively unlocked, the DEK still exists in process memory because the database must be readable to work.

To revert:

```sh
sno-station-core lock --remove-passphrase
```

**There is no Sno recovery copy.** If you forget the passphrase after upgrading, Sno cannot decrypt the database and cannot reset the key for you.

### Level 3 - Headless / Server / Docker Provisioning

When OS secure storage is unavailable, for example on a Linux server without
D-Bus or libsecret, a senior operator first chooses a durable location and
provisions the key:

```sh
export SNO_STATION_CORE_KEY_FILE=/operator-controlled/sno-station-core/key
sno-station-core lock --provision-key
```

The command writes mode `0600`, verifies the file, and refuses temporary,
scratch, cache, runtime, existing, or database-bearing destinations. Ordinary
startup with no key and no registered database fails and names this command;
it never creates a key. If databases are already registered, the failure names
`sno-station-core lock --restore-key <operator-recovery-key-file>` instead of
suggesting a replacement.
Encryption remains on, while the DEK is protected by filesystem permissions
rather than an OS keychain.

---

## What We Protect Against

| Threat | Protection |
|---|---|
| Stolen database file | The file is ciphertext without the DEK. |
| Time Machine, iCloud, Dropbox, S3, NAS, or other cold backup leakage | Backups contain encrypted DB pages; the DEK is not inside the DB file. |
| Disk extraction from a powered-off machine | The attacker needs the OS keychain item or the passphrase-wrapped DEK plus passphrase. |
| Another OS user reading the DB file | The DB is encrypted; keychain entries and fallback key files are per-user. |
| Sno reading the local memory database | Sno does not receive the DB file or DEK. There is no v1 Sno cloud memory database. |
| Hidden cloud replication of memory content | Local memory is the authoritative store; actual memory content is not mirrored to Sno outside user-directed sharing, team, or model-request flows. |
| Tampering with encrypted DB pages | Page authentication detects modification and fails closed instead of silently returning changed plaintext. |

---

## What We Do Not Protect Against

We do not hide these boundaries:

- **Malware running as your OS user.** Such code can often ask the OS for the same keychain access you can, read your process memory, or capture what you type.
- **An unlocked machine in someone else's hands.** If the machine is unlocked and SNO Station Core is already running, the OS boundary has already been crossed.
- **Root, kernel, debugger, or memory-dump access.** The DEK must exist in process memory while the gateway is using the database.
- **OS swap and hibernation.** Use full-disk encryption to reduce that risk.
- **Forgotten passphrases.** There is no Sno escrow, backdoor, or support override.
- **Coerced unlock.** Cryptography cannot prevent a person from being forced to unlock a system.
- **The user's chosen LLM provider.** If you configure Anthropic, OpenAI, a local model server, or another provider, the relevant prompt context sent to that provider is governed by that provider and your configuration.
- **Future cloud features.** v1 has no Sno-operated cloud memory store. If cloud sync is added later, it must be explicit opt-in and documented separately.

---

## Data Egress Audit

| Pathway | Carries memory content? | Notes |
|---|---|---|
| Sno-operated memory cloud | **No** | No such v1 service exists. |
| Sno telemetry | **No by default** | Telemetry is disabled by default. Future telemetry must not include memory content. |
| Crash reports | **No by default** | Production crash reporting must not upload memory content. |
| Update checks | **No** | Version metadata only. |
| User-configured LLM provider | **Yes, when needed for an answer** | The provider is selected by the user and accessed with the user's own API key. Sno is not the intermediary. |
| User-requested sharing | **Only selected content** | The user chooses what to share; sharing metadata is scoped to that share. |
| Team collaboration | **Only selected workspace content** | Team memory, if enabled, is scoped to the selected workspace and permission boundary. Local personal memory remains local. |
| Operational metadata | **No memory content** | Metadata is segmented by purpose and must not contain a copy or reconstruction of actual memory content. |
| Local exports | User-controlled | `.sno-station-core` exports are encrypted locally before you move or back them up. |

---

## How To Verify

### 1. Confirm the Database Is Encrypted

Open the database with the standard `sqlite3` CLI, which does not know the key:

```sh
sqlite3 ~/.sno-station-core/sno-station-legacy-core/main.db ".tables"
```

Expected result:

```text
Error: file is not a database
```

That error is correct. The file is encrypted ciphertext, not a plaintext SQLite database.

For a legitimate low-level check, use a SQLCipher-compatible CLI and the DEK:

```text
sqlcipher ~/.sno-station-core/sno-station-legacy-core/main.db
> PRAGMA key = "x'<your-64-hex-DEK>'";
> .tables
```

Only print or handle a DEK for local verification. Never share it.

### 2. Confirm Sno Is Not Receiving Memory Content

While running SNO Station Core, monitor outbound connections:

```sh
sudo lsof -i -P -n | grep -i node
```

or:

```sh
sudo tcpdump -i any -A 'host not <your-LLM-provider> and not <your-DNS>'
```

You may see calls to the LLM provider you configured. You should not see memory database uploads to Sno.

### 3. Confirm the Active Protection Mode

```sh
sno-station-core lock --status
```

This reports whether the machine is using keychain mode, passphrase mode, or file fallback, plus a short non-secret key fingerprint for troubleshooting.

---

## Frequently Asked Questions

**Q: Can Sno read my memory database?**

A: No. Sno does not receive your DB file or DEK, and v1 has no Sno-operated cloud memory store.

**Q: Does my memory ever leave my machine?**

A: Not by default. The local database and DEK do not leave your machine through Sno. Selected content may leave only when you ask a configured LLM provider to answer with memory context, share memory, export it, or use an explicit team workflow.

**Q: Is the local database the source of truth?**

A: Yes. For personal memory, the encrypted local database is the authoritative store. Sno does not rebuild your memory from cloud telemetry or maintain a hidden server-side copy.

**Q: What about metadata?**

A: Metadata is scoped to the user's action. Local indexing metadata stays local; model-call metadata belongs to the configured provider request; sharing metadata belongs to the selected share; team metadata belongs to the selected workspace or permission boundary. It must not become a copy of the memory content.

**Q: Why is encryption on by default?**

A: Memory data is sensitive by nature. Modern CPUs handle AES efficiently, and the product risk of a plaintext default is much higher than the overhead of encrypting local SQLite pages.

**Q: Why use SQLite instead of a custom encrypted file format?**

A: SQLite is small, stable, transactional, broadly deployed, and unusually well tested. Keeping SQL, FTS, vector data, metadata, and transactions in one encrypted SQLite database gives us reliability without inventing a storage engine.

**Q: Is the new npm security package auditable?**

A: Yes. `@snoai/sno-station-core-crypto` is intentionally the only first-party package that handles keys and encrypted DB opening. It wraps established dependencies rather than spreading cryptographic logic through every plugin.

**Q: Is `better-sqlite3-multiple-ciphers` itself certified?**

A: We do not claim formal certification for that npm wrapper. The reliability argument is that it exposes the mature `better-sqlite3` API shape while bundling SQLite3MultipleCiphers, whose SQLCipher-compatible mode uses publicly documented, standard cryptographic building blocks.

**Q: What happens if my laptop is stolen?**

A: If the attacker only has the disk or a copied DB file, they see ciphertext. If they can unlock your OS account in default mode, they may be able to use the OS keychain as you. Passphrase mode adds another secret they must know.

**Q: What if I lose my passphrase?**

A: The data is unrecoverable. This is not a support policy; it is a cryptographic fact of the design.

**Q: Where do I report a security issue?**

A: Email `security@sno.ai`. Please include reproduction steps and do not file public issues for security bugs.

