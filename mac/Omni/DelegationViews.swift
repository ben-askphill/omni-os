import OmniKit
import SwiftUI

/// DelegationCard in Delegation.tsx: the threads a Conductor or a team lead fanned out to, each with its live state.
struct DelegationCard: View {
  let delegation: Delegation
  /// The lead's own view of its team: "Team of 3", no lead link.
  var team = false
  let model: AppModel

  var body: some View {
    let n = delegation.branches.count
    VStack(alignment: .leading, spacing: 8) {
      header(n)
      VStack(alignment: .leading, spacing: 8) {
        ForEach(delegation.branches) { b in
          BranchRow(branch: b, model: model).openInNewWindow(b.id, model: model)
        }
      }
      .padding(.top, 4)
      .padding(.leading, 8)
      .overlay(alignment: .leading) { Rectangle().fill(Tok.line).frame(width: 1.5) }
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
          .font(.system(size: ThreadStyle.mono, design: .monospaced))
          .foregroundStyle(Tok.fg4)
          .lineLimit(1)
        Spacer(minLength: 0)
      }
    }
    .font(.system(size: 13.5))
    .padding(.horizontal, 4)
  }

  /// Every member has reported and the lead is still at it: it is writing the combined answer.
  private func combining(_ lead: DelegationBranch) -> Bool {
    lead.status == .running && !delegation.branches.isEmpty && !delegation.branches.contains { $0.status.isActive }
  }
}

private struct BranchRow: View {
  let branch: DelegationBranch
  let model: AppModel

  var body: some View {
    Button { model.route = .thread(id: branch.id) } label: {
      HStack(alignment: .top, spacing: 12) {
        CrewGlyph(role: branch.role, size: 15)
          .foregroundStyle(Tok.fg2)
          .frame(width: 32, height: 32)
          .background(Tok.surface, in: Circle())
        VStack(alignment: .leading, spacing: 4) {
          Text(branch.title)
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(Tok.fg)
            .lineLimit(1)
          HStack(spacing: 8) {
            if let role = branch.role { Text(role) }
            if !branch.channel.isEmpty { Text("#\(branch.channel)") }
            HarnessMark(harness: branch.harness.rawValue)
            if let task = branch.taskID {
              Text(task).font(.system(size: ThreadStyle.mono, design: .monospaced)).foregroundStyle(Tok.fg2)
            }
            if let detail { Text(detail).foregroundStyle(Tok.fg4) }
          }
          .font(.system(size: 12))
          .foregroundStyle(Tok.fg3)
          .lineLimit(1)
        }
        Spacer(minLength: 8)
        StatusPill(status: branch.status)
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 12)
      .background(Tok.bg, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
      .cardShadow(20)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .padding(.leading, 16)
    .overlay(alignment: .topLeading) { Rail(color: rail).frame(width: 16, height: 34) }
  }

  private var detail: String? {
    if branch.status == .queued { return "waiting for a slot" }
    guard let at = branch.updatedAt else { return nil }
    return branch.status == .running ? "started \(RelTime.label(at))" : "report in · \(RelTime.label(at))"
  }

  /// Ink when done, blue while running, vermilion when it needs Ben.
  private var rail: Color {
    switch Glyph(branch.status) {
    case .done: Tok.fg
    case .running, .queued: Tok.live
    case .needs: Tok.needs
    default: Tok.lineStrong
    }
  }
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
        Circle().stroke(lineWidth: 3.6 * s).frame(width: 14 * s, height: 14 * s)
      case "researcher":
        Circle().stroke(lineWidth: 1.75 * s).frame(width: 17 * s, height: 17 * s)
        Circle().frame(width: 6.4 * s, height: 6.4 * s)
      case "builder":
        RoundedRectangle(cornerRadius: 3.5 * s).stroke(lineWidth: 1.75 * s).frame(width: 16 * s, height: 16 * s)
        RoundedRectangle(cornerRadius: 2 * s).frame(width: 8 * s, height: 8 * s).offset(x: 4 * s, y: 4 * s)
      default:
        OmniIcon(name: "layers", size: size * 0.9)
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}
