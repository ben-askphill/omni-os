import Foundation
import Observation

/// The Automations page, like the Web UI's: the list, Run now, and the enabled switch, which shows its new value
/// at once and turns back if the server refuses. The list loads again a second after an automation's thread
/// changes or the feed reconnects.
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
  /// The automation threads last seen in the recent list. nil until the first one.
  @ObservationIgnored private var seen: [OmniThread.ID: OmniThread]?

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

  /// Reloads soon when an automation's thread in the recent list is new or has changed since the last call.
  /// The first call only takes note: the page loads on its own.
  public func recentChanged(_ threads: [OmniThread]) {
    let now = Dictionary(threads.filter { $0.automation != nil }.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    defer { seen = now }
    guard let seen else { return }
    if now.contains(where: { seen[$0.key] != $0.value }) { scheduleReload() }
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
