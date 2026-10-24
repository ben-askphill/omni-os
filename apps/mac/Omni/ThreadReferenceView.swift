import OmniKit
import SwiftUI

/// How the app shows a thread_reference (OmniKit's `ThreadReferenceContext`), as thread-reference.tsx: which thread it
/// named, in which channel, and a button that opens it. The title and channel are the ones captured when the message was
/// sent, so a rename or an archive since does not change what a sent message says.
enum ThreadReferenceView: MessageContextView {
  typealias Kind = ThreadReferenceContext
  static let icon = "message"

  static func detail(_ body: ThreadReferenceContext.Body, record: MessageContext) -> some View {
    ThreadReferenceDetail(reference: body)
  }
}

private struct ThreadReferenceDetail: View {
  let reference: ThreadReferenceContext.Body
  @Environment(\.openURL) private var openURL

  private var when: String {
    OmniJSON.parseDate(reference.capturedAt).map {
      $0.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour(.twoDigits(amPM: .omitted)).minute())
    } ?? reference.capturedAt
  }

  var body: some View {
    VStack(alignment: .leading, spacing: z(2)) {
      Text(reference.title)
        .font(.omni(size: 13, weight: .medium))
        .foregroundStyle(Tok.fg)
        .fixedSize(horizontal: false, vertical: true)
      HStack(spacing: z(6)) {
        Text(reference.channelName).font(.omni(size: 11.5)).foregroundStyle(Tok.fg2)
        if reference.crossChannel { ReferenceBadge(text: "other channel") }
      }
      Text("thread \(ThreadReferenceContext.shortID(reference.thread)) · attached \(when)")
        .font(.omni(size: 11, design: .monospaced))
        .foregroundStyle(Tok.fg4)
      Text("Only this reference went with the message. The agent reads the thread when it needs to.")
        .font(.omni(size: 11.5))
        .foregroundStyle(Tok.fg3)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, z(4))
      Button {
        if let url = URL(string: "omni:#/t/\(reference.thread)") { openURL(url) }
      } label: {
        HStack(spacing: z(6)) {
          OmniIcon(name: "external", size: 13)
          Text("Open thread")
        }
      }
      .buttonStyle(.pill(.ghost, height: 28))
      .padding(.top, z(6))
    }
    .frame(maxWidth: z(320), alignment: .leading)
  }
}

/// The small grey tag after a channel name or a title: "other channel", "archived".
struct ReferenceBadge: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.omni(size: 11))
      .foregroundStyle(Tok.fg3)
      .padding(.horizontal, z(8))
      .padding(.vertical, z(1))
      .background(Tok.surface2, in: Capsule())
  }
}
