import Foundation
import Observation

/// Live Annotate in the Browser tab: Annotate on the live page rather than on a screenshot that replaces it. While it is
/// on, the element under the pointer is inspected (`inspect`, one request at a time, the newest point next) and outlined;
/// a click picks the element and a drag marks an area. Either takes a capture at once, so the record is still made on
/// the very image the server took, and a card offers a note, Draw, Add to Message and Send. The page keeps its scrolling,
/// keys and hover states meanwhile, and the outline follows its scroll.
@MainActor @Observable
public final class BrowserLiveAnnotateModel {
  /// What Ben pointed at, before the capture is in. In the live frame's CSS pixels.
  public enum Target: Equatable, Sendable {
    /// A click, with the element the hover had found under it.
    case element(point: CGPoint, inspected: InspectedElement?)
    /// A drag.
    case area(CGRect)
  }

  /// A capture with what Ben marked on it: what the card shows.
  public struct Marked: Equatable, Sendable {
    public let capture: BrowserAnnotationContext.Capture
    /// In the capture's CSS pixels.
    public let rect: BrowserAnnotationContext.Rect
    public let element: BrowserAnnotationContext.Element?
    /// Why a click gave no element, in the server's words. The element's box still goes, as an area.
    public let notice: String?
  }

  public enum Phase: Equatable, Sendable {
    /// Nothing marked: the hover inspects.
    case idle
    /// Taking the capture, then asking the page for the element. `frame` is the live frame the target was marked on.
    case capturing(Target, frame: BrowserAnnotationContext.LiveFrame)
    case marked(Marked)
    /// The capture, the element or the area did not work: why. Close, or a new click, clears it.
    case failed(String)
  }

  public private(set) var isOn = false
  public private(set) var phase = Phase.idle
  /// The element under the pointer. Nil while nothing readable is.
  public private(set) var hovered: InspectedElement?
  public var note = ""
  public private(set) var sending = false
  /// Why the last Send or Add to Message did not work. Everything stays, to try again.
  public private(set) var error: String?
  /// `Sent` or `Added to the message`, until the view lets it go or Ben marks something else.
  public private(set) var confirmation: String?

  public let thread: String
  @ObservationIgnored private let inspect: @Sendable (Int, Int) async throws(OmniAPIError) -> ElementInspectReply
  @ObservationIgnored private let capture: @Sendable (String) async throws(BrowserCaptureError) -> BrowserAnnotationContext.Capture
  @ObservationIgnored private let discard: @Sendable (String) async -> Void
  /// Asks the server for the element at a point of the capture's page: capture file name, x, y.
  @ObservationIgnored private let findElement: @Sendable (String, Int, Int) async throws(OmniAPIError) -> ElementPickReply
  /// Sends a message to the thread now, as the reply box does: the prompt, the one record and the request id.
  @ObservationIgnored private let deliver: @Sendable (String, MessageContext, String) async throws(OmniAPIError) -> Void

  /// The newest point waiting to be inspected, the last one asked, and the loop asking them.
  @ObservationIgnored private var waiting: BrowserAnnotationContext.Point?
  @ObservationIgnored private var lastPoint: BrowserAnnotationContext.Point?
  @ObservationIgnored var inspecting: Task<Void, Never>?
  /// Counts leaves and scrolls, so an answer about the page as it was is dropped.
  @ObservationIgnored private var hoverGeneration = 0
  /// Counts marks and closes, so a capture or element that comes back after Ben moved on is dropped (and deleted).
  @ObservationIgnored private var generation = 0
  /// The record a Send makes, kept with its request id so a retry is the same message.
  @ObservationIgnored private var record: MessageContext?
  @ObservationIgnored private var lastRequest: PendingRequest?

  /// How many times a capture is taken when the page moves under it.
  static let captureTries = 3
  static let noElement = "Element details are unavailable here. The element's box still goes with your message."

  public init(
    thread: String,
    inspect: @escaping @Sendable (Int, Int) async throws(OmniAPIError) -> ElementInspectReply,
    capture: @escaping @Sendable (String) async throws(BrowserCaptureError) -> BrowserAnnotationContext.Capture,
    discard: @escaping @Sendable (String) async -> Void,
    pick: @escaping @Sendable (String, Int, Int) async throws(OmniAPIError) -> ElementPickReply,
    deliver: @escaping @Sendable (String, MessageContext, String) async throws(OmniAPIError) -> Void
  ) {
    self.thread = thread
    self.inspect = inspect
    self.capture = capture
    self.discard = discard
    self.findElement = pick
    self.deliver = deliver
  }

