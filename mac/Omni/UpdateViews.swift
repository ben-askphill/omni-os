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
          if case .waitingForIdle = step {
            Button("Cancel") { updater.restart.cancel() }.buttonStyle(.pill(.ghost, height: 26))
          }
        }
      } else if case .failed(let message) = step {
        row(icon: .needs, text: message) {
          Button("Open Log") { NSWorkspace.shared.open(Updater.webBuildLog) }.buttonStyle(.pill(.secondary, height: 26))
          Button("Dismiss") { updater.restart.dismissFailure() }.buttonStyle(.pill(.ghost, height: 26))
        }
      } else if updater.notices.serverBehind {
        row(icon: .icon("refresh"), text: "The server is behind main.") {
          Button("Restart") {
            if updater.restartStopsOutsideServer { confirmRestart = true } else { Task { await updater.restartServer() } }
          }
          .buttonStyle(.pill(.primary, height: 26))
        }
      }

      switch updater.rebuild {
      case .building:
        row(icon: nil, text: "Building the app. It relaunches when it is done.") {}
      case .failed(let message):
        row(icon: .needs, text: message) {
          Button("Open Log") { NSWorkspace.shared.open(Updater.appRebuildLog) }.buttonStyle(.pill(.secondary, height: 26))
          Button("Dismiss") { updater.dismissRebuildFailure() }.buttonStyle(.pill(.ghost, height: 26))
        }
      case .idle:
        if updater.notices.appBehind {
          row(icon: .icon("download"), text: "This app is behind main.") {
            Button("Rebuild and Relaunch") { Task { await updater.rebuildApp() } }
              .buttonStyle(.pill(.primary, height: 26))
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

  private enum RowIcon {
    case progress, needs, icon(String)
  }

  private func row<Actions: View>(
    icon: RowIcon?, text: String, @ViewBuilder actions: () -> Actions
  ) -> some View {
    HStack(spacing: 10) {
      Group {
        switch icon ?? .progress {
        case .progress: Loader(size: 14)
        case .needs: GlyphView(glyph: .needs, size: 8)
        case .icon(let name): OmniIcon(name: name, size: 14).foregroundStyle(Tok.fg3)
        }
      }
      .frame(width: z(16))
      Text(text)
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg)
        .lineLimit(2)
        .frame(maxWidth: .infinity, alignment: .leading)
      actions()
    }
    .padding(.leading, 14)
    .padding(.trailing, 6)
    .frame(minHeight: z(38))
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    .padding(.horizontal, 12)
    .padding(.top, 8)
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
        Text(banner.title)
          .font(.omni(size: 13, weight: .medium))
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
        Text(banner.body)
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg3)
          .lineLimit(1)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      Button("Open", action: open)
        .buttonStyle(.pill(.primary, height: 26))
      Button(action: dismiss) {
        OmniIcon(name: "x", size: 13)
      }
      .buttonStyle(.icon(size: 26))
      .accessibilityLabel("Dismiss")
    }
    .padding(.leading, 14)
    .padding(.trailing, 8)
    .padding(.vertical, 8)
    .frame(width: z(340))
    .background(Tok.elev, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    .menuShadow(22)
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
