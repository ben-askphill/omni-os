#if DEBUG
import AppKit
import OmniKit
import SwiftUI
import WebKit

/// The QA steps that shoot the app: menus, the main window with what is over it, and snapshots of every window.
extension QARunner {
  /// Right-clicks the folder's row, shoots the screen while its menu is open, then closes the menu.
  func menu(on folder: FolderWithThreads, shot: String) async throws(QAScriptError) {
    guard let frame = QAFolderProbe.frames[folder.id] else { throw QAScriptError("the folder \(folder.name) is not on screen") }
    try await shootMenu(at: NSPoint(x: frame.minX + 60, y: frame.midY), button: .rightMouseDown, shot: shot, what: folder.name)
  }

  /// Clicks the thread header's ⋯ menu button and shoots the screen while the menu is open.
  func handoffMenu(shot: String) async throws(QAScriptError) {
    guard let frame = QAHandoffProbe.button else { throw QAScriptError("no thread actions button on screen") }
    try await shootMenu(at: NSPoint(x: frame.midX, y: frame.midY), button: .leftMouseDown, shot: shot, what: "the thread actions button")
  }

  /// Clicks `spot` (global, top-left origin) in the main window, shoots the screen once a menu opens, then closes it.
  func shootMenu(at spot: NSPoint, button: NSEvent.EventType, shot: String, what: String) async throws(QAScriptError) {
    guard let window = Self.windows.first(where: Self.isMain), let content = window.contentView else {
      throw QAScriptError("no main window")
    }
    let point = content.convert(content.isFlipped ? spot : NSPoint(x: spot.x, y: content.bounds.height - spot.y), to: nil)
    guard
      let event = NSEvent.mouseEvent(
        with: button, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
    else { throw QAScriptError("can't make the click") }
    final class Outcome: @unchecked Sendable { var failure: QAScriptError? }
    let outcome = Outcome()
    let observer = NotificationCenter.default.addObserver(
      forName: NSMenu.didBeginTrackingNotification, object: nil, queue: nil
    ) { note in
      nonisolated(unsafe) let menu = note.object as? NSMenu
      // This step's job holds the main queue while the menu tracks, so a run loop timer (common modes) shoots it.
      let timer = Timer(timeInterval: 0.8, repeats: false) { _ in
        MainActor.assumeIsolated {
          do throws(QAScriptError) { try self.shoot(window, to: shot) } catch { outcome.failure = error }
          menu?.cancelTracking()
        }
      }
      RunLoop.main.add(timer, forMode: .common)
    }
    defer { NotificationCenter.default.removeObserver(observer) }
    // Returns once the menu closes.
    window.sendEvent(event)
    // A button menu opens on the click's release, not its press.
    if button == .leftMouseDown, !FileManager.default.fileExists(atPath: out.appending(path: shot + ".png").path),
      let up = NSEvent.mouseEvent(
        with: .leftMouseUp, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 0)
    {
      window.sendEvent(up)
      try? await Task.sleep(for: .milliseconds(1500))
    }
    if let failure = outcome.failure { throw failure }
    guard FileManager.default.fileExists(atPath: out.appending(path: shot + ".png").path) else {
      throw QAScriptError("no menu opened on \(what)")
    }
  }

  /// The main window with what is over it (sheets, menus).
  func screen(_ name: String) async throws(QAScriptError) {
    guard let window = Self.windows.first(where: Self.isMain) else { throw QAScriptError("no main window") }
    try? await Task.sleep(for: .milliseconds(700))
    try shoot(window, to: name)
  }

  /// The main window drawn as `snapshot` draws it, with the app's windows over it (a sheet, an open menu) drawn
  /// in place on top. No screen capture, so it works with the screen locked and with no permission.
  func shoot(_ window: NSWindow, to name: String) throws(QAScriptError) {
    guard let base = Self.render(window), let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(
        data: nil, width: base.width, height: base.height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { throw QAScriptError("can't render \(name).png") }
    let scale = CGFloat(base.width) / max(window.frame.width, 1)
    context.draw(base, in: CGRect(x: 0, y: 0, width: base.width, height: base.height))
    let over = NSApp.windows
      .filter { $0 !== window && $0.isVisible && $0.frame.intersects(window.frame) }
      .sorted { ($0.level.rawValue, $0.orderedIndex * -1) < ($1.level.rawValue, $1.orderedIndex * -1) }
    for w in over {
      guard let root = w.contentView?.superview ?? w.contentView, let image = Self.cache(root) else { continue }
      let f = w.frame
      context.draw(
        image,
        in: CGRect(
          x: (f.minX - window.frame.minX) * scale, y: (f.minY - window.frame.minY) * scale,
          width: f.width * scale, height: f.height * scale))
    }
    guard let image = context.makeImage(),
      let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    else { throw QAScriptError("can't encode \(name).png") }
    do {
      try png.write(to: out.appending(path: name + ".png"))
    } catch {
      throw QAScriptError("can't write \(name).png: \(error.localizedDescription)")
    }
  }

  static func scrollViews(in view: NSView) -> [NSScrollView] {
    (view as? NSScrollView).map { [$0] } ?? view.subviews.flatMap(scrollViews)
  }

  static var windows: [NSWindow] {
    NSApp.windows
      .filter { $0.isVisible && (($0.styleMask.contains(.titled) && !($0 is NSPanel)) || $0.identifier == QuickPromptPanel.identifier) }
      .sorted { $0.windowNumber < $1.windowNumber }
  }

  static func isSettings(_ window: NSWindow) -> Bool {
    window.identifier?.rawValue.localizedCaseInsensitiveContains("settings") == true
  }

  static func isMain(_ window: NSWindow) -> Bool {
    window.identifier?.rawValue.hasPrefix("main") == true
  }
  /// Writes `<name>.png` for the main window, `<name>-settings.png` for Settings, `<name>-window<n>.png`
  /// for anything else, and fails when one comes out blank.
  func snapshot(_ name: String) async throws(QAScriptError) -> [String] {
    // A window can take a moment to come up after launch.
    let deadline = ContinuousClock.now + .seconds(5)
    while Self.windows.isEmpty, ContinuousClock.now < deadline {
      try? await Task.sleep(for: .milliseconds(100))
    }
    try? await Task.sleep(for: .milliseconds(400))
    let windows = Self.windows
    guard !windows.isEmpty else { throw QAScriptError("no window to snapshot") }
    let pages = await Self.paintWebViews(in: windows)
    defer { pages.forEach { $0.removeFromSuperview() } }
    pending = []
    var blank: [String] = []
    var others = 0
    for window in windows {
      let file: String
      if Self.isSettings(window) {
        file = "\(name)-settings.png"
      } else if Self.isMain(window) {
        file = "\(name).png"
      } else {
        others += 1
        file = "\(name)-window\(others).png"
      }
      guard let image = Self.render(window) else { throw QAScriptError("can't render \(file)") }
      if QASnapshot.looksBlank(pixels: Self.pixels(image)) { blank.append(file) }
      guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
        throw QAScriptError("can't encode \(file)")
      }
      do {
        try png.write(to: out.appending(path: file))
      } catch {
        throw QAScriptError("can't write \(file): \(error.localizedDescription)")
      }
      pending.append(file)
    }
    if !blank.isEmpty { throw QAScriptError("blank: \(blank.joined(separator: ", "))") }
    return pending
  }
}
#endif
