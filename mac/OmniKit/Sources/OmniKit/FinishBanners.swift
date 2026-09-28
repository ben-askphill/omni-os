import Foundation
import Observation

/// A banner in the window: a thread finished, failed or stopped. As the Web UI's toast.
public struct Banner: Identifiable, Hashable, Sendable {
  public let id: Int
  public let threadID: String
  public let status: ThreadStatus
  public let title: String
  public let body: String
}

/// Decides which feed events become banners, like `ThreadNotifier` in web/src/components/Toaster.tsx: a
/// thread that was running or queued and now is done, failed or stopped, unless it is on screen.
public struct FinishTracker: Sendable {
  private var seen: [String: ThreadStatus] = [:]

  public init() {}

  /// Threads already in flight, so their end is caught. Never overwrites what the feed has said.
  public mutating func seed(_ threads: [OmniThread]) {
    for t in threads where seen[t.id] == nil { seen[t.id] = t.status }
  }

  /// - Parameters:
  ///   - viewing: the thread the route shows.
  ///   - windowActive: the app is in front, so the thread on screen is being watched.
  public mutating func observe(_ t: OmniThread, viewing: String?, windowActive: Bool) -> (title: String, body: String)? {
    let previous = seen[t.id]
    seen[t.id] = t.status
    guard let previous, previous.isActive else { return nil }
    let verb: String
    switch t.status {
    case .done: verb = "Finished"
    case .failed: verb = "Failed"
    case .stopped: verb = "Stopped"
    default: return nil
    }
    if viewing == t.id, windowActive { return nil }
    return (t.title.isEmpty ? "Untitled thread" : t.title, "\(verb) in #\(t.channelID)")
  }
}

@MainActor @Observable
public final class BannerCenter {
  public static let maxShown = 4

  public private(set) var banners: [Banner] = []
  /// The app is in front. Set by the app.
  @ObservationIgnored public var windowActive = true
  @ObservationIgnored private var tracker = FinishTracker()
  @ObservationIgnored private var nextID = 0

  public init() {}

  public func seed(_ threads: [OmniThread]) {
    tracker.seed(threads)
  }

  public func handle(_ event: FeedEvent, viewing: String?) {
    guard case .thread(let t) = event, let shown = tracker.observe(t, viewing: viewing, windowActive: windowActive) else { return }
    nextID += 1
    banners = Array((banners + [Banner(id: nextID, threadID: t.id, status: t.status, title: shown.title, body: shown.body)]).suffix(Self.maxShown))
  }

  public func dismiss(_ id: Int) {
    banners.removeAll { $0.id == id }
  }
}
