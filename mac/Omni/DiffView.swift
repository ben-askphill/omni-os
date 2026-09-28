import OmniKit
import SwiftUI

/// A PR's diff, file by file. Which files start open and the line cap follow DiffViewer.tsx.
struct DiffView: View {
  let diff: String

  var body: some View {
    if diff.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      Text("No diff.").font(.system(size: 13)).foregroundStyle(.secondary)
    } else {
      let files = DiffParser.parse(diff)
      if files.isEmpty {
        Text(diff).font(.system(size: 12, design: .monospaced)).textSelection(.enabled)
      } else {
        LazyVStack(spacing: 8) {
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

  init(file: FileDiff, startsOpen: Bool) {
    self.file = file
    _open = State(initialValue: startsOpen)
  }

  var body: some View {
    VStack(spacing: 0) {
      Button {
        open.toggle()
      } label: {
        HStack(spacing: 8) {
          Image(systemName: "chevron.right")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.secondary)
            .rotationEffect(.degrees(open ? 90 : 0))
            .frame(width: 12)
          Text(file.path).font(.system(size: 12, design: .monospaced)).lineLimit(1).truncationMode(.middle)
          Spacer()
          Changes(add: file.add, del: file.del)
        }
        .padding(.horizontal, 14)
        .frame(height: 38)
        .background(ThreadStyle.surface)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityAddTraits(.isHeader)
      .accessibilityValue(open ? "Expanded" : "Collapsed")

      if open {
        if file.binary {
          Text("Binary file").font(.system(size: 12)).foregroundStyle(.secondary)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        LazyVStack(alignment: .leading, spacing: 0) {
          ForEach(Array(file.shown(all: showAll).enumerated()), id: \.offset) { _, line in
            Text(line.isEmpty ? " " : line)
              .font(.system(size: ThreadStyle.mono, design: .monospaced))
              .foregroundStyle(color(line))
              .padding(.horizontal, 12)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(background(line))
          }
        }
        .textSelection(.enabled)
        if !showAll, file.hiddenLines > 0 {
          Divider()
          Button("Show \(file.hiddenLines) more lines") { showAll = true }
            .buttonStyle(.plain)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 34)
        }
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: 16))
    .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(ThreadStyle.line) }
  }

  private func color(_ line: String) -> Color {
    if line.hasPrefix("@@") { return ThreadStyle.info }
    if line.hasPrefix("\\") { return .secondary.opacity(0.7) }
    return .primary.opacity(0.85)
  }

  private func background(_ line: String) -> Color {
    if line.hasPrefix("@@") { return ThreadStyle.infoBackground }
    if line.hasPrefix("+") { return ThreadStyle.add }
    if line.hasPrefix("-") { return ThreadStyle.delete }
    return .clear
  }
}
