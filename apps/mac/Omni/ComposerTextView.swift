import AppKit
import OmniKit
import SwiftUI

/// What the reply box reports to the view around it.
struct ComposerCallbacks {
  /// Return, or Shift-Cmd-Return with `interrupt`.
  var send: (_ interrupt: Bool) -> Void
  /// Esc with nothing composing. Gets the key's context; true when it took the key.
  var escape: (_ context: EscapeContext) -> Bool
  var files: ([URL]) -> Void
  var image: (Data) -> Void
  var dragTargeted: (Bool) -> Void
  var focusChanged: (Bool) -> Void
  /// The `/` menu's key. True when the menu was open and used it, so the text view leaves it alone.
  var slash: (SlashKey) -> Bool = { _ in false }
  /// The text and caret (a UTF-16 offset) after Ben typed or moved the caret, and when the box takes focus.
  var edited: (_ text: String, _ caret: Int) -> Void = { _, _ in }
  /// Tab with the `/` menu closed. True when it took the key (the reply box's suggestion), else Tab types a tab.
  var tab: () -> Bool = { false }
}

/// A caret position the view sets once, after it changed the text itself (a picked command).
struct CaretRequest: Equatable {
  var id: Int
  var offset: Int
}

/// The reply box's text: an AppKit text view for input methods, spellcheck, undo, and the send keys. It grows
/// with its text up to `maxHeight`, then scrolls.
struct ComposerTextView: NSViewRepresentable {
  @Binding var text: String
  let placeholder: String
  let running: Bool
  let interrupting: Bool
  let focusTick: Int
  let callbacks: ComposerCallbacks
  /// The box's height range: 44 to 240pt for a reply, 60 to 260 for a new thread (96 to 360 on Home).
  var heightRange: ClosedRange<CGFloat> = ComposerTextView.minHeight...ComposerTextView.maxHeight
  var label = "Reply"
  var caretRequest: CaretRequest?
  /// 14.5 in a reply, 16 in the big box on Home.
  var fontSize: CGFloat = 14.5
  /// `UIZoom.settings.scale`, read in the parent's body: the font, inset and height range grow with it.
  var scale: CGFloat = 1
  static let maxHeight: CGFloat = 240
  static let minHeight: CGFloat = 44
  static let font = NSFont.systemFont(ofSize: 14.5)
  static let inset = NSSize(width: 16, height: 11)
  /// `text-fg` and `placeholder:text-fg-4`.
  static let ink = NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(hex: 0xeceae5) : NSColor(hex: 0x17181a) }
  static let quiet = NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(hex: 0x6f6e69) : NSColor(hex: 0x9d9c96) }

  static func font(_ size: CGFloat) -> NSFont { size == 14.5 ? font : NSFont.systemFont(ofSize: size) }

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeNSView(context: Context) -> NSScrollView {
    let scroll = NSScrollView()
    scroll.drawsBackground = false
    scroll.borderType = .noBorder
    scroll.hasVerticalScroller = true
    scroll.autohidesScrollers = true

    let tv = ComposerNSTextView(frame: NSRect(x: 0, y: 0, width: 300, height: Self.minHeight))
    tv.minSize = NSSize(width: 0, height: 0)
    tv.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
    tv.isVerticallyResizable = true
    tv.isHorizontallyResizable = false
    tv.autoresizingMask = [.width]
    tv.textContainer?.widthTracksTextView = true
    tv.textContainer?.lineFragmentPadding = 0
    tv.drawsBackground = false
    tv.isRichText = false
    tv.importsGraphics = false
    tv.allowsUndo = true
    tv.isContinuousSpellCheckingEnabled = true
    tv.isAutomaticSpellingCorrectionEnabled = false
    tv.isAutomaticQuoteSubstitutionEnabled = false
    tv.isAutomaticDashSubstitutionEnabled = false
    tv.textColor = Self.ink
    tv.insertionPointColor = Self.ink
    zoom(tv)
    tv.setAccessibilityLabel(label)
    tv.delegate = context.coordinator
    tv.string = text
    scroll.documentView = tv
    context.coordinator.textView = tv
    return scroll
  }

  func updateNSView(_ scroll: NSScrollView, context: Context) {
    let c = context.coordinator
    c.parent = self
    guard let tv = c.textView else { return }
    tv.callbacks = callbacks
    tv.placeholder = placeholder
    tv.running = running
    tv.interrupting = interrupting
    if tv.font?.pointSize != fontSize * scale { zoom(tv) }
    c.updating = true
    defer { c.updating = false }
    if tv.string != text, !tv.hasMarkedText() {
      tv.string = text
      tv.setSelectedRange(NSRange(location: (text as NSString).length, length: 0))
    }
    if let request = caretRequest, request.id != c.caretID {
      c.caretID = request.id
      tv.setSelectedRange(NSRange(location: max(0, min(request.offset, (tv.string as NSString).length)), length: 0))
    }
    if c.focusTick != focusTick {
      c.focusTick = focusTick
      DispatchQueue.main.async { tv.window?.makeFirstResponder(tv) }
    }
    tv.needsDisplay = true
  }

  /// The font and inset at the zoom.
  private func zoom(_ tv: ComposerNSTextView) {
    let font = Self.font(fontSize * scale)
    tv.font = font
    tv.typingAttributes = [.font: font, .foregroundColor: Self.ink]
    tv.placeholderFont = font
    tv.textContainerInset = NSSize(width: Self.inset.width * scale, height: Self.inset.height * scale)
  }

  func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSScrollView, context: Context) -> CGSize? {
    let width = proposal.width ?? 400
    return CGSize(width: width, height: Self.height(of: text, width: width, range: heightRange.lowerBound * scale...heightRange.upperBound * scale,
                                                      fontSize: fontSize * scale, scale: scale))
  }

  /// The height the text needs at this width, between the minimum and 240pt.
  static func height(of text: String, width: CGFloat, range: ClosedRange<CGFloat> = minHeight...maxHeight, fontSize: CGFloat = 14.5, scale: CGFloat = 1) -> CGFloat {
    let inset = NSSize(width: Self.inset.width * scale, height: Self.inset.height * scale)
    let measured = text.hasSuffix("\n") || text.isEmpty ? text + " " : text
    let box = CGSize(width: max(1, width - inset.width * 2), height: .greatestFiniteMagnitude)
    let rect = (measured as NSString).boundingRect(
      with: box, options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font(fontSize)])
    return min(range.upperBound, max(range.lowerBound, ceil(rect.height) + inset.height * 2))
  }

  @MainActor
  final class Coordinator: NSObject, NSTextViewDelegate {
    var parent: ComposerTextView?
    weak var textView: ComposerNSTextView?
    var focusTick = 0
    var caretID = 0
    /// True while the view sets the text or caret itself: the model already knows.
    var updating = false

    func textDidChange(_ notification: Notification) {
      guard let tv = notification.object as? NSTextView, let parent else { return }
      if parent.text != tv.string { parent.text = tv.string }
      parent.callbacks.edited(tv.string, tv.selectedRange().location)
    }

    func textViewDidChangeSelection(_ notification: Notification) {
      guard !updating, let tv = notification.object as? NSTextView, let parent else { return }
      parent.callbacks.edited(tv.string, tv.selectedRange().location)
    }

    // The arrows, Return and Tab go to the `/` menu while it is open, plain Return sends when it is
    // not, and Tab takes the reply box's suggestion. Shift-Return stays a newline. An input method composing keeps them all.
    func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
      guard let parent, !textView.hasMarkedText() else { return false }
      let key: SlashKey
      switch selector {
      case #selector(NSResponder.moveUp(_:)): key = .up
      case #selector(NSResponder.moveDown(_:)): key = .down
      case #selector(NSResponder.insertTab(_:)):
        return parent.callbacks.slash(.tab) || parent.callbacks.tab()
      case #selector(NSResponder.insertNewline(_:)):
        let flags = NSApp.currentEvent?.modifierFlags.intersection(.deviceIndependentFlagsMask) ?? []
        guard flags.isDisjoint(with: [.shift, .option, .command, .control]) else { return false }
        if !parent.callbacks.slash(.return) { parent.callbacks.send(false) }
        return true
      default: return false
      }
      return parent.callbacks.slash(key)
    }
  }
}

