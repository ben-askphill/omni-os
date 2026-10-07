import OmniKit
import SwiftUI

/// DelegationCard in Delegation.tsx: the threads a Conductor or a team lead fanned out to, or a thread's own
/// sub-agents, each with its live state.
struct DelegationCard: View {
  let delegation: Delegation
  /// The lead's own view of its team: "Team of 3", no lead link.
  var team = false
  let model: AppModel
  /// Sub-agents the thread's own run launched, which have no thread to link to.
  var agents: AgentRows?

  var body: some View {
    let n = delegation.branches.count + (agents?.calls.count ?? 0)
    VStack(alignment: .leading, spacing: 8) {
      header(n)
      VStack(alignment: .leading, spacing: 8) {
        ForEach(delegation.branches) { b in
          BranchRow(branch: b, model: model).openInNewWindow(b.id, model: model)
        }
        if let agents {
          ForEach(agents.calls) { c in
            AgentRow(call: c, rows: agents)
          }
        }
      }
      .padding(.top, 4)
      .padding(.leading, 8)
      .overlay(alignment: .leading) { Rectangle().fill(Tok.line).frame(width: z(1.5)) }
    }
    .padding(.horizontal, 14)
    .padding(.top, 14)
    .padding(.bottom, 12)
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    .accessibilityElement(children: .contain)
  }

  private func header(_ n: Int) -> some View {
    HStack(spacing: 10) {
      CrewGlyph(role: "conductor", size: 16).foregroundStyle(Tok.fg)
      Text(delegation.lead != nil || team ? "Team of \(n)" : "Delegated \(Format.plural(n, "task"))")
        .fontWeight(.medium)
        .foregroundStyle(Tok.fg)
        .fixedSize()
      if let lead = delegation.lead {
        Button { model.route = .thread(id: lead.id) } label: {
          Text(lead.channel.isEmpty ? lead.title : "\(lead.title) · #\(lead.channel)").lineLimit(1)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Tok.fg3)
        .help("Open the lead thread")
        Spacer(minLength: 8)
        StatusPill(status: lead.status, label: combining(lead) ? "Combining" : nil)
      } else {
        Text(delegation.branches.compactMap(\.taskID).joined(separator: " "))
          .font(.omni(size: ThreadStyle.mono, design: .monospaced))
          .foregroundStyle(Tok.fg4)
          .lineLimit(1)
        Spacer(minLength: 0)
      }
    }
    .font(.omni(size: 13.5))
    .padding(.horizontal, 4)
  }

  /// Every member has reported and the lead is still at it: it is writing the combined answer.
  private func combining(_ lead: DelegationBranch) -> Bool {
    lead.status == .running && !delegation.branches.isEmpty && !delegation.branches.contains { $0.status.isActive }
  }
}

/// What the transcript knows about a card's sub-agents: the calls, which ones the server still runs, and what
/// their nested tool rows need.
struct AgentRows {
  let calls: [ToolCall]
  /// Agent calls (by tool_use id) the server still runs.
  let live: Set<String>
  let running: Bool
  let cwd: String?
  let ui: TranscriptUI
}

/// BranchFace in Delegation.tsx: a row's mark, title, meta line and state.
private struct BranchFace<Meta: View>: View {
  let role: String?
  let title: String
  let status: ThreadStatus
  @ViewBuilder let meta: Meta

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      CrewGlyph(role: role, size: 15)
        .foregroundStyle(Tok.fg2)
        .frame(width: z(32), height: z(32))
        .background(Tok.surface, in: Circle())
      VStack(alignment: .leading, spacing: 4) {
        Text(title)
          .font(.omni(size: 14, weight: .medium))
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
        HStack(spacing: 8) { meta }
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg3)
          .lineLimit(1)
      }
      Spacer(minLength: 8)
      StatusPill(status: status)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
    .background(Tok.bg, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    .cardShadow(20)
    .contentShape(Rectangle())
  }
}

/// A row on the card's rail, its connector in the row's state colour.
private struct RailRow: ViewModifier {
  let status: ThreadStatus

  func body(content: Content) -> some View {
    content
      .padding(.leading, 16)
      .overlay(alignment: .topLeading) { Rail(color: color).frame(width: z(16), height: z(34)) }
  }

  /// Ink when done, blue while running, vermilion when it needs Ben.
  private var color: Color {
    switch Glyph(status) {
    case .done: Tok.fg
    case .running, .queued: Tok.live
    case .needs: Tok.needs
    default: Tok.lineStrong
    }
  }
}

