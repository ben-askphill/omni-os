import Foundation
import Observation

/// The REST call the artifacts store makes. `OmniClient` is one; tests pass a fake.
public protocol ArtifactsAPI: Sendable {
  func artifacts() async throws(OmniAPIError) -> [GalleryArtifact]
}

extension OmniClient: ArtifactsAPI {}

/// What the Artifacts page shows: the gallery, loaded when the page opens and kept current from the feed.
/// A new artifact joins at once when its thread is known (`ArtifactGallery.upsert`). Otherwise, and after
/// the feed reconnects (events were missed), the list is fetched again, once per burst, 1.5s after the first
/// trigger like the Web UI does.
///
/// `init(client:)` reads the `AppFeed` the app already opened.
@MainActor @Observable
public final class ArtifactsStore {
  public enum LoadState: Hashable, Sendable {
    case loading, loaded
    /// The last load failed. Whatever loaded before stays.
    case failed(OmniAPIError)
  }

  static let reloadDelay = Duration.milliseconds(1500)

  public private(set) var gallery = ArtifactGallery()
  public private(set) var loadState = LoadState.loading

  @ObservationIgnored private let api: any ArtifactsAPI
  @ObservationIgnored private let events: AsyncStream<SSEEvent<FeedEvent>>?
  @ObservationIgnored private let ticker: Ticker
  @ObservationIgnored private let thread: @MainActor (String) -> (title: String, channelID: String)?
  @ObservationIgnored private var feedClient: SSEClient<FeedEvent>?
  @ObservationIgnored private var feedTask: Task<Void, Never>?
  @ObservationIgnored private var reloadTimer: Task<Void, Never>?
  @ObservationIgnored private var loads = 0
  /// Feed artifacts that arrived while a reload was out; nil when none is.
  @ObservationIgnored private var sinceLoad: [Int: Artifact]?
  @ObservationIgnored private var opened = false
  @ObservationIgnored private var started = false
  /// The app's feed, when this store did not open one. `stop` leaves that connection up.
  @ObservationIgnored private var sharedFeed: AppFeed?
  @ObservationIgnored private var feedTicket: UUID?
  @ObservationIgnored private var baseURL: URL?

  /// - Parameter thread: the title and channel of a thread the caller knows, for an artifact of a thread
  ///   with none listed yet.
  public init(
    api: any ArtifactsAPI, feed: AsyncStream<SSEEvent<FeedEvent>>? = nil, clock: any Clock<Duration> = ContinuousClock(),
    thread: @escaping @MainActor (String) -> (title: String, channelID: String)? = { _ in nil }
  ) {
    self.api = api
    events = feed
    ticker = Ticker(clock)
    self.thread = thread
  }

  /// Reads the app's one feed, the `AppFeed` registered for `client`.
  public convenience init(
    client: OmniClient, clock: any Clock<Duration> = ContinuousClock(),
    thread: @escaping @MainActor (String) -> (title: String, channelID: String)? = { _ in nil }
  ) {
    self.init(api: client, feed: nil, clock: clock, thread: thread)
    baseURL = client.baseURL
  }

  public func start() {
    guard !started else { return }
    started = true
    if let events {
      feedTask = Task { [weak self, events] in
        for await e in events {
          guard let self else { return }
          self.handle(e)
        }
      }
    } else if let baseURL, let feed = FeedDirectory.feed(for: baseURL) {
      sharedFeed = feed
      feedTicket = feed.subscribe { [weak self] event in
        self?.handle(event)
      }
      // Already open: the next `.open` is a reconnect, so the list refetches. `start` loaded it just now.
      if feed.hasOpened { opened = true }
    }
    feedClient?.start()
    Task { await reload() }
  }

  public func stop() {
    if let feedTicket { sharedFeed?.unsubscribe(feedTicket) }
    feedTicket = nil
    sharedFeed = nil
    feedClient?.close()
    feedTask?.cancel()
    feedTask = nil
    reloadTimer?.cancel()
    reloadTimer = nil
    started = false
  }

  public func reload() async {
    reloadTimer?.cancel()
    reloadTimer = nil
    loads += 1
    let mine = loads
    sinceLoad = [:]
    do {
      let list = try await api.artifacts()
      guard mine == loads else { return }
      gallery = ArtifactGallery(list)
      // Feed events that came while the list was out may be newer than it.
      for a in (sinceLoad ?? [:]).values { _ = gallery.upsert(a, thread: thread) }
      sinceLoad = nil
      loadState = .loaded
    } catch {
      guard mine == loads, error != .cancelled else { return }
      sinceLoad = nil
      loadState = .failed(error)
    }
  }

  private func handle(_ e: SSEEvent<FeedEvent>) {
    switch e {
    case .state(let s):
      guard s == .open else { return }
      let again = opened
      opened = true
      if again { scheduleReload() }
    case .message(.artifact(let a)):
      if sinceLoad != nil { sinceLoad?[a.id] = a }
      if gallery.upsert(a, thread: thread) == .needsReload { scheduleReload() }
    case .message:
      break
    }
  }

  private func scheduleReload() {
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
      await self.reload()
    }
  }
}
