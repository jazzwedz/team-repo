// Stdout sink — writes one JSON object per entry, newline-terminated.
// Always available; safe even when LOG_PATH is unset. Whatever runs
// the Node process (terminal, systemd, journald, docker logs, IIS
// piped output, ...) collects the stream.

import type { LogEntry, LogSink } from "../types"

export class StdoutSink implements LogSink {
  write(entry: LogEntry): void {
    try {
      const line = JSON.stringify(entry)
      // Use process.stdout.write directly so we get a true atomic-ish
      // write on POSIX and avoid the formatting console.* layers.
      process.stdout.write(line + "\n")
    } catch {
      // Never propagate; logging must not break a request.
    }
  }
}