  /// `deliver` is the reply box's send: the app picks the mode and merges the answer into the thread.
  public convenience init(
    client: OmniClient, channel: String, thread: String, deliver: @escaping @Sendable (String, MessageContext, String) async throws(OmniAPIError) -> Void
  ) {
    self.init(
      thread: thread,
      inspect: { x, y throws(OmniAPIError) in try await client.inspectElement(channel: channel, x: x, y: y) },
      capture: { thread throws(BrowserCaptureError) in try await client.captureBrowser(channel: channel, thread: thread) },
      discard: { name in await client.discardCapture(channel: channel, thread: thread, name: name) },
      pick: { name, x, y throws(OmniAPIError) in try await client.pickElement(channel: channel, thread: thread, name: name, x: x, y: y) },
      deliver: deliver)
  }

  // MARK: On and off

  public func toggle() {
    if isOn { turnOff() } else { turnOn() }
  }

  public func turnOn() {
    isOn = true
    error = nil
    confirmation = nil
  }

  /// Off: a capture that was not sent or added is deleted. A send on its way still lands.
  public func turnOff() {
    if !sending { close() }
    leave()
    isOn = false
    confirmation = nil
  }

  /// Escape: clears what is marked, else turns live Annotate off.
  public func escape() {
    if phase == .idle { turnOff() } else { close() }
  }

  // MARK: Hover

  /// The pointer is at `p`, in the live frame's CSS pixels. One request at a time: points that come meanwhile wait, and
  /// only the newest is asked next.
  public func hover(at p: CGPoint) {
    guard isOn else { return }
    let point = BrowserAnnotationContext.Point(x: max(0, Int(p.x.rounded(.down))), y: max(0, Int(p.y.rounded(.down))))
    lastPoint = point
    ask(point)
  }

  /// The pointer left the page, went over the card, or Option made the overlay step aside: nothing is outlined, and an
  /// answer on its way is dropped.
  public func leave() {
    hoverGeneration += 1
    waiting = nil
    lastPoint = nil
    hovered = nil
  }

  /// The page scrolled: what was outlined has moved, so it goes until the element under the pointer is asked again.
  public func scrolled() {
    hoverGeneration += 1
    hovered = nil
    if let p = lastPoint { ask(p) }
  }

  private func ask(_ p: BrowserAnnotationContext.Point) {
    waiting = p
    guard inspecting == nil else { return }
    inspecting = Task { await drain() }
  }

  private func drain() async {
    while let p = waiting {
      waiting = nil
      let mine = hoverGeneration
      let reply: ElementInspectReply?
      do {
        reply = try await inspect(p.x, p.y)
      } catch {
        reply = nil
      }
      guard mine == hoverGeneration, isOn else { continue }
      if case .element(let e)? = reply { hovered = e } else { hovered = nil }
    }
    inspecting = nil
  }

  // MARK: Marking

  /// A click at `point` of the live page (`frame`'s CSS pixels): picks the element there.
  public func pick(at point: CGPoint, frame: BrowserAnnotationContext.LiveFrame) async {
    await mark(.element(point: point, inspected: hovered), frame: frame)
  }

  /// A drag over `rect` of the live page (`frame`'s CSS pixels): marks that area.
  public func drag(_ rect: CGRect, frame: BrowserAnnotationContext.LiveFrame) async {
    await mark(.area(rect), frame: frame)
  }

  private func mark(_ target: Target, frame: BrowserAnnotationContext.LiveFrame) async {
    guard isOn, !sending else { return }
    // A new mark replaces what the card showed: its capture was neither sent nor added.
    dropCapture()
    generation += 1
    let mine = generation
    phase = .capturing(target, frame: frame)
    // What the hover outlined is marked now: its tooltip goes until the pointer moves again.
    hoverGeneration += 1
    waiting = nil
    hovered = nil
    error = nil
    confirmation = nil
    record = nil
    lastRequest = nil
    let c: BrowserAnnotationContext.Capture
    do {
      c = try await takeCapture()
    } catch {
      if mine == generation { phase = .failed(error.message) }
      return
    }
    guard mine == generation, isOn else { return forget(c) }
    switch target {
    case .area(let r):
      guard let rect = BrowserAnnotationContext.liveToCapture(r, frame: frame, capture: c) else {
        forget(c)
        phase = .failed("Draw a larger area.")
        return
      }
      phase = .marked(Marked(capture: c, rect: rect, element: nil, notice: nil))
    case .element(let point, let inspected):
      var reply: ElementPickReply?
      if let at = BrowserAnnotationContext.livePointToCapture(point, frame: frame, capture: c) {
        reply = try? await findElement(c.image.name, at.x, at.y)
      }
      guard mine == generation, isOn else { return forget(c) }
      if case .element(let e)? = reply {
        let rect = BrowserAnnotationContext.elementRect(e.bounds, viewport: (c.viewport.width, c.viewport.height))
        phase = .marked(Marked(capture: c, rect: rect, element: e, notice: nil))
        return
      }
      // No element from the capture's page: the box the hover outlined goes as an area, with the server's reason.
      let message: String = if case .unavailable(_, let m)? = reply, !m.isEmpty { m } else { Self.noElement }
      guard let b = inspected?.bounds,
        let rect = BrowserAnnotationContext.liveToCapture(CGRect(x: b.x, y: b.y, width: b.width, height: b.height), frame: frame, capture: c)
      else {
        forget(c)
        phase = .failed(message)
        return
      }
      phase = .marked(Marked(capture: c, rect: rect, element: nil, notice: message))
    }
  }

