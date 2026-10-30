import OmniKit
import SwiftUI

/// The Notifications cards of the General tab (a tab of its own before #404): this Mac's switch, what macOS allows,
/// and a switch per channel. Nothing here syncs; the other Mac keeps its own choices.
struct NotificationSettingsView: View {
  let model: AppModel
  @Bindable var attention: AttentionCenter

  var body: some View {
    VStack(alignment: .leading, spacing: z(16)) {
      SettingsCard(
        title: "Notifications",
        note: "This Mac can tell you when a thread finishes or fails while you are somewhere else. Click a notification to open its thread. Nothing alerts for the thread you are looking at."
      ) {
        SettingsToggle(
          title: "Notify on this Mac",
          detail: "New finished and failed results, the ones Needs you lists. Turning this on asks macOS the first time.",
          isOn: Binding(get: { attention.settings.enabled }, set: { on in Task { await attention.setEnabled(on) } })
        )
        InfoRows {
          InfoRow(label: "macOS") {
            HStack(spacing: z(8)) {
              GlyphView(glyph: glyph, size: 7)
              Text(attention.permission.label)
              Spacer(minLength: 0)
              if attention.permission == .denied {
                Button("Open System Settings") { openNotificationSettings() }
                  .buttonStyle(.pill(.secondary, height: 26))
              } else if attention.permission == .notAsked, attention.settings.enabled {
                Button("Ask macOS") { Task { await attention.setEnabled(true) } }
                  .buttonStyle(.pill(.secondary, height: 26))
              }
            }
          }
        }
        if attention.settings.enabled, attention.permission == .denied {
          ErrorNote(text: "macOS has notifications off for Omni. Turn them on in System Settings, Notifications, Omni.")
        }
      }

      SettingsCard(title: "Channels", note: "A channel turned off still lists its results in Needs you, without a notification.") {
        if channels.isEmpty {
          Text("No channels yet.").font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
        }
        VStack(spacing: z(8)) {
          ForEach(channels) { c in
            ChannelAlertToggle(name: c.name, id: c.id, isOn: Binding(
              get: { attention.settings.alerts(channel: c.id) },
              set: { attention.settings.setAlerts($0, channel: c.id) }
            ))
          }
        }
        .disabled(!attention.settings.enabled)
        .opacity(attention.settings.enabled ? 1 : 0.55)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .task { await attention.refreshPermission() }
  }

  private var channels: [ChannelWithRunning] {
    model.store.channels.filter { !$0.archived }
  }

  private var glyph: Glyph {
    switch attention.permission {
    case .allowed: .done
    case .denied: .needs
    case .notAsked: .settled
    }
  }
}

private struct ChannelAlertToggle: View {
  let name: String
  let id: String
  @Binding var isOn: Bool

  var body: some View {
    HStack(spacing: z(12)) {
      VStack(alignment: .leading, spacing: z(1)) {
        Text(name).font(.omni(size: 13, weight: .medium)).foregroundStyle(Tok.fg)
        Text("#\(id)").font(.omni(size: 11.5, design: .monospaced)).foregroundStyle(Tok.fg3)
      }
      Spacer(minLength: 0)
      Toggle(name, isOn: $isOn)
        .toggleStyle(.omni)
        .labelsHidden()
        .accessibilityLabel("Notify for \(name)")
    }
    .padding(.horizontal, z(16))
    .padding(.vertical, z(10))
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
  }
}
