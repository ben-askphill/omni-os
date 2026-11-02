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
  /// A Conductor thread's delegate count: the row keeps room for it in place of the harness logo, and the sidebar lays
  /// the count's button over that room, so it is never inside the row's own button.
  var delegates: DelegateSummary?

  var body: some View {
    HStack(spacing: z(8)) {
      ThreadStatusIcon(status: agents > 0 ? .running : thread.status, done: thread.doneAt != nil)
        .frame(width: z(12))
      Text(thread.title.isEmpty ? "Untitled" : thread.title)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
      if let delegates {
        DelegateCountFace(summary: delegates).hidden().padding(.trailing, z(-6))
      } else if let harness = thread.harness {
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

/// DelegateCount.tsx: on a Conductor thread's row, the delegate icon and how many threads it delegated, every one,
/// finished ones too. Delegated threads have no row of their own, so the count carries their state, in priority order:
/// the needs-you diamond while one waits on Ben, the diamond again (in grey) when one failed unseen, the live tint
/// while one works, grey once all are done and seen. Clicking it opens the thread on Details at its agents card.
struct DelegateCount: View {
  let summary: DelegateSummary
  var size: CGFloat = 11
  let open: () -> Void

  var body: some View {
    Button(action: open) { DelegateCountFace(summary: summary, size: size) }
      .buttonStyle(RailRowStyle())
      .help(summary.label)
      .accessibilityLabel("\(summary.label). Show in Details")
  }
}

/// The count's face, also laid out hidden in the row so the title truncates before the button over it.
struct DelegateCountFace: View {
  let summary: DelegateSummary
  var size: CGFloat = 11

  var body: some View {
    HStack(spacing: z(3)) {
      if summary.flagged {
        GlyphView(glyph: .needs, size: 6).padding(.trailing, z(2))
      }
      OmniIcon(name: "delegate", size: size)
      Text("\(summary.total)").monospacedDigit()
    }
    .font(.omni(size: size > 11 ? 12.5 : 11))
    .foregroundStyle(tone)
    .padding(.horizontal, z(6))
    .frame(height: z(24))
    .contentShape(Capsule())
  }

  private var tone: Color {
    switch summary.state {
    case .needs: Tok.fg
    case .failed: Tok.fg3
    case .working: Tok.live
    case .settled: Tok.fg4
    }
  }
}