  /// The capture, taken again (twice at most) when the page moved while it was taken.
  private func takeCapture() async throws(BrowserCaptureError) -> BrowserAnnotationContext.Capture {
    var tries = 0
    while true {
      do {
        return try await capture(thread)
      } catch {
        tries += 1
        guard error.retryable, error.stale != nil, tries < Self.captureTries else { throw error }
      }
    }
  }

  /// Where the outline goes on the live page now, in `frame`'s CSS pixels. A marked rectangle moves with the page's scroll
  /// since the capture, and is gone once the page is another address. Nil while nothing is marked.
  public func outline(in frame: BrowserAnnotationContext.LiveFrame, url: String) -> CGRect? {
    switch phase {
    case .capturing(let target, let then):
      let r: CGRect? =
        switch target {
        case .area(let r): r
        case .element(_, let e?): CGRect(x: e.bounds.x, y: e.bounds.y, width: e.bounds.width, height: e.bounds.height)
        case .element(_, nil): nil
        }
      guard let r, let was = then.scroll, let now = frame.scroll else { return r }
      return r.offsetBy(dx: was.x - now.x, dy: was.y - now.y)
    case .marked(let m):
      guard url == m.capture.url else { return nil }
      return BrowserAnnotationContext.captureToLive(m.rect, capture: m.capture, frame: frame)
    case .idle, .failed:
      return nil
    }
  }

  // MARK: The card

  /// Close: clears what is marked and deletes its capture.
  public func close() {
    guard !sending else { return }
    dropCapture()
    generation += 1
    phase = .idle
    note = ""
    error = nil
    record = nil
    lastRequest = nil
  }

  public func dismissConfirmation() { confirmation = nil }

  /// Puts the record, with the note, on the reply box. Nil when it went; else why not, and everything stays.
  @discardableResult
  public func add(to draft: DraftContextModel) -> String? {
    guard case .marked(let m) = phase, !sending else { return nil }
    switch BrowserAnnotationContext.annotate(m.capture, rect: m.rect, element: m.element) {
    case .failure(let e):
      error = e.message
      return e.message
    case .success(let body):
      if let refused = draft.add(.make(BrowserAnnotationContext.self, body: body, note: note)) {
        error = refused
        return refused
      }
      finish("Added to the message")
      return nil
    }
  }

  /// Sends a message now: the note is its text, and the record goes with it, without a note of its own. Nil when it went;
  /// else why not, and everything stays, so Send again is the same message.
  @discardableResult
  public func send() async -> String? {
    guard case .marked(let m) = phase, !sending else { return nil }
    let r: MessageContext
    if let made = record {
      r = made
    } else {
      switch BrowserAnnotationContext.annotate(m.capture, rect: m.rect, element: m.element) {
      case .failure(let e):
        error = e.message
        return e.message
      case .success(let body):
        r = .make(BrowserAnnotationContext.self, body: body, note: "")
        record = r
      }
    }
    let prompt = note.trimmingCharacters(in: .whitespacesAndNewlines)
    let request = PendingRequest.next(after: lastRequest, key: PendingRequest.key(prompt: prompt, mode: nil, files: [], context: [r.id]))
    lastRequest = request
    sending = true
    error = nil
    defer { sending = false }
    do {
      try await deliver(prompt, r, request.id)
    } catch {
      self.error = error.message
      return error.message
    }
    finish("Sent")
    return nil
  }

  /// Draw: hands the capture and what is marked on it to the screenshot editor, which now holds the capture. The card
  /// closes without deleting it, and live Annotate stays on under the editor.
  public func handOff() -> (marked: Marked, note: String)? {
    guard case .marked(let m) = phase, !sending else { return nil }
    let n = note
    generation += 1
    phase = .idle
    note = ""
    error = nil
    record = nil
    lastRequest = nil
    return (m, n)
  }

  /// After Send or Add to Message: the capture is the record's now, so it stays.
  private func finish(_ done: String) {
    generation += 1
    phase = .idle
    note = ""
    error = nil
    record = nil
    lastRequest = nil
    confirmation = done
  }

  /// Deletes the card's capture, which nothing was made of.
  private func dropCapture() {
    if case .marked(let m) = phase { forget(m.capture) }
  }

  private func forget(_ c: BrowserAnnotationContext.Capture) {
    let discard = discard, name = c.image.name
    Task { await discard(name) }
  }
}
