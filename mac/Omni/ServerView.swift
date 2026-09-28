import AppKit
import OmniKit
import SwiftUI

/// Shown in place of the route while there is no server to talk to: looking, not running, starting,
/// stopping, or what went wrong.
struct ServerView: View {
  let model: AppModel
  let screen: ServerScreen

  var body: some View {
    Group {
      switch screen {
      case .looking(let port):
        progress("Looking for the server on port \(port)")
      case .starting(let port):
        progress("Starting the server on port \(port)")
      case .stopping(let port):
        progress("Stopping the server on port \(port)")
      case .notRunning(let port, let repo):
        notRunning(port: port, repo: repo)
      case .failed(let message, let logTail):
        failed(message: message, logTail: logTail)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private func progress(_ text: String) -> some View {
    ProgressView {
      Text(text)
    }
  }

  private func notRunning(port: Int, repo: String) -> some View {
    VStack(spacing: 20) {
      Image(systemName: "server.rack")
        .font(.system(size: 40))
        .foregroundStyle(.secondary)
      VStack(spacing: 6) {
        Text("The Omni server is not running")
          .font(.title2.weight(.semibold))
        Text("Start it here, or run npm start in the repo. It keeps running when the app quits.")
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
      ServerDetails(port: port, repo: repo, node: model.settings.nodePath)
      HStack {
        Button("Start Server") { Task { await model.startServer() } }
          .buttonStyle(.borderedProminent)
          .keyboardShortcut(.defaultAction)
        Button("Check Again") { Task { await model.checkAgain() } }
        SettingsLink { Text("Settings…") }
      }
      .controlSize(.large)
    }
    .frame(maxWidth: 520)
    .padding(32)
  }

  private func failed(message: String, logTail: [String]) -> some View {
    VStack(spacing: 16) {
      Image(systemName: "exclamationmark.triangle.fill")
        .font(.system(size: 36))
        .foregroundStyle(.yellow)
      VStack(spacing: 6) {
        Text("Server problem")
          .font(.title2.weight(.semibold))
        Text(message)
          .multilineTextAlignment(.center)
          .textSelection(.enabled)
      }
      if !logTail.isEmpty {
        LogTail(lines: logTail)
      }
      HStack {
        if model.supervisor.state.canStart {
          Button("Try Again") { Task { await model.startServer() } }
            .buttonStyle(.borderedProminent)
        }
        if logExists(model) {
          Button("Open Log") { openLog(model) }
        }
        if model.supervisor.canStop {
          Button("Stop Server") { confirmStop(model) }
        }
        Button("Check Again") { Task { await model.checkAgain() } }
        SettingsLink { Text("Settings…") }
      }
      .controlSize(.large)
    }
    .frame(maxWidth: 640)
    .padding(32)
  }
}

struct ServerDetails: View {
  let port: Int
  let repo: String
  let node: String

  var body: some View {
    GroupBox {
      Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
        GridRow {
          Text("Port").foregroundStyle(.secondary)
          Text(verbatim: "\(port)").monospacedDigit()
        }
        GridRow {
          Text("Repo").foregroundStyle(.secondary)
          Text(repo).truncationMode(.middle).textSelection(.enabled)
        }
        GridRow {
          Text("Node").foregroundStyle(.secondary)
          Text(node.isEmpty ? "Detect automatically" : node).truncationMode(.middle).textSelection(.enabled)
        }
      }
      .lineLimit(1)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(4)
    }
  }
}

/// The last lines the server wrote before it failed.
struct LogTail: View {
  let lines: [String]

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Last lines of the log")
        .font(.caption)
        .foregroundStyle(.secondary)
      // As tall as the lines, and it scrolls from the bottom past 220 points.
      ScrollView { text }
        .defaultScrollAnchor(.bottom)
        .frame(maxHeight: 220)
        .fixedSize(horizontal: false, vertical: true)
      .background(Color(nsColor: .textBackgroundColor), in: .rect(cornerRadius: 8))
      .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
    }
  }

  private var text: some View {
    Text(lines.joined(separator: "\n"))
      .font(.system(.caption, design: .monospaced))
      .textSelection(.enabled)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(10)
  }
}

/// Start, Stop, Check Again and Open Log, for the Server menu and the toolbar.
struct ServerMenuItems: View {
  let model: AppModel
  let shortcuts: Bool

  var body: some View {
    let state = model.supervisor.state
    Text("Port \(model.settings.port, format: .number.grouping(.never)): \(state.label)")
    Divider()
    Button("Start Server") { Task { await model.startServer() } }
      .disabled(!state.canStart)
    Button("Stop Server…") { confirmStop(model) }
      .disabled(!model.supervisor.canStop || !model.supervisor.isRunning)
    Button("Check Again") { Task { await model.checkAgain() } }
      .keyboardShortcut(shortcuts ? KeyboardShortcut("r") : nil)
    Divider()
    Button("Open Log") { openLog(model) }
      .disabled(!logExists(model))
  }
}

@MainActor func logExists(_ model: AppModel) -> Bool {
  FileManager.default.fileExists(atPath: model.logURL.path)
}

@MainActor func openLog(_ model: AppModel) {
  NSWorkspace.shared.open(model.logURL)
}

/// Stopping ends every running thread, so it asks first.
@MainActor func confirmStop(_ model: AppModel) {
  let alert = NSAlert()
  alert.messageText = "Stop the Omni server?"
  alert.informativeText = "Running threads stop too, and the Web UI goes offline until the server starts again."
  alert.alertStyle = .warning
  alert.addButton(withTitle: "Stop Server").hasDestructiveAction = true
  alert.addButton(withTitle: "Cancel")
  guard alert.runModal() == .alertFirstButtonReturn else { return }
  Task { await model.stopServer() }
}
