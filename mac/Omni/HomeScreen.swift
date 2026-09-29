import OmniKit
import SwiftUI

/// The `#/` screen: a greeting, the new-thread composer and the recent threads, as Home.tsx.
struct HomeScreen: View {
  let model: AppModel
  @State private var filter = ThreadFilter.all

  var body: some View {
    let recent = model.store.recent
    let shown = filter.apply(to: recent)
    ScreenColumn {
      VStack(alignment: .leading, spacing: 0) {
        header
          .padding(.top, 40)
          .padding(.bottom, 20)
        NewThreadComposerView(model: model, channelID: nil, big: true)
        HStack {
          Text("Recent")
            .font(.system(size: 17, weight: .medium))
            .tracking(-0.17)
            .foregroundStyle(Tok.fg)
          Spacer()
          SegmentedPill(selection: $filter, counted: ThreadFilter.allCases.map { f in
            (f, label(f), f == .all ? nil : f.apply(to: recent).count)
          }, small: true)
          .accessibilityLabel("Filter threads")
        }
        .padding(.top, 40)
        .padding(.bottom, 8)
        .padding(.horizontal, 4)
        list(shown, recent: recent)
      }
    }
  }

  private var header: some View {
    HStack(alignment: .bottom) {
      VStack(alignment: .leading, spacing: 0) {
        StaticMark(size: 40)
          .foregroundStyle(Tok.fg)
        TimelineView(.everyMinute) { context in
          VStack(alignment: .leading, spacing: 0) {
            Text(context.date.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: "en_GB"))))
              .omniCaption()
              .padding(.top, 16)
              .padding(.bottom, 10)
            Text(Greeting.text(hour: Calendar.current.component(.hour, from: context.date)))
              .font(.system(size: 36, weight: .medium))
              .tracking(-0.36)
              .foregroundStyle(Tok.fg)
          }
        }
      }
      Spacer()
      if let status = model.store.status { Pulse(status: status) }
    }
    .padding(.horizontal, 4)
  }

  /// The web says Active where OmniKit says Running.
  private func label(_ f: ThreadFilter) -> String {
    f == .active ? "Active" : f.label
  }

  @ViewBuilder private func list(_ shown: [OmniThread], recent: [OmniThread]) -> some View {
    if !shown.isEmpty {
      ThreadDayList(model: model, threads: shown, showChannel: true)
    } else if recent.isEmpty && model.store.loadState == .loading {
      Loader(size: 16).foregroundStyle(Tok.fg3).frame(maxWidth: .infinity).padding(.vertical, 40)
    } else {
      switch filter {
      case .all:
        EmptyNote(symbol: "bubble.left", title: "Nothing here yet", message: "Start a thread above. Every task gets its own thread in a channel, so it stays findable.")
      case .active:
        EmptyNote(symbol: "checkmark", title: "Nothing running", message: "Threads that are running or queued show up here.")
      case .failed:
        EmptyNote(symbol: "checkmark", title: "Nothing failed", message: "Failed and stopped threads from the recent list show up here.")
      }
    }
  }
}

enum Greeting {
  static func text(hour: Int) -> String {
    hour < 5 ? "Late one, Ben" : hour < 12 ? "Morning, Ben" : hour < 18 ? "Afternoon, Ben" : "Evening, Ben"
  }
}

/// "3 running" or "All quiet", with what is queued.
private struct Pulse: View {
  let status: Status

  var body: some View {
    let busy = status.running > 0
    HStack(spacing: 8) {
      GlyphView(glyph: busy ? .running : .idle, size: 7)
      Text(busy ? "\(status.running) running" : "All quiet")
      if status.queued > 0 {
        Text("· \(status.queued) queued")
          .foregroundStyle(Tok.fg4)
      }
    }
    .font(.system(size: 11.5))
    .monospacedDigit()
    .foregroundStyle(Tok.fg2)
    .padding(.horizontal, 12)
    .frame(height: 28)
    .background(Tok.surface, in: Capsule())
  }
}
