import OmniKit
import SwiftUI

/// How the app shows a diff_selection (OmniKit's `DiffSelectionContext`), as diff-selection.tsx: which lines of which
/// file, where they came from, and the rows as Ben saw them.
enum DiffSelectionView: MessageContextView {
  typealias Kind = DiffSelectionContext
  static let icon = "diff"

  static func detail(_ body: DiffSelectionContext.Body, record: MessageContext) -> some View {
    DiffSelectionDetail(selection: body)
  }
}

private struct DiffSelectionDetail: View {
  let selection: DiffSelectionContext.Body
  @State private var rowsHeight: CGFloat = 0

  private static let sign: [DiffSelectionContext.RowKind: String] = [.add: "+", .del: "-", .context: " "]

  var body: some View {
    VStack(alignment: .leading, spacing: z(2)) {
      let path = selection.oldPath.map { "\($0) → \(selection.path)" } ?? selection.path
      Text(path)
        .font(.omni(size: 12, design: .monospaced))
        .foregroundStyle(Tok.fg)
        .lineLimit(1)
        .truncationMode(.middle)
        .help(path)
      Text(DiffSelectionContext.range(selection))
        .font(.omni(size: 11.5))
        .foregroundStyle(Tok.fg2)
      Text(DiffSelectionContext.sourceLine(selection))
        .font(.omni(size: 11, design: .monospaced))
        .foregroundStyle(Tok.fg4)
        .lineLimit(1)
        .truncationMode(.tail)
      ScrollView([.horizontal, .vertical]) {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(selection.rows.enumerated()), id: \.offset) { _, row in
            HStack(alignment: .firstTextBaseline, spacing: 0) {
              number(row.old)
              number(row.new)
              Text("\(Self.sign[row.kind] ?? " ")\(row.text)\(Text(row.cut == true ? "…" : "").foregroundStyle(Tok.fg4))")
                .foregroundStyle(row.kind == .context ? Tok.fg2 : Tok.fg)
                .padding(.leading, z(4))
                .padding(.trailing, z(12))
                .fixedSize()
            }
            .padding(.vertical, z(1))
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(row.kind == .add ? Tok.diffAdd : row.kind == .del ? Tok.diffDelete : .clear)
          }
        }
        .font(.omni(size: 11.5, design: .monospaced))
        .padding(.vertical, z(4))
        .textSelection(.enabled)
      }
      // As tall as the rows, up to the cap: a two-axis ScrollView's own ideal height leaves one row in a tall box.
      .onScrollGeometryChange(for: CGFloat.self) { $0.contentSize.height } action: { _, h in rowsHeight = h }
      .frame(height: min(rowsHeight, z(256)))
      .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(12), style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: z(12), style: .continuous).strokeBorder(Tok.line))
      .padding(.top, z(6))
    }
  }

  private func number(_ n: Int?) -> some View {
    Text(n.map(String.init) ?? "")
      .foregroundStyle(Tok.fg4)
      .monospacedDigit()
      .frame(width: z(36), alignment: .trailing)
      .padding(.trailing, z(4))
      .accessibilityHidden(true)
  }
}
