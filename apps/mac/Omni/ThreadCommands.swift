import OmniKit
import SwiftUI

/// The Thread menu: Interrupt, on the thread the focused window shows (a thread window or the main window).
/// Cmd-period, like Esc in the reply box.
struct ThreadCommands: Commands {
  let model: AppModel

  var body: some Commands {
    CommandMenu("Thread") {
      InterruptCommand(model: model)
    }
  }
}

private struct InterruptCommand: View {
  let model: AppModel
  @FocusedValue(\.shownThread) private var shown

  var body: some View {
    let store = shown.flatMap { model.threads.store($0.id) }
    Button(store?.interrupting == true ? "Interrupting" : "Interrupt") {
      if let store { Task { await store.interrupt() } }
    }
    .keyboardShortcut(".", modifiers: .command)
    .disabled(store.map { !$0.running || $0.interrupting } ?? true)
  }
}