final class ComposerNSTextView: NSTextView {
  var callbacks: ComposerCallbacks?
  var placeholder = ""
  var placeholderFont = ComposerTextView.font
  var running = false
  var interrupting = false
  private var didFocus = false

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    guard !didFocus, let window else { return }
    didFocus = true
    DispatchQueue.main.async { [weak self] in
      guard let self, window.firstResponder === window.contentView || window.firstResponder == nil else { return }
      window.makeFirstResponder(self)
    }
  }

  override func becomeFirstResponder() -> Bool {
    let ok = super.becomeFirstResponder()
    if ok {
      callbacks?.edited(string, selectedRange().location)
      callbacks?.focusChanged(true)
    }
    return ok
  }

  override func resignFirstResponder() -> Bool {
    let ok = super.resignFirstResponder()
    if ok { callbacks?.focusChanged(false) }
    return ok
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    guard string.isEmpty, !hasMarkedText(), !placeholder.isEmpty else { return }
    let origin = textContainerOrigin
    (placeholder as NSString).draw(
      at: NSPoint(x: origin.x + (textContainer?.lineFragmentPadding ?? 0), y: origin.y),
      withAttributes: [.font: placeholderFont, .foregroundColor: ComposerTextView.quiet])
  }

  // Cmd-Return inserts a newline and Shift-Cmd-Return interrupts. Nothing while an input method composes.
  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    if event.type == .keyDown, window?.firstResponder === self, !hasMarkedText(), event.keyCode == 36 || event.keyCode == 76,
      flags.contains(.command), flags.isDisjoint(with: [.option, .control])
    {
      if flags.contains(.shift) { callbacks?.send(true) } else { insertNewlineIgnoringFieldEditor(nil) }
      return true
    }
    return super.performKeyEquivalent(with: event)
  }

  // Esc: the input method gets it first while composing, and a sheet or menu never reaches here.
  override func cancelOperation(_ sender: Any?) {
    if !hasMarkedText(), callbacks?.slash(.escape) == true { return }
    var context = EscapeContext(running: running)
    context.interrupting = interrupting
    context.composing = hasMarkedText()
    let event = NSApp.currentEvent
    context.isRepeat = event?.type == .keyDown && event?.isARepeat == true
    context.hasModifiers = !(event?.modifierFlags.intersection([.command, .control, .option, .shift]).isEmpty ?? true)
    context.menuOrSheetOpen = window?.attachedSheet != nil || NSApp.modalWindow != nil
    if callbacks?.escape(context) != true { super.cancelOperation(sender) }
  }

  // MARK: Paste

  override func paste(_ sender: Any?) {
    let pb = NSPasteboard.general
    if let urls = pb.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
      callbacks?.files(urls)
    } else if pb.string(forType: .string) == nil, let data = Self.pngData(from: pb) {
      callbacks?.image(data)
    } else {
      super.paste(sender)
    }
  }

  private static func pngData(from pb: NSPasteboard) -> Data? {
    if let png = pb.data(forType: .png) { return png }
    guard let tiff = pb.data(forType: .tiff) else { return nil }
    return NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:])
  }

  // MARK: Drops of files. Text drops stay with the text view.

  private func fileURLs(_ info: NSDraggingInfo) -> [URL]? {
    let urls = info.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]
    return urls?.isEmpty == false ? urls : nil
  }

  override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
    guard fileURLs(sender) != nil else { return super.draggingEntered(sender) }
    callbacks?.dragTargeted(true)
    return .copy
  }

  override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
    fileURLs(sender) != nil ? .copy : super.draggingUpdated(sender)
  }

  override func draggingExited(_ sender: (any NSDraggingInfo)?) {
    callbacks?.dragTargeted(false)
    super.draggingExited(sender)
  }

  override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    fileURLs(sender) != nil ? true : super.prepareForDragOperation(sender)
  }

  override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    callbacks?.dragTargeted(false)
    guard let urls = fileURLs(sender) else { return super.performDragOperation(sender) }
    callbacks?.files(urls)
    return true
  }
}
