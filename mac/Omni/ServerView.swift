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
    .background(Tok.bg)
  }

  private func progress(_ text: String) -> some View {
    VStack(spacing: 14) {
      Loader(size: 22)
      Text(text)
        .font(.system(size: 13))
        .foregroundStyle(Tok.fg3)
    }
    .accessibilityElement(children: .combine)
  }

  private func notRunning(port: Int, repo: String) -> some View {
    VStack(spacing: 20) {
      OmniIcon(name: "terminal", size: 20, weight: 1.5)
        .foregroundStyle(Tok.fg3)
        .frame(width: 48, height: 48)
        .background(Tok.surface2, in: Circle())
      VStack(spacing: 6) {
        Text("The Omni server is not running")
          .font(.system(size: 22, weight: .medium))
          .tracking(-0.22)
          .foregroundStyle(Tok.fg)
        Text("Start it here, or run npm start in the repo. It keeps running when the app quits.")
          .font(.system(size: 13.5))
          .foregroundStyle(Tok.fg3)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
      }
      ServerDetails(port: port, repo: repo, node: model.settings.nodePath)
      HStack(spacing: 8) {
        Button("Start Server") { Task { await model.startServer() } }
          .buttonStyle(.pill(.primary, height: 34))
          .keyboardShortcut(.defaultAction)
        Button("Check Again") { Task { await model.checkAgain() } }
          .buttonStyle(.pill(.secondary, height: 34))
        SettingsLink { Text("Settings") }
          .buttonStyle(.pill(.ghost, height: 34))
      }
    }
    .padding(32)
    .frame(maxWidth: 520)
    .omniCard(28)
    .cardShadow(28)
    .padding(32)
  }

  private func failed(message: String, logTail: [String]) -> some View {
    VStack(spacing: 16) {
      GlyphView(glyph: .needs, size: 14)
        .frame(width: 48, height: 48)
        .background(Tok.surface2, in: Circle())
      VStack(spacing: 6) {
        Text("Server problem")
          .font(.system(size: 22, weight: .medium))
          .tracking(-0.22)
          .foregroundStyle(Tok.fg)
        Text(message)
          .font(.system(size: 13.5))
          .foregroundStyle(Tok.fg2)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
          .textSelection(.enabled)
      }
      if !logTail.isEmpty {
        LogTail(lines: logTail)
      }
      HStack(spacing: 8) {
        if model.supervisor.state.canStart {
          Button("Try Again") { Task { await model.startServer() } }
            .buttonStyle(.pill(.primary, height: 34))
        }
        if logExists(model) {
          Button("Open Log") { openLog(model) }
            .buttonStyle(.pill(.secondary, height: 34))
        }
        if model.supervisor.canStop {
          Button("Stop Server") { confirmStop(model) }
            .buttonStyle(.pill(.secondary, height: 34))
        }
        Button("Check Again") { Task { await model.checkAgain() } }
          .buttonStyle(.pill(.secondary, height: 34))
        SettingsLink { Text("Settings") }
          .buttonStyle(.pill(.ghost, height: 34))
      }
    }
    .padding(32)
    .frame(maxWidth: 640)
    .omniCard(28)
    .cardShadow(28)
    .padding(32)
  }
}

struct ServerDetails: View {
  let port: Int
  let repo: String
  let node: String

  var body: some View {
    InfoRows(fill: Tok.bg) {
      InfoRow(label: "Port") {
        Text(verbatim: "\(port)").monospacedDigit()
      }
      InfoRow(label: "Repo") {
        Text(repo).font(.system(size: 12, design: .monospaced)).truncationMode(.middle).textSelection(.enabled)
      }
      InfoRow(label: "Node") {
        if node.isEmpty {
          Text("Detect automatically").foregroundStyle(Tok.fg3)
        } else {
          Text(node).font(.system(size: 12, design: .monospaced)).truncationMode(.middle).textSelection(.enabled)
        }
      }
    }
    .lineLimit(1)
  }
}

/// The last lines the server wrote before it failed.
struct LogTail: View {
  let lines: [String]

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Last lines of the log")
        .omniCaption()
        .padding(.leading, 4)
      // As tall as the lines, and it scrolls from the bottom past 220 points.
      ScrollView { text }
        .defaultScrollAnchor(.bottom)
        .frame(maxHeight: 220)
        .fixedSize(horizontal: false, vertical: true)
      .background(Tok.bg, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Tok.line))
    }
  }

  private var text: some View {
    Text(lines.joined(separator: "\n"))
      .font(.system(size: 11.5, design: .monospaced))
      .foregroundStyle(Tok.fg2)
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
