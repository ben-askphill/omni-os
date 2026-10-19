import Foundation
import Observation

// Mac notifications for results that need Ben (#205). They come from the same state as Needs you: a result is
// alerted when it first shows there, under its own uid, so one result alerts once however often the inbox loads.
// The app target posts them through UserNotifications (Omni/SystemNotifications.swift); OmniKit decides which.

/// What macOS lets the app do, as UNAuthorizationStatus says it.
public enum NotificationPermission: Hashable, Sendable {
  /// Never asked. Turning notifications on asks.
  case notAsked
  case allowed
  /// Ben said no, or turned Omni off in System Settings. Only System Settings can change it.
  case denied

  public var label: String {
    switch self {
    case .notAsked: "Not asked yet"
    case .allowed: "Allowed"
    case .denied: "Off in System Settings"
    }
  }
}

/// This Mac's choices, kept in UserDefaults and never synced: the other Mac keeps its own. Notifications start off,
/// so the app asks macOS only when Ben turns them on. `-notifications YES` turns them on for one run (QA) and then
/// nothing is saved, as with the appearance.
@MainActor @Observable
public final class NotificationSettings {
  public enum Key {
    public static let enabled = "notifications"
    public static let mutedChannels = "notificationsMutedChannels"
  }

  public var enabled: Bool {
    didSet { if !isVolatile { defaults.set(enabled, forKey: Key.enabled) } }
  }

  /// Channels that never alert. A new channel alerts until it is turned off here.
  public private(set) var mutedChannels: Set<String> {
    didSet { if !isVolatile { defaults.set(mutedChannels.sorted(), forKey: Key.mutedChannels) } }
  }

  /// A launch argument set notifications: changes last for this run only.
  public let isVolatile: Bool

  @ObservationIgnored private let defaults: UserDefaults

  /// - Parameter arguments: the launch arguments' values, NSArgumentDomain by default.
  public init(defaults: UserDefaults = .standard, arguments: [String: Any]? = nil) {
    let arguments = arguments ?? UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
    self.defaults = defaults
    isVolatile = arguments[Key.enabled] != nil
    let raw = arguments[Key.enabled] ?? defaults.object(forKey: Key.enabled)
    enabled = (raw as? Bool) ?? ((raw as? String).map { ["yes", "true", "1"].contains($0.lowercased()) } ?? false)
    mutedChannels = Set(defaults.stringArray(forKey: Key.mutedChannels) ?? [])
  }

  public func alerts(channel id: String) -> Bool { !mutedChannels.contains(id) }

  public func setAlerts(_ on: Bool, channel id: String) {
    if on { mutedChannels.remove(id) } else { mutedChannels.insert(id) }
  }
}

/// One notification: a result that came to need Ben. Its id is the result's uid, so posting it twice replaces it.
public struct AttentionAlert: Hashable, Sendable, Identifiable {
  public let id: String
  public let threadID: String
  public let channelID: String
  public let status: ThreadStatus
  public let title: String
  public let subtitle: String
  public let body: String

  public init(id: String, threadID: String, channelID: String, status: ThreadStatus, title: String, subtitle: String, body: String) {
    self.id = id
    self.threadID = threadID
    self.channelID = channelID
    self.status = status
    self.title = title
    self.subtitle = subtitle
    self.body = body
  }

  /// The alert for an item's result. `channelName` names the channel, its id when it has none.
  public init?(_ item: NeedsYouItem, channelName: String?) {
    guard let result = item.result, Self.alerted.contains(result.status) else { return nil }
    let channel = "#\(channelName ?? item.thread.channelID)"
    self.init(
      id: result.uid, threadID: item.thread.id, channelID: item.thread.channelID, status: result.status,
      title: item.thread.title.isEmpty ? "Untitled thread" : item.thread.title,
      subtitle: result.status == .failed ? "Failed in \(channel)" : "Finished in \(channel)",
      body: item.reason.detail.map { String($0.prefix(160)) } ?? ""
    )
  }

  /// Completions and failures. A stop is Ben's own doing, and blockers are not results.
  public static let alerted: Set<ThreadStatus> = [.done, .failed]

  // MARK: Deep link

  enum InfoKey {
    static let thread = "omniThread"
    static let channel = "omniChannel"
    static let result = "omniResult"
  }

  /// What the notification carries, for `Route(notification:)` when Ben clicks it.
  public var userInfo: [String: String] {
    [InfoKey.thread: threadID, InfoKey.channel: channelID, InfoKey.result: id]
  }
}

