import Foundation
import Observation

// Handing a thread, running or idle, to another synced Mac. The shapes and the banner text are packages/shared/handoff.ts;
// apps/server/tests/mac-fixtures.test.ts holds both clients to the same JSON. When to offer it, the picker's rows and
// the banner per phase follow apps/web/src/handoff.ts.

/// Whether a Mac can take a thread now, as this Mac's Tailscale sees it. `unknown`: no Tailscale here or there to ask.
public struct Reachability: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let online: Self = "online"
  public static let offline: Self = "offline"
  public static let unknown: Self = "unknown"
}

/// GET /api/devices: another synced Mac, never this one.
public struct Device: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  /// Its ComputerName, e.g. "Ben's MacBook Pro".
  public let name: String
  public let reachability: Reachability
  /// Its MagicDNS name, without the trailing dot.
  public let dnsName: String?
  /// Tailscale's last-seen time for an offline node.
  public let lastSeen: Date?

  /// `canTake` in handoff.ts: only a Mac Tailscale knows is away is refused.
  public var canTake: Bool { reachability != .offline }

  /// The second line of its row in Hand Off to, as `deviceRow` in apps/web/src/handoff.ts.
  public func reachabilityLabel(now: Date = .now, calendar: Calendar = Format.localCalendar) -> String {
    switch reachability {
    case .online: return "Online on Tailscale"
    case .offline:
      guard let lastSeen else { return "Asleep or offline" }
      return "Asleep or offline, last seen \(Format.relTime(lastSeen, now: now, calendar: calendar))"
    default: return "Can't check Tailscale"
    }
  }

  /// Online Macs first, then the ones Tailscale cannot vouch for, then the asleep ones; by name within each.
  public static func picker(_ devices: [Device]) -> [Device] {
    func rank(_ d: Device) -> Int { d.reachability == .online ? 0 : d.reachability == .offline ? 2 : 1 }
    return devices.sorted { a, b in
      rank(a) != rank(b) ? rank(a) < rank(b) : a.name.localizedStandardCompare(b.name) == .orderedAscending
    }
  }

  enum CodingKeys: String, CodingKey {
    case id, name, reachability, dnsName, lastSeen
  }
}

/// What the giving Mac does before the offer goes out, in order.
public struct PrepareStep: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let stopping: Self = "stopping"
  public static let uploading: Self = "uploading"
  public static let packing: Self = "packing"

  var doing: String {
    switch self {
    case .stopping: "stopping the turn here"
    case .uploading: "uploading the session"
    case .packing: "packing the worktree"
    default: rawValue
    }
  }
}

/// `HandoffPhase` in handoff.ts, discriminated by `phase`.
public enum HandoffPhase: Decodable, Hashable, Sendable {
  case preparing(PrepareStep)
  /// `stale`: the other Mac has not answered within `HandoffView.offerPatience`. It may still take it.
  case offered(stale: Bool)
  case accepted
  case failed(error: String, at: Side)
  case cancelled

  /// Which Mac the failure happened on.
  public enum Side: String, Decodable, Hashable, Sendable {
    case here, there
  }

  private enum CodingKeys: String, CodingKey {
    case phase, step, stale, error
    case side = "where"
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(String.self, forKey: .phase) {
    case "preparing": self = .preparing(try c.decode(PrepareStep.self, forKey: .step))
    case "offered": self = .offered(stale: try c.decodeIfPresent(Bool.self, forKey: .stale) ?? false)
    case "accepted": self = .accepted
    case "failed": self = .failed(error: try c.decode(String.self, forKey: .error), at: try c.decode(Side.self, forKey: .side))
    case "cancelled": self = .cancelled
    case let other:
      throw DecodingError.dataCorruptedError(forKey: .phase, in: c, debugDescription: "unknown handoff phase \(other)")
    }
  }
}

/// GET /api/threads/:id `handoff`, and the thread stream's. The thread has none in flight when it is nil.
public struct HandoffView: Decodable, Hashable, Sendable {
  public struct Mac: Decodable, Hashable, Sendable {
    public let id: String
    public let name: String
  }

