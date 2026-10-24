import Foundation
import Observation

/// The Automations page, like the Web UI's: the list, Run now, the enabled switch, which shows its new value
/// at once and turns back if the server refuses, and a webhook automation's signing secret. The list loads again a second after a feed thread event whose
/// thread has `automation` set, an `automation_delivery` event, or a feed reconnect. The thread does not have to
/// still be in `recent`.
///
/// Each automation's deliveries are the latest five from the list plus whatever Show older loaded, merged by id so a
/// reload refreshes the latest and leaves the rest. Retry and Skip act on the row as it was shown (its attempt) and
/// take the server's answer back into the row.
@MainActor @Observable
public final class AutomationsModel {
  public enum LoadState: Hashable, Sendable {
    case loading
    case loaded
    case failed(String)
  }

  public static let reloadDelay: Duration = .seconds(1)
  /// How many older deliveries Show older asks for.
  public static let historyPage = 20

  /// In the server's order, by id.
  public private(set) var automations: [Automation] = []
  /// `.loading` until the first answer. A reload keeps showing what it has.
  public private(set) var loadState = LoadState.loading
  public private(set) var isRefreshing = false
  public private(set) var toggling: Set<Automation.ID> = []
  public private(set) var starting: Set<Automation.ID> = []
  /// Webhook automations whose signing secret is being saved or removed.
  public private(set) var savingSecret: Set<Automation.ID> = []
  /// The last toggle, Run now or secret removal that failed, by automation.
  public private(set) var errors: [Automation.ID: String] = [:]
  /// The deliveries each automation shows, newest first. See `deliveries(of:)`.
  private var delivered: [Automation.ID: [TriggerDelivery]] = [:]
  /// The delivery rows that are open.
  public private(set) var expanded: Set<TriggerDelivery.ID> = []
  /// Deliveries a retry or skip is out for.
  public private(set) var acting: Set<TriggerDelivery.ID> = []
  /// The last retry or skip that failed, by delivery, until its next one.
  public private(set) var deliveryErrors: [TriggerDelivery.ID: String] = [:]
  /// Automations whose Show older is out.
  public private(set) var loadingOlder: Set<Automation.ID> = []
  public private(set) var olderErrors: [Automation.ID: String] = [:]
  /// Whether older deliveries exist, once a page of history has said. Until then the list does.
  private var olderLeft: [Automation.ID: Bool] = [:]
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
  public func canEditSecret(_ a: Automation) -> Bool { a.webhook != nil && !savingSecret.contains(a.id) }
  /// A secret that is only whitespace would be stored empty: the server trims it.
  public static func isSecretValue(_ value: String) -> Bool { !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  /// When loads overlap, the latest one's answer wins.
  public func load() async {
    loads += 1
    let load = loads
    isRefreshing = true
    do throws(OmniAPIError) {
      let list = try await client.automations()
      guard load == loads else { return }
      automations = list
      delivered = Dictionary(list.map { ($0.id, TriggerDelivery.merge($0.deliveries, into: delivered[$0.id] ?? [])) }, uniquingKeysWith: { _, last in last })
      olderLeft = olderLeft.filter { key, _ in list.contains { $0.id == key } }
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

  /// Stores the signing secret and loads the list again, so the status reads set. Returns why it failed, nil once
  /// saved; the caller drops the value either way.
  public func setWebhookSecret(_ value: String, for a: Automation) async -> String? {
    guard Self.isSecretValue(value) else { return "Paste the signing secret." }
    guard canEditSecret(a) else { return "The last change to this secret is still being saved." }
    savingSecret.insert(a.id)
    errors[a.id] = nil
    defer { savingSecret.remove(a.id) }
    do throws(OmniAPIError) {
      try await client.setAutomationWebhookSecret(a.id, value: value)
    } catch {
      return error.message
    }
    await load()
    return nil
  }

  /// Removes the signing secret from the Keychain and loads the list again. A failure is in `errors`.
  public func removeWebhookSecret(for a: Automation) async {
    guard canEditSecret(a) else { return }
    savingSecret.insert(a.id)
    errors[a.id] = nil
    defer { savingSecret.remove(a.id) }
    do throws(OmniAPIError) {
      try await client.removeAutomationWebhookSecret(a.id)
    } catch {
      errors[a.id] = error.message
      return
    }
    await load()
  }

  /// What the automation's Deliveries list shows, newest first.
  public func deliveries(of a: Automation) -> [TriggerDelivery] { delivered[a.id] ?? a.deliveries }
  /// Older deliveries than the last one shown exist.
  public func hasOlder(_ a: Automation) -> Bool { olderLeft[a.id] ?? a.deliveriesMore }
  public func isExpanded(_ d: TriggerDelivery) -> Bool { expanded.contains(d.id) }
  public func canRetry(_ d: TriggerDelivery) -> Bool { d.canRetry && !acting.contains(d.id) }
  public func canSkip(_ d: TriggerDelivery) -> Bool { d.canSkip && !acting.contains(d.id) }

  /// Opens or closes a delivery's detail. A reload leaves it as it is.
  public func setExpanded(_ open: Bool, for d: TriggerDelivery) {
    if open { expanded.insert(d.id) } else { expanded.remove(d.id) }
  }

  /// Goes again as the next attempt. The row shows what the server answers, and a refusal's reason under it.
  public func retry(_ d: TriggerDelivery) async { await act(.retry, on: d) }

  /// Never starts it. Final: the caller asks first.
  public func skip(_ d: TriggerDelivery) async { await act(.skip, on: d) }

  private enum DeliveryAction { case retry, skip }

  private func act(_ action: DeliveryAction, on d: TriggerDelivery) async {
    // Taken before the first await, so a second click while the request is out finds it taken and sends nothing.
    guard !acting.contains(d.id), action == .retry ? d.canRetry : d.canSkip else { return }
    acting.insert(d.id)
    deliveryErrors[d.id] = nil
    defer { acting.remove(d.id) }
    do throws(OmniAPIError) {
      take(try await (action == .retry ? client.retryDelivery(d.id, attempt: d.attempt) : client.skipDelivery(d.id, attempt: d.attempt)))
    } catch {
      guard error != .cancelled else { return }
      deliveryErrors[d.id] = error.message
      // A refusal carries the delivery as it is now, but OmniClient keeps only the message of a failed call.
      if case .http(status: 409, _) = error, let now = try? await client.delivery(d.id) { take(now) }
      return
    }
    await load()
  }

  /// Loads the next page of history after the last row shown.
  public func showOlder(for a: Automation) async {
    guard hasOlder(a), !loadingOlder.contains(a.id), let last = deliveries(of: a).last else { return }
    loadingOlder.insert(a.id)
    olderErrors[a.id] = nil
    defer { loadingOlder.remove(a.id) }
    do throws(OmniAPIError) {
      let page = try await client.automationDeliveries(a.id, limit: Self.historyPage, before: last.id)
      delivered[a.id] = TriggerDelivery.merge(page.deliveries, into: deliveries(of: a))
      olderLeft[a.id] = page.more
    } catch {
      if error != .cancelled { olderErrors[a.id] = error.message }
    }
  }

  private func take(_ d: TriggerDelivery) {
    let rows = delivered[d.automation] ?? automations.first { $0.id == d.automation }?.deliveries ?? []
    delivered[d.automation] = TriggerDelivery.merge([d], into: rows)
  }

  /// The Web UI's predicate (Automations.tsx): a thread event whose thread has `automation` set, or a delivery
  /// that was saved or moved on, schedules a reload. Anything else does not. A reconnect calls `scheduleReload()`
  /// on its own.
  public func feed(_ event: FeedEvent) {
    switch event {
    case .thread(let thread):
      if let automation = thread.automation, !automation.isEmpty { scheduleReload() }
    case .automationDelivery(_):
      scheduleReload()
    case .usage(_, _), .artifact(_), .tasks(_), .mods(_), .channel(_), .needsYou(_), .unknown(_):
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
