import OmniKit
import SwiftUI

/// A PR's diff, file by file. Which files start open and the line cap follow apps/web/src/diff.ts.
struct DiffView: View {
  let diff: String

  var body: some View {
    if diff.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      Text("No diff.").font(.omni(size: 13)).foregroundStyle(Tok.fg3)
    } else {
      let files = DiffParser.parse(diff)
      if files.isEmpty {
        Text(diff).font(.omni(size: 12, design: .monospaced)).foregroundStyle(Tok.fg).textSelection(.enabled)
      } else {
        LazyVStack(spacing: z(8)) {
          ForEach(Array(files.enumerated()), id: \.offset) { _, file in
            DiffFileView(file: file, startsOpen: DiffParser.startsOpen(file, fileCount: files.count))
          }
        }
      }
    }
  }
}

/// One file of a diff: a header that opens and closes it, then its numbered lines, as `DiffFile` in DiffViewer.tsx.
/// The PR page and a thread's Changes tab both use it. `label` replaces the path in the header, `badge` sits before
/// it, and `notice` says why there are no lines (binary, too large).
struct DiffFileView: View {
  let file: FileDiff
  var label: String?
  var badge: String?
  var notice: String?
  @State private var open: Bool
  @State private var showAll = false
  @State private var hover = false

  init(file: FileDiff, startsOpen: Bool, label: String? = nil, badge: String? = nil, notice: String? = nil) {
    self.file = file
    self.label = label
    self.badge = badge
    self.notice = notice
    _open = State(initialValue: startsOpen)
  }

  var body: some View {
    VStack(spacing: 0) {
      Button {
        open.toggle()
      } label: {
        HStack(spacing: z(8)) {
          Chevron(open: open, color: Tok.fg3)
          if let badge {
            Text(badge).font(.omni(size: 11, design: .monospaced)).foregroundStyle(Tok.fg3).frame(width: z(12))
          }
          Text(label ?? file.path)
            .font(.omni(size: 12, design: .monospaced))
            .foregroundStyle(Tok.fg)
            .lineLimit(1)
            .truncationMode(.middle)
            .frame(maxWidth: .infinity, alignment: .leading)
          Text("+\(file.add)").foregroundStyle(Tok.fg2)
          Text("-\(file.del)").foregroundStyle(Tok.fg3)
        }
        .font(.omni(size: 11))
        .monospacedDigit()
        .padding(.horizontal, z(14))
        .frame(height: z(40))
        .background(hover ? Tok.surface2 : Tok.surface)
        .onHover { hover = $0 }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityAddTraits(.isHeader)
      .accessibilityValue(open ? "Expanded" : "Collapsed")

      if open {
        if let text = notice ?? (file.binary ? "Binary file" : nil) {
          Text(text).font(.omni(size: 12)).foregroundStyle(Tok.fg3)
            .padding(.horizontal, z(12)).padding(.vertical, z(8))
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Tok.bg)
        }
        let numbered = file.numbered
        LazyVStack(alignment: .leading, spacing: 0) {
          ForEach(Array(file.shown(all: showAll).enumerated()), id: \.offset) { _, line in
            HStack(alignment: .firstTextBaseline, spacing: 0) {
              if numbered {
                number(line.old)
                number(line.new)
              }
              Text(line.text.isEmpty ? " " : line.text)
                .foregroundStyle(color(line.kind))
                .padding(.leading, numbered ? z(4) : z(12))
                .padding(.trailing, z(12))
            }
            .font(.omni(size: ThreadStyle.mono, design: .monospaced))
            .lineSpacing(0)
            .padding(.vertical, z(2))
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(background(line.kind))
          }
        }
        .textSelection(.enabled)
        .background(Tok.bg)
        if !showAll, file.hiddenLines > 0 {
          Hairline()
          Button("Show \(file.hiddenLines) more lines") { showAll = true }
            .buttonStyle(.plain)
            .font(.omni(size: 12, weight: .medium))
            .foregroundStyle(Tok.fg3)
            .frame(maxWidth: .infinity, minHeight: z(36))
            .background(Tok.bg)
        }
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: z(18), style: .continuous))
    .overlay { RoundedRectangle(cornerRadius: z(18), style: .continuous).strokeBorder(Tok.line) }
  }

  private func number(_ n: Int?) -> some View {
    Text(n.map(String.init) ?? "")
      .foregroundStyle(Tok.fg4)
      .monospacedDigit()
      .frame(width: z(36), alignment: .trailing)
      .padding(.trailing, z(4))
      .accessibilityHidden(true)
  }

  private func color(_ kind: DiffLine.Kind) -> Color {
    switch kind {
    case .hunk: Tok.fg3
    case .note: Tok.fg4
    case .add, .del: Tok.fg
    case .context: Tok.fg2
    }
  }

  private func background(_ kind: DiffLine.Kind) -> Color {
    switch kind {
    case .hunk: Tok.surface
    case .add: Tok.diffAdd
    case .del: Tok.diffDelete
    default: .clear
    }
  }
}
