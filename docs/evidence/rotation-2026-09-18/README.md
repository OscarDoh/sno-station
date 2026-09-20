# One night: a coding agent handed its job to the other vendor's agent

These are the unedited working files from a single night. A coding agent was about two hours
into a 27-task build when its weekly subscription quota ran low. A watcher reading the quota
every five minutes decided — while that agent was still able to work — that it should hand the
whole job to an agent from a different vendor. The second agent verified what it was given and
carried on committing. Nobody was awake.

Only the identifying details are changed: host names became `linux-host`, `mac-host` and
`workstation`; mailbox addresses became `sender-seat`, `receiver-seat` and `watch-seat`; home
directories became `~`; the repository name became `<repo>`; internal tool names were
generalised; any line mentioning a credential was removed whole. Nothing else was touched — the
timings, the mistakes and the corrections are as they happened.

| file | what it is |
|---|---|
| `heartbeat-rotation-mem-claude.log` | every quota reading, five minutes apart, from 10% remaining down to the 2% that triggered the handover |
| `order-sent.txt` | the exact instruction sent to the working agent, and when |
| `BRIEF.md` | the handover brief it wrote: what was done, what was half-done, which commit to continue from |
| `readiness.txt` | the receiving agent's reply: the size and checksum it measured, and its promise not to touch anything until released |
| `release.txt`, `release-reminder.txt` | the first release, and the chase when no receipt came back |
| `BRIEF-VERIFIED.md` | the rewritten brief after the receiver started work too early and was paused |
| `readiness-retry.txt`, `release-retry.txt` | the second, clean verification and the release receipt that followed |
| `git-summary.txt` | the repository's commits across the night: one job, continuing straight through the handover. Both agents commit under the owner's git identity, so the file does not say which agent wrote which commit — what the handover shows is the timeline, the brief and the receipts |

Read them in that order and the night reads itself.
