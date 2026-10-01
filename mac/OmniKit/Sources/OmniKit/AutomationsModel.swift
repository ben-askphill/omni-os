import Foundation
import Observation

/// The Automations page, like the Web UI's: the list, Run now, and the enabled switch, which shows its new value
/// at once and turns back if the server refuses. The list loads again a second after a feed thread event whose
/// thread has `automation` set, or after the feed reconnects. The thread does not have to still be in `recent`.
@MainActor @Observable
public final class AutomationsModel {
  public enum LoadState: Hashable, Sendable {
    case loading
    case loaded
    case failed(String)
  }

  public static let reloadDelay: Duration = .seconds(1)

  /// In the server's order, by id.
  public private(set) var automations: [Automation] = []
  /// `.loading` until the first answer. A reload keeps showing what it has.
  public private(set) var loadState = LoadState.loading
  public private(set) var isRefreshing = false
  public private(set) var toggling: Set<Automation.ID> = []
  public private(set) var starting: Set<Automation.ID> = []
  /// The last toggle or Run now that failed, by automation.
  public private(set) var errors: [Automation.ID: String] = [:]
  /// The switch's value while the server has not confirmed it.
  private var pending: [Automation.ID: Bool] = [:]

  @ObservationIgnored private let client: OmniClient
  @ObservationIgnored private let ticker: Ticker
  @ObservationIgnored private var loads = 0
  @ObservationIgnored private var reloadTimer: Task<Void, Never>?

  public init(client: OmniClient, clock: any Clock<Duration> = ContinuousClock()) {
    self.client = client
    self.ticker = Ticker(clock)
  }

  public func isEnabled(_ a: Automation) -> Bool { pending[a.id] ?? a.enabled }
  public func canToggle(_ a: Automation) -> Bool { a.error == nil && !toggling.contains(a.id) }
  public func canRun(_ a: Automation) -> Bool { a.error == nil && !starting.contains(a.id) }

  /// When loads overlap, the latest one's answer wins.
  public func load() async {
    loads += 1
    let load = loads
    isRefreshing = true
    do throws(OmniAPIError) {
      let list = try await client.automations()
      guard load == loads else { return }
      automations = list
      pending = pending.filter { toggling.contains($0.key) }
      loadState = .loaded
    } catch {
      guard load == loads, error != .cancelled else { return }
      loadState = .failed(error.message)
    }
    if load == loads { isRefreshing = false }
  }

  public func setEnabled(_ enabled: Bool, for a: Automation) async {
    guard canToggle(a) else { return }
    pending[a.id] = enabled
    toggling.insert(a.id)
    errors[a.id] = nil
    do throws(OmniAPIError) {
      try await client.setAutomationEnabled(a.id, enabled)
    } catch {
      toggling.remove(a.id)
      pending[a.id] = nil
      errors[a.id] = error.message
      return
    }
    toggling.remove(a.id)
    await load()
  }

  /// Starts a run and returns its thread's id, to open. nil when it did not start; the reason is in `errors`.
  public func runNow(_ a: Automation) async -> OmniThread.ID? {
    guard canRun(a) else { return nil }
    starting.insert(a.id)
    errors[a.id] = nil
    defer { starting.remove(a.id) }
    do throws(OmniAPIError) {
      return try await client.runAutomation(a.id).id
    } catch {
      errors[a.id] = error.message
      return nil
    }
  }

  /// The Web UI's predicate (Automations.tsx): a thread event whose thread has `automation` set schedules a
  /// reload. Anything else does not. A reconnect calls `scheduleReload()` on its own.
  public func feed(_ event: FeedEvent) {
    switch event {
    case .thread(let thread):
      if let automation = thread.automation, !automation.isEmpty { scheduleReload() }
    case .usage(_, _), .artifact(_), .tasks(_), .channel(_), .unknown(_):
      break
    }
  }

  /// Loads the list `reloadDelay` from now. Asking again while it waits does nothing more.
  public func scheduleReload() {
    guard reloadTimer == nil else { return }
    let deadline = ticker.now() + Self.reloadDelay
    reloadTimer = Task { [weak self, ticker] in
      do {
        try await ticker.sleep(deadline)
      } catch {
        return
      }
      guard let self else { return }
      self.reloadTimer = nil
      await self.load()
    }
  }

  /// Drops a reload that has not started, as when the page closes.
  public func stop() {
    reloadTimer?.cancel()
    reloadTimer = nil
  }
}
