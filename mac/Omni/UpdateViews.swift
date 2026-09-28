import AppKit
import OmniKit
import SwiftUI

/// Above the detail: the server or the app is behind main, and the progress of Restart and Rebuild.
struct UpdateBar: View {
  let updater: Updater
  @State private var confirmRestart = false

  var body: some View {
    let step = updater.restart.step
    VStack(spacing: 0) {
      if step.isActive {
        row(icon: nil, text: step.label ?? "") {
          if case .waitingForIdle = step { Button("Cancel") { updater.restart.cancel() } }
        }
      } else if case .failed(let message) = step {
        row(icon: "exclamationmark.triangle.fill", text: message, tint: .orange) {
          Button("Open Log") { NSWorkspace.shared.open(Updater.webBuildLog) }
          Button("Dismiss") { updater.restart.dismissFailure() }
        }
      } else if updater.notices.serverBehind {
        row(icon: "arrow.triangle.2.circlepath", text: "The server is behind main.") {
          Button("Restart") {
            if updater.restartStopsOutsideServer { confirmRestart = true } else { Task { await updater.restartServer() } }
          }
        }
      }

      switch updater.rebuild {
      case .building:
        row(icon: nil, text: "Building the app. It relaunches when it is done.") {}
      case .failed(let message):
        row(icon: "exclamationmark.triangle.fill", text: message, tint: .orange) {
          Button("Open Log") { NSWorkspace.shared.open(Updater.appRebuildLog) }
          Button("Dismiss") { updater.dismissRebuildFailure() }
        }
      case .idle:
        if updater.notices.appBehind {
          row(icon: "arrow.down.app", text: "This app is behind main.") {
            Button("Rebuild and Relaunch") { Task { await updater.rebuildApp() } }
          }
        }
      }
    }
    .confirmationDialog(
      "Restart the server?", isPresented: $confirmRestart, titleVisibility: .visible
    ) {
      Button("Stop and Restart") { Task { await updater.restartServer() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This server was started outside the app. Restart stops that process and starts a new one from the app.")
    }
  }

  private func row<Actions: View>(
    icon: String?, text: String, tint: Color = .secondary, @ViewBuilder actions: () -> Actions
  ) -> some View {
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        if let icon {
          Image(systemName: icon).foregroundStyle(tint)
        } else {
          ProgressView().controlSize(.small)
        }
        Text(text)
          .lineLimit(2)
          .frame(maxWidth: .infinity, alignment: .leading)
        actions()
      }
      .controlSize(.small)
      .padding(.horizontal, 12)
      .padding(.vertical, 7)
      .background(Color(nsColor: .windowBackgroundColor))
      Divider()
    }
  }
}

/// The banners for finished, failed and stopped threads, bottom right. Clicking Open goes to the thread.
struct BannerStack: View {
  let model: AppModel

  var body: some View {
    VStack(alignment: .trailing, spacing: 8) {
      ForEach(model.banners.banners) { banner in
        BannerView(banner: banner, open: {
          model.route = .thread(id: banner.threadID)
          model.banners.dismiss(banner.id)
        }, dismiss: { model.banners.dismiss(banner.id) })
        .transition(.move(edge: .trailing).combined(with: .opacity))
      }
    }
    .padding(16)
    .animation(.default, value: model.banners.banners)
  }
}

struct BannerView: View {
  let banner: Banner
  let open: () -> Void
  let dismiss: () -> Void
  @State private var hovering = false

  var body: some View {
    HStack(spacing: 10) {
      ThreadStatusIcon(status: banner.status)
      VStack(alignment: .leading, spacing: 1) {
        Text(banner.title).fontWeight(.medium).lineLimit(1)
        Text(banner.body).font(.caption).foregroundStyle(.secondary).lineLimit(1)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      Button("Open", action: open)
        .buttonStyle(.borderedProminent)
        .controlSize(.small)
      Button(action: dismiss) {
        Image(systemName: "xmark")
      }
      .buttonStyle(.borderless)
      .accessibilityLabel("Dismiss")
    }
    .padding(.leading, 12)
    .padding(.trailing, 10)
    .padding(.vertical, 8)
    .frame(width: 340)
    .background(.regularMaterial, in: .rect(cornerRadius: 12))
    .shadow(color: .black.opacity(0.15), radius: 8, y: 2)
    .onHover { hovering = $0 }
    .task(id: hovering) {
      guard !hovering else { return }
      try? await Task.sleep(for: .seconds(6.5))
      if !Task.isCancelled { dismiss() }
    }
    .accessibilityElement(children: .contain)
  }
}

/// Quit asks only while turns run.
@MainActor
enum QuitDialog {
  static func ask(runningTurns n: Int) -> QuitRules.Choice {
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = n == 1 ? "1 turn is still running" : "\(n) turns are still running"
    alert.informativeText = "Keep the server running in the background to let them finish, or stop them and quit."
    alert.addButton(withTitle: "Keep Server Running")
    alert.addButton(withTitle: "Stop Them and Quit")
    alert.addButton(withTitle: "Cancel")
    switch alert.runModal() {
    case .alertFirstButtonReturn: return .keepServerRunning
    case .alertSecondButtonReturn: return .stopAndQuit
    default: return .cancel
    }
  }
}
