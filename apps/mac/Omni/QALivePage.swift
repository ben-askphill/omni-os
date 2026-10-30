#if DEBUG
import AppKit
import OmniKit
import SwiftUI

/// Calls `tick` once a frame from the display link until it returns false, and times the frames.
@MainActor
final class FrameClock: NSObject {
  private var tick: () -> Bool = { false }
  private var left = 0
  private var last: CFTimeInterval?
  private var gaps: [Double] = []
  private var done: CheckedContinuation<[Double], Never>?

  func run(in view: NSView, frames: Int, _ tick: @escaping () -> Bool) async -> [Double] {
    self.tick = tick
    left = frames
    return await withCheckedContinuation { continuation in
      done = continuation
      view.displayLink(target: self, selector: #selector(frame(_:))).add(to: .main, forMode: .common)
    }
  }

  @objc private func frame(_ link: CADisplayLink) {
    if let last { gaps.append((link.timestamp - last) * 1000) }
    last = link.timestamp
    left -= 1
    guard left <= 0 || !tick() else { return }
    link.invalidate()
    done?.resume(returning: gaps)
    done = nil
  }
}
/// The Browser tab's page view, for live Annotate's steps: mouse events at fractions of the page it shows, which is
/// drawn at the view's full width from its top.
@MainActor
struct QALivePage {
  /// The Browser tab's canvas or the Web tab's input layer.
  let view: NSView
  let frame: BrowserAnnotationContext.LiveFrame

  func event(_ type: NSEvent.EventType, _ x: Double, _ y: Double, option: Bool = false) throws(QAScriptError) -> NSEvent {
    guard let window = view.window, frame.width > 0 else { throw QAScriptError("the page view is not in a window") }
    let width = view.bounds.width, height = width * frame.height / frame.width
    // Both views are flipped: y grows down from the page's top.
    let at = view.convert(NSPoint(x: x * width, y: min(y, 0.999) * height), to: nil)
    guard
      let e = NSEvent.mouseEvent(
        with: type, location: at, modifierFlags: option ? .option : [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
        context: nil, eventNumber: 0, clickCount: type == .mouseMoved ? 0 : 1, pressure: type == .leftMouseUp || type == .mouseMoved ? 0 : 1)
    else { throw QAScriptError("can't make a mouse event") }
    return e
  }

  func mouseMoved(with e: NSEvent) { view.mouseMoved(with: e) }
  func mouseDown(with e: NSEvent) { view.mouseDown(with: e) }
  func mouseDragged(with e: NSEvent) { view.mouseDragged(with: e) }
  func mouseUp(with e: NSEvent) { view.mouseUp(with: e) }

  /// Escape, with the page holding the keys, through the path a key press takes there.
  func escape() {
    guard let window = view.window else { return }
    for type in [NSEvent.EventType.keyDown, .keyUp] {
      guard
        let e = NSEvent.keyEvent(
          with: type, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil,
          characters: "\u{1b}", charactersIgnoringModifiers: "\u{1b}", isARepeat: false, keyCode: LiveAnnotateGesture.escapeKey)
      else { continue }
      if let input = view as? LiveInputView {
        // The web view holds the keys; the input layer sees Escape on its way there.
        if let page = input.page { window.makeFirstResponder(page) }
        if !input.takes(type, keyCode: e.keyCode, option: false, window: window.windowNumber) { window.sendEvent(e) }
      } else {
        window.makeFirstResponder(view)
        type == .keyDown ? view.keyDown(with: e) : view.keyUp(with: e)
      }
    }
  }
}
#endif