  public let id: String
  public let from: Mac
  public let to: Mac
  /// The Mac reading it is the one that gave the thread away.
  public let outgoing: Bool
  public let at: Date
  public let state: HandoffPhase
  /// Uncommitted changes in a shared folder that could not travel.
  public let leftBehind: String?
  /// Handed off between turns: nothing was cut off, and Ben's next message continues it on the other Mac.
  public let idle: Bool

  /// OFFER_PATIENCE_MS: how long an offer waits before the giving Mac says the other has not picked it up.
  public static let offerPatience: TimeInterval = 90

  enum CodingKeys: String, CodingKey {
    case id, from, to, outgoing, at, state, leftBehind, idle
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    from = try c.decode(Mac.self, forKey: .from)
    to = try c.decode(Mac.self, forKey: .to)
    outgoing = try c.decode(Bool.self, forKey: .outgoing)
    at = try c.decode(Date.self, forKey: .at)
    state = try c.decode(HandoffPhase.self, forKey: .state)
    leftBehind = try c.decodeIfPresent(String.self, forKey: .leftBehind)
    idle = try c.decodeIfPresent(Bool.self, forKey: .idle) ?? false
  }

  /// The phase at `now`: an offer goes stale on screen once the patience runs out, without waiting for the server
  /// to say so again.
  public func phase(now: Date = .now) -> HandoffPhase {
    if case .offered(false) = state, now.timeIntervalSince(at) > Self.offerPatience { return .offered(stale: true) }
    return state
  }

  /// Preparing or offered: the thread is between Macs, and the giving Mac can still call it off.
  public var inFlight: Bool {
    switch state {
    case .preparing, .offered: true
    default: false
    }
  }

  /// The banner's one line at `now`.
  public func text(now: Date = .now) -> String {
    Self.text(from: from, to: to, outgoing: outgoing, state: phase(now: now), idle: idle)
  }

  /// `handoffText` in handoff.ts: one line for the banner, from the reading Mac's side.
  public static func text(from: Mac, to: Mac, outgoing: Bool, state: HandoffPhase, idle: Bool = false) -> String {
    let other = outgoing ? to.name : from.name
    switch state {
    case .preparing(let step):
      if !outgoing { return "\(other) is handing this thread to this Mac." }
      return "Handing off to \(to.name): \(step.doing)."
    case .offered(let stale):
      if !outgoing { return "Picking this thread up from \(other)." }
      return stale ? "\(other) has not picked this thread up yet. It may be asleep or not running Omni." : "Waiting for \(other) to pick it up."
    case .accepted:
      if idle {
        return outgoing ? "Handed off to \(other). Your next message continues it there." : "Handed off from \(other). Your next message continues it here."
      }
      return outgoing ? "Running on \(other). Handed off from this Mac." : "Handed off from \(other). Running on this Mac."
    case .failed(let error, let side):
      return outgoing || side == .here
        ? "The handoff to \(to.name) failed: \(sentence(error)) The thread is stopped here; reply to continue it."
        : "Could not pick this thread up from \(other): \(sentence(error))"
    case .cancelled:
      return "The handoff to \(to.name) was cancelled."
    }
  }

  /// The error with one full stop at the end, as `replace(/\.?$/, '.')`.
  private static func sentence(_ s: String) -> String { s.hasSuffix(".") ? s : s + "." }
}

/// The thread's handoff banner, as `handoffBanner` in apps/web/src/handoff.ts. A card while it is under way or went
/// wrong, with Cancel on the giving Mac while the other has not taken it; one quiet line once it settled.
public enum HandoffBanner: Hashable, Sendable {
  public enum Tone: Hashable, Sendable {
    /// A card: the giving Mac is preparing, or the taking Mac is picking it up.
    case working
    /// A card: the offer is out and the other Mac has not answered yet.
    case waiting
    /// A card: the offer went stale or the handoff failed.
    case alert
    /// A line: the other Mac took it.
    case done
    /// A line: it was called off.
    case cancelled
  }