private struct BranchRow: View {
  let branch: DelegationBranch
  let model: AppModel

  var body: some View {
    Button { model.route = .thread(id: branch.id) } label: {
      BranchFace(role: branch.role, title: branch.title, status: branch.status) {
        if let role = branch.role { Text(role) }
        if !branch.channel.isEmpty { Text("#\(branch.channel)") }
        HarnessMark(harness: branch.harness.rawValue)
        if let task = branch.taskID {
          Text(task).font(.omni(size: ThreadStyle.mono, design: .monospaced)).foregroundStyle(Tok.fg2)
        }
        if let detail { Text(detail).foregroundStyle(Tok.fg4) }
      }
    }
    .buttonStyle(.plain)
    .modifier(RailRow(status: branch.status))
  }

  private var detail: String? {
    if branch.status == .queued { return "waiting for a slot" }
    guard let at = branch.updatedAt else { return nil }
    return branch.status == .running ? "started \(RelTime.label(at))" : "report in · \(RelTime.label(at))"
  }
}

/// AgentRow in Transcript.tsx: a sub-agent has no thread to open, so it opens in place: its prompt, its answer
/// and the calls it made. While it runs its latest calls show under it.
private struct AgentRow: View {
  let call: ToolCall
  let rows: AgentRows

  var body: some View {
    let open = rows.ui.isOpen(key)
    let status = Delegation.status(of: call, live: rows.live.contains(call.callID), running: rows.running)
    let type = call.use.input["subagent_type"]?.stringValue
    VStack(alignment: .leading, spacing: 4) {
      Button { withAnimation(Motion.settle) { rows.ui.toggle(key) } } label: {
        BranchFace(role: type, title: description, status: status) {
          Text(type ?? "agent")
          if call.use.input["run_in_background"] == .bool(true) { Text("background") }
          if calls > 0 { Text(Format.plural(calls, "tool")).monospacedDigit() }
          Chevron(open: open)
        }
      }
      .buttonStyle(.plain)
      .accessibilityValue(open ? "Expanded" : "Collapsed")
      if open {
        ToolDetail(call: call, running: rows.running)
          .padding(.horizontal, 4)
          .padding(.top, 4)
          .transition(.opacity)
      }
      if !call.children.isEmpty && (open || status == .running) {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(open ? call.children : Array(call.children.suffix(ToolRowView.liveChildren))) { child in
            ToolRowView(call: child, depth: 1, running: rows.running, cwd: rows.cwd, ui: rows.ui, agents: rows.live)
          }
        }
      }
    }
    .modifier(RailRow(status: status))
  }

  private var key: String { "a\(call.id)" }

  private var description: String {
    let d = call.use.input["description"].map(ToolText.str) ?? ""
    return d.isEmpty ? "Sub-agent" : d
  }

  /// Every call it made, however deep.
  private var calls: Int { Self.count(call) }
  private static func count(_ c: ToolCall) -> Int { c.children.reduce(0) { $0 + 1 + count($1) } }
}

/// The curved connector from the card's rail into a row.
private struct Rail: View {
  let color: Color

  var body: some View {
    Path { p in
      p.move(to: CGPoint(x: -8.75, y: 0))
      p.addLine(to: CGPoint(x: -8.75, y: 20))
      p.addQuadCurve(to: CGPoint(x: 5, y: 34), control: CGPoint(x: -8.75, y: 34))
      p.addLine(to: CGPoint(x: 16, y: 34))
    }
    .stroke(color, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
  }
}

/// CrewMark in brand.tsx, for the roles the cards show; other roles get the layers icon.
struct CrewGlyph: View {
  let role: String?
  var size: CGFloat = 16

  var body: some View {
    let s = size / 24
    ZStack {
      switch role {
      case "conductor":
        Circle().stroke(lineWidth: 3.6 * s).frame(width: z(14) * s, height: z(14) * s)
      case "researcher":
        Circle().stroke(lineWidth: 1.75 * s).frame(width: z(17) * s, height: z(17) * s)
        Circle().frame(width: z(6.4) * s, height: z(6.4) * s)
      case "builder":
        RoundedRectangle(cornerRadius: 3.5 * s).stroke(lineWidth: 1.75 * s).frame(width: z(16) * s, height: z(16) * s)
        RoundedRectangle(cornerRadius: 2 * s).frame(width: z(8) * s, height: z(8) * s).offset(x: 4 * s, y: 4 * s)
      default:
        OmniIcon(name: "layers", size: size * 0.9)
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}
