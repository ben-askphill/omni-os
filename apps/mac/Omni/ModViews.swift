import OmniKit
import SwiftUI

/// A run of a mod's `$.ui.log` lines: dim system rows with the plugin's name, as ModLog in Transcript.tsx.
struct ModLogView: View {
  let lines: [ModLine]

  var body: some View {
    VStack(alignment: .leading, spacing: z(2)) {
      ForEach(lines) { line in
        HStack(alignment: .firstTextBaseline, spacing: z(6)) {
          Text(line.plugin)
            .font(.omni(size: 11, design: .monospaced))
            .foregroundStyle(Tok.fg3)
            .fixedSize()
          Text(line.text)
            .font(.omni(size: 12))
            .foregroundStyle(Tok.fg4)
            .textSelection(.enabled)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}

/// The status lines a thread's mods pinned with `$.ui.status`, one per plugin, under the title.
struct ModStatusLines: View {
  let mods: [ModStatus]

  var body: some View {
    if !mods.isEmpty {
      VStack(alignment: .leading, spacing: 1) {
        ForEach(mods) { mod in
          HStack(spacing: z(6)) {
            Text(mod.plugin)
              .font(.omni(size: 10.5, design: .monospaced))
              .foregroundStyle(Tok.fg4)
              .fixedSize()
            Text(mod.text)
              .font(.omni(size: 11.5))
              .monospacedDigit()
              .foregroundStyle(Tok.fg3)
              .lineLimit(1)
              .truncationMode(.tail)
          }
          .help(mod.text)
        }
      }
      .padding(.top, z(2))
    }
  }
}

/// A thread's latest mod status, compact, for a row in a thread list.
struct ModStatusChip: View {
  let mod: ModStatus

  /// Past this many characters the chip ends in an ellipsis, so it never pushes the preview off the row.
  static let maxLength = 40

  var body: some View {
    Text(mod.text.count > Self.maxLength ? mod.text.prefix(Self.maxLength - 1) + "…" : mod.text)
      .font(.omni(size: 11))
      .monospacedDigit()
      .foregroundStyle(Tok.fg3)
      .lineLimit(1)
      .padding(.horizontal, z(6))
      .background(ThreadStyle.surface2, in: Capsule())
      .fixedSize()
      .help("\(mod.plugin): \(mod.text)")
  }
}

/// A mod's `$.ui.toast` calls, stacked in the thread's top right corner until they time out or are clicked away.
struct ModToastStack: View {
  let store: ThreadStore

  var body: some View {
    VStack(alignment: .trailing, spacing: z(8)) {
      ForEach(store.toasts) { shown in
        Button {
          store.dismissToast(shown.id)
        } label: {
          HStack(alignment: .top, spacing: z(10)) {
            OmniIcon(name: "bell", size: 14)
              .foregroundStyle(Tok.fg3)
            VStack(alignment: .leading, spacing: z(2)) {
              Text(shown.toast.text)
                .font(.omni(size: 13, weight: .medium))
                .foregroundStyle(Tok.fg)
                .lineLimit(3)
              Text(shown.toast.plugin)
                .font(.omni(size: 11, design: .monospaced))
                .foregroundStyle(Tok.fg4)
            }
          }
          .padding(.horizontal, z(14))
          .padding(.vertical, z(10))
          .frame(maxWidth: z(320), alignment: .leading)
          .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(14), style: .continuous))
          .overlay(RoundedRectangle(cornerRadius: z(14), style: .continuous).strokeBorder(Tok.line))
          .menuShadow(16)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Dismiss")
        .accessibilityLabel("\(shown.toast.plugin): \(shown.toast.text)")
        .transition(.move(edge: .top).combined(with: .opacity))
      }
    }
    .animation(.easeOut(duration: 0.18), value: store.toasts)
    .padding(z(16))
  }
}
