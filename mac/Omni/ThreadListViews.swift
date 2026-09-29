import OmniKit
import SwiftUI

/// The column Home, Channel and Search lay their content in.
struct ScreenColumn<Content: View>: View {
  var width: CGFloat = ThreadStyle.column
  @ViewBuilder var content: Content

  var body: some View {
    ScrollView {
      content
        .frame(maxWidth: width, alignment: .leading)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.bottom, 48)
    }
  }
}

/// A thread in a list, as ThreadRow in ThreadList.tsx.
struct ThreadListRow: View {
  let model: AppModel
  let thread: OmniThread
  var showChannel = false
  @State private var hovering = false

  private static let sources: [ThreadSource: String] = [
    .automation: "Automation", .conductor: "Conductor", .import: "Imported", .capture: "Capture",
  ]

  var body: some View {
    Button {
      model.route = .thread(id: thread.id)
    } label: {
      HStack(alignment: .top, spacing: 12) {
        leading
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 8) {
            Text(thread.title.isEmpty ? "Untitled" : thread.title)
              .font(.system(size: 14))
              .foregroundStyle(Tok.fg)
              .lineLimit(1)
            if let role = thread.role, !role.isEmpty { Chip(text: role) }
            if let source = Self.sources[thread.source] { Chip(text: source, tone: .outline) }
            Spacer(minLength: 8)
            TimelineView(.everyMinute) { _ in
              Text(Format.relTime(thread.updatedAt))
                .font(.system(size: 11))
                .monospacedDigit()
                .foregroundStyle(Tok.fg4)
            }
          }
          HStack(spacing: 6) {
            if showChannel {
              Text("#\(thread.channelID)")
                .foregroundStyle(Tok.fg2)
            }
            if let branch = thread.branch, !branch.isEmpty {
              Text(branch)
                .font(.system(size: 10.5, design: .monospaced))
                .padding(.horizontal, 6)
                .background(ThreadStyle.surface2, in: Capsule())
            }
            Text(preview)
              .lineLimit(1)
          }
          .font(.system(size: 12.5))
          .foregroundStyle(Tok.fg3)
        }
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 10)
      .contentShape(Rectangle())
      .background(hovering ? Tok.surface : .clear, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private var leading: some View {
    if showChannel {
      ChannelAvatar(name: thread.channelID, conductor: thread.channelID == SidebarSections.conductorID, size: 32)
        .overlay(alignment: .bottomTrailing) {
          StatusDot(status: thread.status, size: 8)
            .padding(2)
            .background(Tok.bg, in: Circle())
            .offset(x: 2, y: 2)
        }
    } else {
      StatusDot(status: thread.status)
        .frame(width: 32, height: 32)
        .background(ThreadStyle.surface, in: Circle())
    }
  }

  private var preview: String {
    if let text = thread.lastText, !text.isEmpty {
      return String(text.split(whereSeparator: \.isWhitespace).joined(separator: " ").prefix(240))
    }
    switch thread.status {
    case .running: return "Working"
    case .queued: return "Waiting for a slot"
    default: return ""
    }
  }
}

/// Threads in runs of a day, each under its date, as ThreadGroups in ThreadList.tsx.
struct ThreadDayList: View {
  let model: AppModel
  let threads: [OmniThread]
  var showChannel = false

  var body: some View {
    LazyVStack(alignment: .leading, spacing: 12) {
      ForEach(ThreadListing.byDay(threads)) { group in
        VStack(alignment: .leading, spacing: 0) {
          HStack(spacing: 6) {
            Text(group.label)
            Text("\(group.threads.count)")
              .foregroundStyle(Tok.fg4)
          }
          .omniCaption()
          .padding(.horizontal, 10)
          .padding(.vertical, 6)
          ForEach(group.threads) { ThreadListRow(model: model, thread: $0, showChannel: showChannel) }
        }
      }
    }
  }
}

/// A short centred note where a list would be.
struct EmptyNote: View {
  let symbol: String
  let title: String
  let message: String

  var body: some View {
    VStack(spacing: 8) {
      Image(systemName: symbol)
        .font(.system(size: 19))
        .foregroundStyle(Tok.fg3)
        .frame(width: 48, height: 48)
        .background(Tok.surface2, in: Circle())
        .padding(.bottom, 8)
      Text(title)
        .font(.system(size: 17, weight: .medium))
        .foregroundStyle(Tok.fg)
      Text(message)
        .font(.system(size: 13))
        .foregroundStyle(Tok.fg3)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: 420)
    .frame(maxWidth: .infinity)
    .padding(.vertical, 40)
  }
}
