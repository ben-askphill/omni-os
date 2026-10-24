import OmniKit
import SwiftUI

/// CloudAgentCard in the Web UI: one Cursor cloud agent run, at the point it started, showing its newest state. The
/// agent's name and status, where it works, the branch it pushed and the PR Cursor opened, and the agent on cursor.com.
struct CloudAgentCard: View {
  let state: CloudAgentState
  @Environment(\.openURL) private var openURL

  var body: some View {
    VStack(alignment: .leading, spacing: z(10)) {
      HStack(alignment: .top, spacing: z(12)) {
        HarnessLogo(harness: "cursor-cloud", size: 15)
          .foregroundStyle(Tok.fg)
          .frame(width: z(32), height: z(32))
          .background(Tok.bg, in: Circle())
        VStack(alignment: .leading, spacing: z(4)) {
          HStack(alignment: .firstTextBaseline, spacing: z(8)) {
            Text(state.title)
              .font(.omni(size: 13.5, weight: .medium))
              .foregroundStyle(Tok.fg)
              .lineLimit(1)
              .truncationMode(.tail)
            Chip(text: state.statusLabel, tone: chipTone)
              .fixedSize()
          }
          Text(subtitle)
            .font(.omni(size: 12))
            .foregroundStyle(Tok.fg3)
            .lineLimit(1)
            .truncationMode(.middle)
          if let branch = state.branch {
            HStack(spacing: z(6)) {
              OmniIcon(name: "branch", size: 12).foregroundStyle(Tok.fg4)
              Text(branch)
                .font(.omni(size: 11.5, design: .monospaced))
                .foregroundStyle(Tok.fg2)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
            }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      HStack(spacing: z(6)) {
        if let link = URL(string: state.url) {
          Button { openURL(link) } label: {
            Label { Text("Open in Cursor") } icon: { OmniIcon(name: "external", size: 13) }
          }
          .buttonStyle(.pill(.primary, height: 28))
          .help(state.url)
        }
        if let pr = state.prURL, let link = URL(string: pr) {
          Button { openURL(link) } label: {
            Label { Text(state.prNumber.map { "PR \($0)" } ?? "Pull request") } icon: { OmniIcon(name: "pr", size: 13) }
          }
          .buttonStyle(.pill(.secondary, height: 28))
          .help(pr)
        }
      }
      .padding(.leading, z(44))
    }
    .padding(.horizontal, z(16))
    .padding(.vertical, z(12))
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(22), style: .continuous))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Cursor cloud agent, \(state.statusLabel)")
  }

  /// "Cursor cloud agent · acme/widgets from main".
  private var subtitle: String {
    var s = "Cursor cloud agent"
    if !state.repo.isEmpty { s += " · " + state.repo + (state.ref.map { " from \($0)" } ?? "") }
    return s
  }

  private var chipTone: Chip.Tone {
    switch state.tone {
    case .live: .live
    case .done: .done
    case .needs: .needs
    case .plain: .outline
    }
  }
}
