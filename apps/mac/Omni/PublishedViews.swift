import OmniKit
import SwiftUI

/// PublishedCard in PublishedPage.tsx: a page the thread published to claude.ai, shown once, after the last call
/// that published it. Opens the page, previews the linked file, and asks the thread to act on its comments.
struct PublishedCard: View {
  let page: PublishedPage
  let threadID: String
  /// The thread's file linked to the page's url, if Omni has one.
  let artifact: Artifact?
  let model: AppModel
  @Environment(\.openURL) private var openURL
  @State private var comments = CommentsAsk.idle

  var body: some View {
    VStack(alignment: .leading, spacing: z(10)) {
      HStack(alignment: .top, spacing: z(12)) {
        OmniIcon(name: "globe", size: 15)
          .foregroundStyle(Tok.fg3)
          .frame(width: z(32), height: z(32))
          .background(Tok.bg, in: Circle())
        VStack(alignment: .leading, spacing: z(2)) {
          HStack(alignment: .firstTextBaseline, spacing: z(8)) {
            Text(page.title)
              .font(.omni(size: 13.5, weight: .medium))
              .foregroundStyle(Tok.fg)
              .lineLimit(1)
              .truncationMode(.middle)
            Text(page.update ? "Republished on claude.ai" : "Published on claude.ai")
              .font(.omni(size: 11.5))
              .foregroundStyle(Tok.fg4)
              .fixedSize()
          }
          if let text = page.description {
            Text(text)
              .font(.omni(size: 12.5))
              .foregroundStyle(Tok.fg3)
              .lineLimit(2)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      HStack(spacing: z(6)) {
        if let link = URL(string: page.url) {
          Button { openURL(link) } label: {
            Label { Text("Open") } icon: { OmniIcon(name: "external", size: 13) }
          }
          .buttonStyle(.pill(.primary, height: 28))
        }
        if let artifact {
          Button { model.route = .thread(id: threadID, artifact: artifact.id) } label: {
            Label { Text("Preview") } icon: { OmniIcon(name: "layers", size: 13) }
          }
          .buttonStyle(.pill(.secondary, height: 28))
        }
        Button {
          Task {
            comments = .sending
            comments = await CommentsAsk.run(client: model.client, threadID: threadID, url: page.url)
          }
        } label: {
          Label { Text(comments == .sent ? "Asked, runs after this turn" : "Check comments") } icon: {
            OmniIcon(name: comments == .sent ? "check" : "message", size: 13)
          }
        }
        .buttonStyle(.pill(.ghost, height: 28))
        .disabled(comments == .sending || comments == .sent)
        .help(comments.help)
        if case .failed(let message) = comments {
          Text(message).font(.omni(size: 11.5)).foregroundStyle(Tok.fg2).lineLimit(1)
        }
      }
      .padding(.leading, z(44))
    }
    .padding(.horizontal, z(16))
    .padding(.vertical, z(12))
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(22), style: .continuous))
    .accessibilityElement(children: .contain)
  }
}
