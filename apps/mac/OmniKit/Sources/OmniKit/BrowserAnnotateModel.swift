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
  public var note = ""

  public let thread: String
  @ObservationIgnored private let capture: @Sendable (String) async throws(BrowserCaptureError) -> BrowserAnnotationContext.Capture
  @ObservationIgnored private let discard: @Sendable (String) async -> Void

  public init(
    thread: String, capture: @escaping @Sendable (String) async throws(BrowserCaptureError) -> BrowserAnnotationContext.Capture,
    discard: @escaping @Sendable (String) async -> Void
  ) {
    self.thread = thread
    self.capture = capture
    self.discard = discard
  }

  public convenience init(client: OmniClient, channel: String, thread: String) {
    self.init(
      thread: thread, capture: { thread throws(BrowserCaptureError) in try await client.captureBrowser(channel: channel, thread: thread) },
      discard: { name in await client.discardCapture(channel: channel, thread: thread, name: name) })
  }

  public var isActive: Bool { phase != .idle }

  /// Takes the screenshot. Also what Try again does.
  public func start() async {
    guard phase == .idle || isFailed else { return }
    phase = .capturing
    rect = nil
    error = nil
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
    switch BrowserAnnotationContext.dragToRect(drag, shown: shown, viewport: (Double(c.viewport.width), Double(c.viewport.height))) {
    case .success(let r):
      rect = r
      error = nil
    case .failure(let e):
      error = e.message
    }
  }

  public func redraw() {
    rect = nil
    error = nil
  }

  /// Puts the rectangle and the note on the reply box. Nil when it went; else why not, and nothing changes.
  @discardableResult
  public func add(to draft: DraftContextModel) -> String? {
    guard case .picking(let c) = phase, let rect else { return "Drag over the part of the page you mean." }
    switch BrowserAnnotationContext.annotate(c, rect: rect) {
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
    phase = .idle
    rect = nil
    note = ""
    error = nil
  }
}
