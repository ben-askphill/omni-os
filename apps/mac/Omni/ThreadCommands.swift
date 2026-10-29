import OmniKit
import SwiftUI

/// The Thread menu: Interrupt (Cmd-period, like Esc in the reply box), Take Over and Hand Off to, on the thread the
/// focused window shows (a thread window or the main window).
struct ThreadCommands: Commands {
  let model: AppModel

  var body: some Commands {
    CommandMenu("Thread") {
      InterruptCommand(model: model)
      TakeOverCommand(model: model)
      HandOffCommand(model: model)
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

/// Take Over from <Mac>…, which raises the reply box's confirm. Disabled unless another Mac holds the thread and it can
/// be taken now.
private struct TakeOverCommand: View {
  let model: AppModel
  @FocusedValue(\.shownThread) private var shown

  var body: some View {
    let store = shown.flatMap { model.threads.store($0.id) }
    Button(store?.takeover.map { "Take Over from \($0.from.name)…" } ?? "Take Over…") {
      store?.askTakeOver()
    }
    .disabled(!(store?.canTakeOver ?? false))
  }
}

private struct HandOffCommand: View {
  let model: AppModel
  @FocusedValue(\.shownThread) private var shown

  var body: some View {
    if let shown, model.devices.targets(model.threads.store(shown.id)) != nil {
      Divider()
      HandOffMenu(model: model, threadID: shown.id)
    }
  }
}
