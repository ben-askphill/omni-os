import OmniKit
import SwiftUI

/// Hover wash and press for a sidebar row: the wash scales in from the center, like Bencho's.
struct RailRowStyle: ButtonStyle {
  @State private var hover = false

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .contentShape(Capsule())
      .background {
        Capsule().fill(Tok.wash)
          .opacity(hover || configuration.isPressed ? 1 : 0)
          .scaleEffect(hover || configuration.isPressed ? 1 : 0.72)
      }
      .onHover { hover = $0 }
      .animation(Motion.spring, value: hover)
  }
}

/// NavLink in Sidebar.tsx: 32pt, an icon or lead, the title, a running badge.
struct NavRow<Lead: View>: View {
  let title: String
  var icon: String?
  let active: Bool
  var running = 0
  /// Room kept on the right for a button laid over the row, like a channel's folder-plus.
  var trailingInset: CGFloat = 0
  @ViewBuilder var lead: Lead

  var body: some View {
    HStack(spacing: z(10)) {
      if let icon {
        OmniIcon(name: icon, size: 15)
          .foregroundStyle(active ? Tok.fg : Tok.fg3)
      }
      lead
      Text(title)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
      if running > 0 {
        HStack(spacing: z(6)) {
          GlyphView(glyph: .running, size: 6)
          Text("\(running)").monospacedDigit()
        }
        .font(.omni(size: 11))
        .foregroundStyle(Tok.live)
        .help("\(running) running or queued")
      }
    }
    .font(.omni(size: 13, weight: active ? .medium : .regular))
    .foregroundStyle(active ? Tok.fg : Tok.fg2)
    .padding(.leading, z(12))
    .padding(.trailing, z(12 + trailingInset))
    .animation(Motion.settle, value: trailingInset)
    .frame(height: z(32))
  }
}

extension NavRow where Lead == EmptyView {
  init(title: String, icon: String, active: Bool) {
    self.init(title: title, icon: icon, active: active) { EmptyView() }
  }
}

/// ThreadLink in Sidebar.tsx: a thread nested under its channel. A thread whose turn ended still works while its
/// sub-agents run.
struct ThreadRow: View {
  let thread: ThreadStub
  var active = false
  var agents = 0

  var body: some View {
    HStack(spacing: z(8)) {
      ThreadStatusIcon(status: agents > 0 ? .running : thread.status, done: thread.doneAt != nil)
        .frame(width: z(12))
      Text(thread.title.isEmpty ? "Untitled" : thread.title)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
      if let harness = thread.harness {
        HarnessLogo(harness: harness.rawValue, size: 11)
          .foregroundStyle(active ? Tok.fg3 : Tok.fg4)
      }
    }
    .font(.omni(size: 12.5, weight: active ? .medium : .regular))
    .foregroundStyle(active ? Tok.fg : thread.doneAt != nil ? Tok.fg4 : Tok.fg3)
    .padding(.horizontal, z(12))
    .frame(height: z(28))
    .help("\(thread.title.isEmpty ? "Untitled" : thread.title) · \(agents > 0 ? "\(Format.plural(agents, "agent")) running" : thread.doneAt != nil ? "Marked done" : thread.status.label)")
  }
}


struct ThreadStatusIcon: View {
  let status: ThreadStatus
  var done = false

  var body: some View {
    if status == .running {
      Loader(size: 11, color: Tok.live)
        .accessibilityLabel("Running")
    } else {
      StatusDot(status: status, size: 7, done: done)
        .accessibilityLabel(done ? "Marked done" : status.label)
    }
  }
}