  case card(tone: Tone, text: String, cancel: Bool)
  case line(tone: Tone, text: String)

  /// Nil once there is nothing to say: no handoff, or a failed one the thread has since moved past (Ben replied and
  /// it runs again).
  public init?(_ h: HandoffView?, status: ThreadStatus?, now: Date = .now) {
    guard let h else { return nil }
    let text = h.text(now: now)
    switch h.phase(now: now) {
    case .preparing:
      self = .card(tone: .working, text: text, cancel: h.outgoing)
    case .offered(let stale):
      self = h.outgoing ? .card(tone: stale ? .alert : .waiting, text: text, cancel: true) : .card(tone: .working, text: text, cancel: false)
    case .failed:
      if status?.isActive == true { return nil }
      self = .card(tone: .alert, text: text, cancel: false)
    case .accepted:
      self = .line(tone: .done, text: text)
    case .cancelled:
      self = .line(tone: .cancelled, text: text)
    }
  }
}

/// What POST /api/threads/:id/handoff and its cancel answer.
public struct HandoffAnswer: Decodable, Hashable, Sendable {
  public let thread: OmniThread
  public let handoff: HandoffView?

  enum CodingKeys: String, CodingKey {
    case thread, handoff
  }
}

private struct HandoffBody: Encodable, Sendable {
  let to: String
}

private struct NoBody: Encodable, Sendable {}

/// The calls the Hand Off menu makes to know where a thread can go. `OmniClient` is one; tests pass a fake.
public protocol DevicesAPI: Sendable {
  func devices() async throws(OmniAPIError) -> [Device]
  func syncStatus() async throws(OmniAPIError) -> SyncStatus
}

extension OmniClient: DevicesAPI {
  /// The other synced Macs and whether each is on the tailnet now. Empty when sync is off.
  public func devices() async throws(OmniAPIError) -> [Device] {
    try await send("GET", "/api/devices")
  }

  /// Starts handing the running thread to the Mac `to`. The server answers once the offer is preparing; the rest
  /// comes on the thread's stream.
  public func handOff(_ id: String, to: String) async throws(OmniAPIError) -> HandoffAnswer {
    try await send("POST", "/api/threads/\(uriComponent(id))/handoff", body: HandoffBody(to: to))
  }

  public func cancelHandoff(_ id: String) async throws(OmniAPIError) -> HandoffAnswer {
    try await send("POST", "/api/threads/\(uriComponent(id))/handoff/cancel", body: NoBody())
  }
}

/// The other synced Macs, for Hand Off to. It follows the connection and is refreshed while a thread that could
/// go is on screen: Tailscale's view of the other Mac changes as it sleeps and wakes.
@MainActor @Observable
public final class DevicesModel {
  /// In picker order. Empty while sync cannot carry an offer: signed out, never set up or paused here.
  public private(set) var devices: [Device] = []

  @ObservationIgnored private var api: (any DevicesAPI)?
  @ObservationIgnored private var loads = 0

  public init() {}

  public func connect(api: any DevicesAPI) {
    self.api = api
    loads += 1
    devices = []
  }

  /// Asks again. A failed ask keeps the list it had: the menu is a convenience, and the server refuses a bad target.
  public func refresh() async {
    guard let api else { return }
    loads += 1
    let load = loads
    do throws(OmniAPIError) {
      let status = try await api.syncStatus()
      let list = status.configured && status.enabled && !status.signedOut ? try await api.devices() : []
      guard load == loads else { return }
      devices = Device.picker(list)
    } catch {
      return
    }
  }

  /// The Macs `store`'s thread can go to, nil when Hand Off to should not show: the thread does not run here,
  /// a handoff of it is under way, or there is no other Mac.
  public func targets(_ store: ThreadStore?) -> [Device]? {
    guard let store, store.canHandOff, !devices.isEmpty else { return nil }
    return devices
  }
}
