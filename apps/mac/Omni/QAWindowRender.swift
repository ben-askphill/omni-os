#if DEBUG
import AppKit
import SwiftUI
import WebKit

/// How the QA harness draws the app's windows to images: web views painted over, table rows and cells composed, popovers
/// and terminals added. Split out of QARunner.swift; `QARunner.snapshot` and `shoot` call these.
extension QARunner {
  /// WebKit stops painting a web view a few seconds after its window is last on screen, and the harness's windows are
  /// not, so `cacheDisplay` draws a page that has sat a while as blank. Each shown web view gets its own snapshot laid just
  /// over it, under whatever is drawn over the page (live Annotate's outline, tooltip and card). Remove them once drawn.
  static func paintWebViews(in windows: [NSWindow]) async -> [NSView] {
    var laid: [NSView] = []
    for window in windows {
      guard let root = window.contentView else { continue }
      let shown = descendants(of: root).compactMap { $0 as? WKWebView }.filter { web in
        guard !web.isHiddenOrHasHiddenAncestor, web.bounds.width > 0, web.bounds.height > 0 else { return false }
        var v: NSView? = web
        while let view = v {
          if view.alphaValue == 0 || view.layer?.opacity == 0 { return false }
          v = view.superview
        }
        return true
      }
      for web in shown {
        let config = WKSnapshotConfiguration()
        config.afterScreenUpdates = true
        guard let image = try? await web.takeSnapshot(configuration: config), let superview = web.superview else { continue }
        let view = NSImageView(frame: web.frame)
        view.image = image
        view.imageScaling = .scaleAxesIndependently
        superview.addSubview(view, positioned: .above, relativeTo: web)
        laid.append(view)
      }
    }
    return laid
  }

  /// The window's frame view, title bar and toolbar included, drawn the way AppKit caches a view.
  ///
  /// `cacheDisplay` leaves out the rows of a sidebar list: its scroll view, inside the sidebar's glass,
  /// draws nothing. So each table row's cells are drawn on their own and laid over the capture, with a
  /// plain rounded highlight under a selected row, where the system draws its own.
  static func render(_ window: NSWindow) -> CGImage? {
    guard let root = window.contentView?.superview ?? window.contentView, let base = cache(root) else { return nil }
    let rows = descendants(of: root).compactMap { $0 as? NSTableRowView }.filter { !$0.isHiddenOrHasHiddenAncestor }
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(
        data: nil, width: base.width, height: base.height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      )
    else { return base }
    let scale = CGFloat(base.width) / max(root.bounds.width, 1)
    let whole = CGRect(x: 0, y: 0, width: base.width, height: base.height)
    // The glass sidebar and title bar come out see-through. On screen the desktop shows through them.
    var backdrop = NSColor.windowBackgroundColor.cgColor
    window.effectiveAppearance.performAsCurrentDrawingAppearance {
      backdrop = NSColor.windowBackgroundColor.usingColorSpace(.sRGB)?.cgColor ?? backdrop
    }
    context.setFillColor(backdrop)
    context.fill(whole)
    context.draw(base, in: whole)

    // A rect in root coordinates, in the context's pixels, origin bottom left.
    func pixels(_ rect: NSRect) -> CGRect {
      let y = root.isFlipped ? root.bounds.height - rect.maxY : rect.minY
      return CGRect(x: rect.minX * scale, y: y * scale, width: rect.width * scale, height: rect.height * scale)
    }

    for row in rows where row.frame.height > 0 {
      context.saveGState()
      // Only where rows show: not under the title bar or a bar laid over the list's edge.
      if let scroll = row.enclosingScrollView {
        let clip = scroll.contentView
        let insets = scroll.contentInsets
        var visible = clip.convert(clip.bounds, to: root)
        visible.origin.y += root.isFlipped ? insets.top : insets.bottom
        visible.size.height -= insets.top + insets.bottom
        context.clip(to: pixels(visible))
      }
      if row.isSelected {
        let rect = pixels(row.convert(row.bounds, to: root).insetBy(dx: 10, dy: 1))
        let color = window.isKeyWindow ? NSColor.selectedContentBackgroundColor : NSColor.unemphasizedSelectedContentBackgroundColor
        context.setFillColor(color.usingColorSpace(.sRGB)?.cgColor ?? color.cgColor)
        context.addPath(CGPath(roundedRect: rect, cornerWidth: 8 * scale, cornerHeight: 8 * scale, transform: nil))
        context.fillPath()
      }
      // Cells and section headers only. The row's own selection and separator views come out black.
      for cell in row.subviews where !cell.isHidden && cell.frame.height > 0 && Self.isCell(cell) {
        if let image = cache(cell) {
          context.draw(image, in: pixels(cell.convert(cell.bounds, to: root)))
        }
      }
      context.restoreGState()
    }
    // A terminal (SwiftTerm) comes out shifted and clipped in the window's cache. Drawn on its own it is right.
    for term in descendants(of: root) where "\(type(of: term))" == "TerminalView" && !term.isHiddenOrHasHiddenAncestor {
      if let image = cache(term) {
        context.draw(image, in: pixels(term.convert(term.bounds, to: root)))
      }
    }
    // An open popover is a window of its own, untitled, so it is drawn over the window it hangs from.
    for pop in NSApp.windows where pop.isVisible && pop.parent === window && "\(type(of: pop))".contains("Popover") {
      guard let view = pop.contentView, let image = cache(view) else { continue }
      let rect = view.convert(view.bounds, to: nil)
      let onScreen = pop.convertToScreen(rect)
      let inWindow = window.convertFromScreen(onScreen)
      let frame = CGRect(x: inWindow.minX * scale, y: inWindow.minY * scale, width: inWindow.width * scale, height: inWindow.height * scale)
      context.saveGState()
      context.setShadow(offset: CGSize(width: 0, height: -4 * scale), blur: 18 * scale, color: NSColor.black.withAlphaComponent(0.18).cgColor)
      context.addPath(CGPath(roundedRect: frame, cornerWidth: 10 * scale, cornerHeight: 10 * scale, transform: nil))
      context.setFillColor(backdrop)
      context.fillPath()
      context.restoreGState()
      context.saveGState()
      context.addPath(CGPath(roundedRect: frame, cornerWidth: 10 * scale, cornerHeight: 10 * scale, transform: nil))
      context.clip()
      context.draw(image, in: frame)
      context.restoreGState()
    }
    return context.makeImage() ?? base
  }

  static func isCell(_ view: NSView) -> Bool {
    let name = "\(type(of: view))"
    return view is NSTableCellView || name.contains("Cell") || name.contains("Header")
  }

  static func cache(_ view: NSView) -> CGImage? {
    view.layoutSubtreeIfNeeded()
    guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
    view.cacheDisplay(in: view.bounds, to: rep)
    return rep.cgImage
  }

  static func descendants(of view: NSView) -> [NSView] {
    view.subviews + view.subviews.flatMap { descendants(of: $0) }
  }

  /// The image at half size as RGBA words, for the blank check.
  static func pixels(_ image: CGImage) -> [UInt32] {
    let width = max(1, image.width / 2), height = max(1, image.height / 2)
    var buffer = [UInt32](repeating: 0, count: width * height)
    buffer.withUnsafeMutableBytes { raw in
      guard
        let space = CGColorSpace(name: CGColorSpace.sRGB),
        let context = CGContext(
          data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space,
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )
      else { return }
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    }
    return buffer
  }
}
#endif
