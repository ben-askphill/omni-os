import OmniKit
import SwiftUI

/// A PR's diff, file by file. Which files start open and the line cap follow DiffViewer.tsx.
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

private struct DiffFileView: View {
  let file: FileDiff
  @State private var open: Bool
  @State private var showAll = false
  @State private var hover = false

  init(file: FileDiff, startsOpen: Bool) {
    self.file = file
    _open = State(initialValue: startsOpen)
  }

  var body: some View {
    VStack(spacing: 0) {
      Button {
        open.toggle()
      } label: {
        HStack(spacing: z(8)) {
          Chevron(open: open, color: Tok.fg3)
          Text(file.path)
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
        if file.binary {
          Text("Binary file").font(.omni(size: 12)).foregroundStyle(Tok.fg3)
            .padding(.horizontal, z(12)).padding(.vertical, z(8))
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        LazyVStack(alignment: .leading, spacing: 0) {
          ForEach(Array(file.shown(all: showAll).enumerated()), id: \.offset) { _, line in
            Text(line.isEmpty ? " " : line)
              .font(.omni(size: ThreadStyle.mono, design: .monospaced))
              .lineSpacing(0)
              .foregroundStyle(color(line))
              .padding(.horizontal, z(12))
              .padding(.vertical, z(2))
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(background(line))
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

  private func color(_ line: String) -> Color {
    if line.hasPrefix("@@") { return Tok.fg3 }
    if line.hasPrefix("\\") { return Tok.fg4 }
    if line.hasPrefix("+") || line.hasPrefix("-") { return Tok.fg }
    return Tok.fg2
  }

  private func background(_ line: String) -> Color {
    if line.hasPrefix("@@") { return Tok.surface }
    if line.hasPrefix("+") { return Tok.diffAdd }
    if line.hasPrefix("-") { return Tok.diffDelete }
    return .clear
  }
}
