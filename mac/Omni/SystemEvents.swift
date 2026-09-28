import AppKit
import Network
import OmniKit

/// Wake and network changes, passed to the model. App activation comes through the app delegate.
@MainActor
final class SystemEvents {
  private var wake: (any NSObjectProtocol)?
  private var paths: Task<Void, Never>?

  init(model: AppModel) {
    wake = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
    ) { [weak model] _ in
      MainActor.assumeIsolated { model?.didWake() }
    }
    // The monitor sends the current path first. Only later ones are changes.
    paths = Task { [weak model] in
      var last: NWPath?
      for await path in NWPathMonitor() {
        if let last, last != path { model?.networkChanged() }
        last = path
      }
    }
  }

  isolated deinit {
    if let wake { NSWorkspace.shared.notificationCenter.removeObserver(wake) }
    paths?.cancel()
  }
}
