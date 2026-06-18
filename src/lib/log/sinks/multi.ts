import type { LogEntry, LogSink } from "../types"

// Fan-out sink — useful when LOG_SINK=both so stdout still works for
// container log shippers AND a copy lands on disk for the admin UI.
export class MultiSink implements LogSink {
  private sinks: LogSink[]
  constructor(sinks: LogSink[]) {
    this.sinks = sinks
  }
  write(entry: LogEntry): void {
    for (const s of this.sinks) {
      try {
        s.write(entry)
      } catch {
        // never propagate
      }
    }
  }
}
