/// A clock with its instant type erased: time is the duration since the ticker was made. Deadlines are
/// taken when a wait is asked for, not when the sleeping task gets to run, so a test clock moved right
/// after still wakes it.
struct Ticker: Sendable {
  let now: @Sendable () -> Duration
  let sleep: @Sendable (_ until: Duration) async throws -> Void

  init<C: Clock<Duration>>(_ clock: C) {
    let start = clock.now
    now = { start.duration(to: clock.now) }
    sleep = { try await clock.sleep(until: start.advanced(by: $0), tolerance: nil) }
  }
}
