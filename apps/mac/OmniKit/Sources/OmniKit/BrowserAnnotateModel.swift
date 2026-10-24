import Foundation
import Observation

/// Annotate in the live Browser panel: capture the channel's browser, let Ben drag a rectangle on the screenshot, then
/// put it on the thread's reply box as a browser_annotation. The screenshot is the server's capture, so the rectangle is
/// drawn on the very image it describes. Nothing here touches the page: the live view is hidden while this shows, and no
/// input goes to it.
@MainActor @Observable
public final class BrowserAnnotateModel {
  public enum Phase: Equatable, Sendable {
    case idle
    /// Waiting for the server's screenshot.
    case capturing
    /// The capture failed. `retryable`: Try again can work.
    case failed(BrowserCaptureError)
    /// The screenshot is shown, to draw on.
    case picking(BrowserAnnotationContext.Capture)
  }

  public private(set) var phase = Phase.idle
  /// What Ben drew, once it is big enough.
  public private(set) var rect: BrowserAnnotationContext.Rect?
  /// Why the last drag or Add to Message did not work.
  public private(set) var error: String?
  /// The element Ben tapped, when the page could give it. Nil with a rectangle is a screenshot-only annotation.
  public private(set) var element: BrowserAnnotationContext.Element?
  /// Why a tap gave no element, in the server's words. The rectangle he drags instead still works.
  public private(set) var notice: String?
  public private(set) var picking = false
  public var note = ""

  public let thread: String
  @ObservationIgnored private let capture: @Sendable (String) async throws(BrowserCaptureError) -> BrowserAnnotationContext.Capture
  @ObservationIgnored private let discard: @Sendable (String) async -> Void
  /// Asks the server for the element at a point of the screenshot's page: capture file name, x, y.
  @ObservationIgnored private let pick: @Sendable (String, Int, Int) async throws(OmniAPIError) -> ElementPickReply
  /// Counts picks and drags, so the answer to a tap that Ben has since dragged over is dropped.
  @ObservationIgnored private var generation = 0

  public init(
    thread: String, capture: @escaping @Sendable (String) async throws(BrowserCaptureError) -> BrowserAnnotationContext.Capture,
    discard: @escaping @Sendable (String) async -> Void,
    pick: @escaping @Sendable (String, Int, Int) async throws(OmniAPIError) -> ElementPickReply = { _, _, _ in .unavailable(reason: "unreadable", message: "") }
  ) {
    self.thread = thread
    self.capture = capture
    self.discard = discard
    self.pick = pick
  }

  public convenience init(client: OmniClient, channel: String, thread: String) {
    self.init(
      thread: thread, capture: { thread throws(BrowserCaptureError) in try await client.captureBrowser(channel: channel, thread: thread) },
      discard: { name in await client.discardCapture(channel: channel, thread: thread, name: name) },
      pick: { name, x, y throws(OmniAPIError) in try await client.pickElement(channel: channel, thread: thread, name: name, x: x, y: y) })
  }

  public var isActive: Bool { phase != .idle }

  /// Takes the screenshot. Also what Try again does.
  public func start() async {
    guard phase == .idle || isFailed else { return }
    phase = .capturing
    rect = nil
    error = nil
    clearElement()
    do {
      phase = .picking(try await capture(thread))
    } catch {
      phase = .failed(error)
    }
  }

  private var isFailed: Bool { if case .failed = phase { true } else { false } }

  /// Ben's drag on the screenshot, shown `shown` points big. Too small a drag says so and keeps the last rectangle.
  public func drag(_ drag: BrowserAnnotationContext.Drag, shown: (width: Double, height: Double)) {
    guard case .picking(let c) = phase else { return }
    generation += 1
    picking = false
    switch BrowserAnnotationContext.dragToRect(drag, shown: shown, viewport: (Double(c.viewport.width), Double(c.viewport.height))) {
    case .success(let r):
      // A dragged area is the whole of what Ben marked: an element picked before it no longer describes it.
      rect = r
      error = nil
      clearElement()
    case .failure(let e):
      error = e.message
    }
  }

  /// A tap on the screenshot at `point` (its shown points, `shown` big): asks the page what element is there. An element
  /// marks its own bounds. Anything the page cannot give leaves the screenshot as it is, says why, and a drag still works.
  public func tap(at point: (x: Double, y: Double), shown: (width: Double, height: Double)) async {
    guard case .picking(let c) = phase, shown.width > 0, shown.height > 0 else { return }
    let x = min(c.viewport.width - 1, max(0, Int((point.x * Double(c.viewport.width) / shown.width).rounded(.down))))
    let y = min(c.viewport.height - 1, max(0, Int((point.y * Double(c.viewport.height) / shown.height).rounded(.down))))
    generation += 1
    let mine = generation
    picking = true
    error = nil
    let reply: ElementPickReply?
    do {
      reply = try await pick(c.image.name, x, y)
    } catch {
      reply = nil
    }
    guard mine == generation, case .picking = phase else { return }
    picking = false
    switch reply {
    case .element(let e)?:
      element = e
      notice = nil
      rect = BrowserAnnotationContext.elementRect(e.bounds, viewport: (c.viewport.width, c.viewport.height))
    case .unavailable(_, let message)?:
      element = nil
      notice = message.isEmpty ? Self.noElement : message
    case nil:
      element = nil
      notice = Self.noElement
    }
  }

  static let noElement = "Element details are unavailable for this page. Drag over the area instead: the screenshot goes with your message."

  private func clearElement() {
    element = nil
    notice = nil
  }

  public func redraw() {
    generation += 1
    picking = false
    rect = nil
    error = nil
    clearElement()
  }

  /// Puts the rectangle and the note on the reply box. Nil when it went; else why not, and nothing changes.
  @discardableResult
  public func add(to draft: DraftContextModel) -> String? {
    guard case .picking(let c) = phase, let rect else { return "Drag over the part of the page you mean." }
    switch BrowserAnnotationContext.annotate(c, rect: rect, element: element) {
    case .failure(let e):
      error = e.message
      return e.message
    case .success(let body):
      if let refused = draft.add(.make(BrowserAnnotationContext.self, body: body, note: note)) {
        error = refused
        return refused
      }
      reset()
      return nil
    }
  }

  /// Leaves. A screenshot that was never made into a record is deleted.
  public func cancel() {
    if case .picking(let c) = phase {
      let discard = discard, name = c.image.name
      Task { await discard(name) }
    }
    reset()
  }

  private func reset() {
    generation += 1
    picking = false
    clearElement()
    phase = .idle
    rect = nil
    note = ""
    error = nil
  }
}
