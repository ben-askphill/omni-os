import OmniKit
import SwiftUI

/// A panel edge: drag to resize within its bounds, double-click to restore the initial width.
struct SidebarResizeHandle: View {
  @Binding var width: Double
  let initial: CGFloat
  var minimum = 200.0
  var maximum = 420.0
  var growsLeft = false
  var label = "Resize sidebar"
  @State private var start: Double?
  @State private var hover = false

  static func clamp(_ w: Double) -> CGFloat { CGFloat(min(420, max(200, w))).rounded() }

  private func clamped(_ w: Double) -> Double { min(maximum, max(minimum, w)) }

  var body: some View {
    Rectangle()
      .fill(.clear)
      .frame(width: 8)
      .overlay {
        Capsule().fill(Tok.lineStrong)
          .frame(width: 1)
          .padding(.vertical, z(12))
          .opacity(hover || start != nil ? 1 : 0)
      }
      .contentShape(Rectangle())
      .offset(x: growsLeft ? -4 : 4)
      .pointerStyle(.columnResize)
      .onHover { hover = $0 }
      .gesture(
        DragGesture(minimumDistance: 1, coordinateSpace: .global)
          .onChanged { g in
            let from = start ?? clamped(width)
            start = from
            width = clamped(from + (growsLeft ? -1 : 1) * g.translation.width / UIZoom.settings.scale)
          }
          .onEnded { _ in start = nil })
      .onTapGesture(count: 2) { width = clamped(Double(initial)) }
      .help("Drag to resize. Double-click to reset.")
      .accessibilityElement()
      .accessibilityLabel(label)
      .accessibilityValue("\(Int(clamped(width))) points")
      .accessibilityAdjustableAction { dir in
        switch dir {
        case .increment: width = clamped(clamped(width) + 16)
        case .decrement: width = clamped(clamped(width) - 16)
        @unknown default: break
        }
      }
  }
}

/// "Search or jump to" with its shortcut: the 70% white pill over the canvas.
struct SearchPill: View {
  let action: () -> Void
  @State private var hover = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: z(10)) {
        OmniIcon(name: "search", size: 15)
        Text("Search or jump to")
          .frame(maxWidth: .infinity, alignment: .leading)
        Kbd(text: "⌘K")
      }
      .font(.omni(size: 13))
      .foregroundStyle(hover ? Tok.fg3 : Tok.fg4)
      .padding(.leading, z(14))
      .padding(.trailing, z(8))
      .frame(height: z(40))
      .background(Tok.bg.opacity(0.7), in: Capsule())
      .cardShadow(20)
      .clipShape(Capsule())
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .onHover { hover = $0 }
  }
}

/// Which port, whether the server runs and who started it, and whether the feed is reconnecting.
/// The Server menu hangs off it.
struct StatusFooter: View {
  let model: AppModel

  var body: some View {
    let state = model.supervisor.state
    Menu {
      ServerMenuItems(model: model, shortcuts: false)
    } label: {
      HStack(spacing: z(8)) {
        Circle()
          .fill(color(state))
          .overlay(Circle().strokeBorder(model.supervisor.isRunning && model.connectionNotice == nil ? Tok.doneEdge : .clear, lineWidth: 1))
          .frame(width: z(7), height: z(7))
        VStack(alignment: .leading, spacing: 1) {
          Text(state.label)
            .foregroundStyle(Tok.fg2)
          HStack(spacing: z(6)) {
            // The machine's name moved to Settings, Machines (#405).
            Text("Port \(model.settings.port, format: .number.grouping(.never))")
              .monospacedDigit()
            if let notice = model.connectionNotice {
              Text(notice)
            }
          }
          .foregroundStyle(Tok.fg4)
        }
        Spacer(minLength: 0)
        OmniIcon(name: "chevronDown", size: 12)
          .foregroundStyle(Tok.fg4)
      }
      .font(.omni(size: 11))
      .padding(.horizontal, z(8))
      .contentShape(Rectangle())
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .help("Server")
    .accessibilityLabel("Server: \(state.label)")
  }

  private func color(_ state: ServerSupervisor.State) -> Color {
    switch state {
    case .running: model.connectionNotice == nil ? Tok.done : Tok.fg4
    case .notRunning, .failed: Tok.needs
    default: Tok.fg4
    }
  }
}
