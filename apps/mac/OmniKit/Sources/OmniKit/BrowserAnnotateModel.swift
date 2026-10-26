import Foundation
import Observation

/// Annotate in the live Browser panel: capture the channel's browser, let Ben mark the screenshot (tap an element, drag an
/// area, or draw with the toolbar's pen, shapes and text), then put it on the thread's reply box as a browser_annotation.
/// The screenshot is the server's capture, so the marks are drawn on the very image they describe. Nothing here touches the page: the live view is hidden while this shows, and no
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

  // The toolbar: the tool, its style, what has been drawn and the mark selected. Marks are in the page's CSS pixels.
  public var tool = BrowserMarks.Tool.select
  public var style = BrowserMarks.Style()
  public private(set) var marks: [BrowserMarks.Mark] = []
  public private(set) var selected: Int?
  public private(set) var adding = false
  /// The selected mark as it was when Ben took hold of it, so a move is measured from there and not from each step.
  @ObservationIgnored private var grabbed: BrowserMarks.Mark?

  public let thread: String
  @ObservationIgnored private let capture: @Sendable (String) async throws(BrowserCaptureError) -> BrowserAnnotationContext.Capture
  @ObservationIgnored private let discard: @Sendable (String) async -> Void
  /// Asks the server for the element at a point of the screenshot's page: capture file name, x, y.
  @ObservationIgnored private let pick: @Sendable (String, Int, Int) async throws(OmniAPIError) -> ElementPickReply
  /// Renders the marks onto the capture and saves the result: the record's `marked` image.
  @ObservationIgnored private let mark: @Sendable (BrowserAnnotationContext.Capture, [BrowserMarks.Mark]) async throws(OmniAPIError) -> BrowserAnnotationContext.Image
  /// Counts picks and drags, so the answer to a tap that Ben has since dragged over is dropped.
  @ObservationIgnored private var generation = 0

  public init(
    thread: String, capture: @escaping @Sendable (String) async throws(BrowserCaptureError) -> BrowserAnnotationContext.Capture,
    discard: @escaping @Sendable (String) async -> Void,
    pick: @escaping @Sendable (String, Int, Int) async throws(OmniAPIError) -> ElementPickReply = { _, _, _ in .unavailable(reason: "unreadable", message: "") },
    mark: @escaping @Sendable (BrowserAnnotationContext.Capture, [BrowserMarks.Mark]) async throws(OmniAPIError) -> BrowserAnnotationContext.Image = { c, _ in c.image }
  ) {
    self.thread = thread
    self.capture = capture
    self.discard = discard
    self.pick = pick
    self.mark = mark
  }

  public convenience init(client: OmniClient, channel: String, thread: String) {
    self.init(
      thread: thread, capture: { thread throws(BrowserCaptureError) in try await client.captureBrowser(channel: channel, thread: thread) },
      discard: { name in await client.discardCapture(channel: channel, thread: thread, name: name) },
      pick: { name, x, y throws(OmniAPIError) in try await client.pickElement(channel: channel, thread: thread, name: name, x: x, y: y) },
      mark: { capture, marks throws(OmniAPIError) in try await client.uploadMarkedScreenshot(channel: channel, capture: capture, marks: marks) })
  }

  public var isActive: Bool { phase != .idle }

  /// Takes the screenshot. Also what Try again does.
  public func start() async {
    guard phase == .idle || isFailed else { return }
    phase = .capturing
    rect = nil
    error = nil
    clearElement()
    clearMarks()
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

  // MARK: Marks

  private var viewport: (width: Int, height: Int)? {
    if case .picking(let c) = phase { (c.viewport.width, c.viewport.height) } else { nil }
  }

  /// There is something to add: an area or element Ben marked, or marks he drew.
  public var hasMarking: Bool { rect != nil || !marks.isEmpty }

  public func chooseTool(_ t: BrowserMarks.Tool) {
    tool = t
    if t != .select { selected = nil }
  }

  private func push(_ m: BrowserMarks.Mark) {
    guard marks.count < BrowserMarks.marksMax else {
      error = "A message holds at most \(BrowserMarks.marksMax) marks."
      return
    }
    marks.append(m)
    selected = nil
    error = nil
  }

  private func take(_ r: Result<BrowserMarks.Mark, BrowserAnnotationContext.CheckError>) {
    switch r {
    case .success(let m): push(m)
    case .failure(let e): error = e.message
    }
  }

  /// A drag with a shape tool, in the shown screenshot's points.
  public func drawShape(_ drag: BrowserAnnotationContext.Drag, shown: (width: Double, height: Double)) {
    guard let vp = viewport else { return }
    take(BrowserMarks.dragToMark(tool, drag: drag, shown: shown, viewport: vp, style: style))
  }

  /// A pen stroke through shown points.
  public func drawStroke(_ path: [(x: Double, y: Double)], shown: (width: Double, height: Double)) {
    guard let vp = viewport else { return }
    take(BrowserMarks.strokeToMark(path, shown: shown, viewport: vp, style: style))
  }

  /// Words typed at a shown point. Empty words make nothing.
  public func drawText(_ text: String, at point: (x: Double, y: Double), shown: (width: Double, height: Double)) {
    guard let vp = viewport, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    take(BrowserMarks.textToMark(text, at: point, shown: shown, viewport: vp, style: style))
  }

  /// Takes hold of the topmost mark under a shown point. False when there is none (a tap or drag then picks or marks an area).
  public func grab(at point: (x: Double, y: Double), shown: (width: Double, height: Double)) -> Bool {
    guard let vp = viewport, shown.width > 0, shown.height > 0 else { return false }
    let p = BrowserMarks.toPage(x: point.x, y: point.y, shown: shown, viewport: vp)
    let i = BrowserMarks.markAt(marks, x: Double(p[0]), y: Double(p[1]), slop: 6)
    guard i >= 0 else {
      selected = nil
      grabbed = nil
      return false
    }
    selected = i
    grabbed = marks[i]
    style = BrowserMarks.Style(color: marks[i].color, stroke: marks[i].stroke)
    return true
  }

  /// Moves the grabbed mark by a drag of (dx, dy) shown points from where it was taken hold of.
  public func moveGrabbed(dx: Double, dy: Double, shown: (width: Double, height: Double)) {
    guard let vp = viewport, let i = selected, let was = grabbed, shown.width > 0, shown.height > 0, marks.indices.contains(i) else { return }
    marks[i] = BrowserMarks.moveMark(was, dx: dx * Double(vp.width) / shown.width, dy: dy * Double(vp.height) / shown.height, viewport: vp)
  }

  public func releaseGrab() { grabbed = nil }

  public func deleteSelected() {
    guard let i = selected, marks.indices.contains(i) else { return }
    marks.remove(at: i)
    selected = nil
  }

  public func undo() {
    guard !marks.isEmpty else { return }
    marks.removeLast()
    selected = nil
  }

  public func setColor(_ hex: String) {
    style.color = hex
    if let i = selected, marks.indices.contains(i) { marks[i].color = hex }
  }

  public func setStroke(_ n: Int) {
    style.stroke = n
    if let i = selected, marks.indices.contains(i) { marks[i].stroke = n }
  }

  private func clearMarks() {
    marks = []
    selected = nil
    grabbed = nil
    tool = .select
  }

  /// Puts the marking and the note on the reply box. With marks it first renders them onto the screenshot and saves that, so
  /// the agent sees them. Nil when it went; else why not, and nothing changes.
  @discardableResult
  public func add(to draft: DraftContextModel) async -> String? {
    guard case .picking(let c) = phase, !adding else { return nil }
    // The area the record points at: the one picked or dragged, else the box the marks cover.
    guard let area = rect ?? BrowserMarks.marksRect(marks, viewport: (c.viewport.width, c.viewport.height), min: BrowserAnnotationContext.rectMin).map({
      BrowserAnnotationContext.Rect(x: $0.x, y: $0.y, width: $0.width, height: $0.height)
    }) else { return "Mark the part of the page you mean." }
    adding = true
    defer { adding = false }
    var marked: BrowserAnnotationContext.Image?
    if !marks.isEmpty {
      do {
        marked = try await mark(c, marks)
      } catch {
        self.error = error.message
        return error.message
      }
    }
    switch BrowserAnnotationContext.annotate(c, rect: area, element: element, marks: marks, marked: marked) {
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
    clearMarks()
  }
}
