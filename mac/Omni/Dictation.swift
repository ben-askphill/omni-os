import AppKit
import SwiftUI

/// Wispr Flow's hands-free dictation, started and stopped through its URL scheme. Flow types what it
/// hears into the focused field, so the composer takes focus before Flow starts listening.
/// Flow handles these two links without showing its window, so focus stays in Omni.
@MainActor
enum WisprFlow {
  private static let start = URL(string: "wispr-flow://start-hands-free")!
  private static let stop = URL(string: "wispr-flow://stop-hands-free")!

  /// Whether an app on this Mac takes `wispr-flow://` links.
  static var isInstalled: Bool { NSWorkspace.shared.urlForApplication(toOpen: start) != nil }

  static func setListening(_ on: Bool) {
    let config = NSWorkspace.OpenConfiguration()
    config.activates = false
    NSWorkspace.shared.open(on ? start : stop, configuration: config)
  }
}

/// The mic beside the paperclip: starts Wispr Flow hands-free, and stops it on the second click.
/// Flow does not say when it stops on its own (its hotkey, a timeout), so the button can read
/// Listening after Flow has stopped; a click then only resets it.
struct DictateButton: View {
  /// Puts the caret in the composer, where Flow pastes.
  let focus: () -> Void
  @State private var listening = false
  @State private var installed = WisprFlow.isInstalled

  var body: some View {
    if installed {
      Button {
        focus()
        listening.toggle()
        let on = listening
        // One runloop turn, so the text view is first responder before Flow reads the focus.
        DispatchQueue.main.async { WisprFlow.setListening(on) }
      } label: {
        Image(systemName: listening ? "mic.fill" : "mic")
          .foregroundStyle(listening ? Tok.needs : Tok.fg3)
          .symbolEffect(.pulse, isActive: listening)
      }
      .buttonStyle(.icon(size: 30, active: listening))
      .help(listening ? "Stop Wispr Flow" : "Dictate with Wispr Flow")
      .accessibilityLabel(listening ? "Stop dictating" : "Dictate")
    }
  }
}
