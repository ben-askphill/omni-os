import OmniKit
import SwiftUI

/// What a PR watch woke the thread for, under its line in the transcript, as `PRWakeList` in
/// apps/web/src/components/thread/PRWatch.tsx: who commented or which check failed, a link to it on GitHub and a
/// bounded excerpt. The server keeps the first few and counts the rest in `more`.
struct PRWakeListView: View {
  let items: [PRWakeItem]
  let more: Int

  var body: some View {
    VStack(alignment: .leading, spacing: z(8)) {
      Hairline().padding(.top, z(2))
      ForEach(Array(items.enumerated()), id: \.offset) { _, item in
        VStack(alignment: .leading, spacing: z(2)) {
          HStack(spacing: z(6)) {
            Text(item.label).fontWeight(.medium).foregroundStyle(Tok.fg2).lineLimit(1)
            if let kind = item.kind { Text(kind).foregroundStyle(Tok.fg4).lineLimit(1) }
            Spacer(minLength: z(8))
            if let link = item.url.flatMap(URL.init(string:)) {
              Link(destination: link) { Image(systemName: "arrow.up.right.square").imageScale(.small) }
                .foregroundStyle(Tok.fg4)
                .help("Open on GitHub")
                .accessibilityLabel("Open \(item.label) on GitHub")
            }
          }
          if let excerpt = item.excerpt, !excerpt.isEmpty {
            Text(excerpt).foregroundStyle(Tok.fg3).lineLimit(3).fixedSize(horizontal: false, vertical: true)
          }
        }
      }
      if more > 0 { Text("and \(more) more").foregroundStyle(Tok.fg4) }
    }
    .font(.omni(size: ThreadStyle.small))
    .textSelection(.enabled)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
