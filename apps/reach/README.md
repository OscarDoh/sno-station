# Reach

One installed program for agent-to-agent communication. `sno reach <verb>` dispatches to `sno-reach` on PATH.

## Build and local install

Requires Bash, GNU make, a C compiler/libc, jq, coreutils, flock, and the channel tools used by the seat (tmux or acpx; Orca for registered Orca terminals). Vendored mail tools build from the included source; no system mblaze is selected.

```sh
make -C apps/reach deps
make -C apps/reach test
make -C apps/reach package
make -C apps/reach install
export PATH="$HOME/.local/bin:$PATH"
sno reach --version
sno reach --help
```

Packaging writes `dist/reach-2.0.tar.gz` and its exact-basename `.sha256` file. The payload is directly at archive root, with VERSION, LICENSE, NOTICE, bin, lib, vendor, spec and guide. Local install verifies the checksum and places the immutable release at `~/.local/lib/sno-reach/releases/2.0`, with `current` and the command symlink. It refuses a different already-installed version2.0 payload rather than overwriting it.

Publication and real-agent acceptance remain separate gates. Do not use a source overlay to repair an archive under test. The installer must consume the accepted archive and checksum, not this checkout.

## Use

Read the co-shipped [agent guide](guide/agent-reach.md). Initialize a seat before spawning or registering it. Use a dedicated state root for tests. An exit5 or6 after delivery is a wake problem; do not resend the card. Old names and old stores are not used.