/// Which results alert, from each Needs you list in turn. Pure, so the rules are tested without macOS.
///
/// - The first list only records what is there: results from before the app looked are history, not news.
/// - A result alerts once, the first time a list has it. A reconnect or a sync that lists it again is no news.
/// - A result older than `freshness` when it first shows never alerts, so a sync that brings in a day of the
///   other Mac's results, or a long sleep, does not flood.
/// - The thread on screen in the front window is being watched: its result is recorded, not alerted.
/// - A muted channel's result is recorded too, so unmuting later does not alert old ones.
/// - An alert whose result has left the list (read here, on the other Mac or in the Web UI) is withdrawn.
public struct AttentionTracker: Sendable {
  public static let freshness: TimeInterval = 10 * 60

  private var seen: Set<String> = []
  private var posted: Set<String> = []
  private var started = false

  public init() {}

  public struct Changes: Hashable, Sendable {
    public var post: [AttentionAlert] = []
    /// Alerts to take back from Notification Center, by id.
    public var withdraw: [String] = []
  }

  /// - Parameters:
  ///   - viewing: the thread the main window shows.
  ///   - windowActive: the app is in front, so the thread on screen is being watched.
  ///   - alerts: whether a channel may alert. Off for every channel while notifications are off.
  public mutating func observe(
    _ list: NeedsYou, now: Date, viewing: String?, windowActive: Bool,
    alerts: (String) -> Bool, channelName: (String) -> String? = { _ in nil }
  ) -> Changes {
    var changes = Changes()
    let unread = Set(list.items.compactMap { $0.result?.uid })
    changes.withdraw = posted.subtracting(unread).sorted()
    posted.subtract(changes.withdraw)
    defer { started = true }
    // Oldest first, so alerts stack in the order the turns ended.
    for item in list.items.reversed() {
      guard let result = item.result, seen.insert(result.uid).inserted, started else { continue }
      guard now.timeIntervalSince(result.at) <= Self.freshness else { continue }
      guard !(windowActive && viewing == item.thread.id), alerts(item.thread.channelID) else { continue }
      guard let alert = AttentionAlert(item, channelName: channelName(item.thread.channelID)) else { continue }
      posted.insert(alert.id)
      changes.post.append(alert)
    }
    return changes
  }
}

/// Posts to Notification Center. The app's is UNUserNotificationCenter; tests use a fake.
@MainActor
public protocol NotificationPoster: AnyObject {
  func permission() async -> NotificationPermission
  /// Asks macOS, which shows its prompt only the first time.
  func requestPermission() async -> NotificationPermission
  func post(_ alert: AttentionAlert)
  func withdraw(_ ids: [String])
}

/// The app's notifications: this Mac's settings, what macOS allows and the tracker. `AppModel` passes it every
/// Needs you list and the thread on screen.
@MainActor @Observable
public final class AttentionCenter {
  public let settings: NotificationSettings
  public private(set) var permission = NotificationPermission.notAsked
  /// The app is in front. Set by the app.
  @ObservationIgnored public var windowActive = true
  /// nil in tests and before the app sets it: nothing is posted.
  @ObservationIgnored public var poster: (any NotificationPoster)?
  @ObservationIgnored private var tracker = AttentionTracker()
  @ObservationIgnored private let now: @Sendable () -> Date

  public init(settings: NotificationSettings = NotificationSettings(), now: @escaping @Sendable () -> Date = Date.init) {
    self.settings = settings
    self.now = now
  }

  /// Alerts are posted only when Ben turned them on and macOS allows them.
  public var isPosting: Bool { settings.enabled && permission == .allowed }

  /// Reads what macOS allows now. On launch, when the app comes to the front and when Settings shows.
  public func refreshPermission() async {
    guard let poster else { return }
    permission = await poster.permission()
  }

  /// Turning on asks macOS first, as macOS expects; a denial keeps the switch on and says so in Settings.
  public func setEnabled(_ on: Bool) async {
    settings.enabled = on
    guard on, let poster else { return }
    permission = await poster.requestPermission()
  }

  /// A new Needs you list. Results already recorded or read are never alerted again.
  public func observe(_ list: NeedsYou, viewing: String?, channelName: (String) -> String? = { _ in nil }) {
    let posting = isPosting
    let changes = tracker.observe(
      list, now: now(), viewing: viewing, windowActive: windowActive,
      alerts: { [settings] in posting && settings.alerts(channel: $0) }, channelName: channelName
    )
    guard let poster else { return }
    if !changes.withdraw.isEmpty { poster.withdraw(changes.withdraw) }
    for alert in changes.post { poster.post(alert) }
  }

  /// Another server: its results are history until its first list is recorded.
  public func reset() {
    tracker = AttentionTracker()
  }
}
