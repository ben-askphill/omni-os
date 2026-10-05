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
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .top, spacing: 12) {
        OmniIcon(name: "globe", size: 15)
          .foregroundStyle(Tok.fg3)
          .frame(width: 32, height: 32)
          .background(Tok.bg, in: Circle())
        VStack(alignment: .leading, spacing: 2) {
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(page.title)
              .font(.system(size: 13.5, weight: .medium))
              .foregroundStyle(Tok.fg)
              .lineLimit(1)
              .truncationMode(.middle)
            Text(page.update ? "Republished on claude.ai" : "Published on claude.ai")
              .font(.system(size: 11.5))
              .foregroundStyle(Tok.fg4)
              .fixedSize()
          }
          if let text = page.description {
            Text(text)
              .font(.system(size: 12.5))
              .foregroundStyle(Tok.fg3)
              .lineLimit(2)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      HStack(spacing: 6) {
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
          Text(message).font(.system(size: 11.5)).foregroundStyle(Tok.fg2).lineLimit(1)
        }
      }
      .padding(.leading, 44)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    .accessibilityElement(children: .contain)
  }
}
