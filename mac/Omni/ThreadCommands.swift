import OmniKit
import SwiftUI

/// The Thread menu: Interrupt, on the thread that is open. Cmd-period, like Esc in the reply box.
struct ThreadCommands: Commands {
  let model: AppModel

  private var openStore: ThreadStore? {
    guard model.serverScreen == nil, case .thread(let id, _) = model.route else { return nil }
    return model.threads.store(id)
  }

  var body: some Commands {
    CommandMenu("Thread") {
      let store = openStore
      Button(store?.interrupting == true ? "Interrupting" : "Interrupt") {
        if let store { Task { await store.interrupt() } }
      }
      .keyboardShortcut(".", modifiers: .command)
      .disabled(store.map { !$0.running || $0.interrupting } ?? true)
    }
  }
}
