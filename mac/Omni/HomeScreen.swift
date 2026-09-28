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
            .font(.system(size: 17, weight: .semibold))
          Spacer()
          Picker("Filter threads", selection: $filter) {
            ForEach(ThreadFilter.allCases, id: \.self) { f in
              Text(title(f, recent: recent)).tag(f)
            }
          }
          .pickerStyle(.segmented)
          .labelsHidden()
          .fixedSize()
        }
        .padding(.top, 36)
        .padding(.bottom, 8)
        .padding(.horizontal, 4)
        list(shown, recent: recent)
      }
    }
  }

  private var header: some View {
    HStack(alignment: .bottom) {
      VStack(alignment: .leading, spacing: 8) {
        TimelineView(.everyMinute) { context in
          VStack(alignment: .leading, spacing: 8) {
            Text(context.date.formatted(.dateTime.weekday(.wide).day().month(.wide)).uppercased())
              .font(.system(size: 11, weight: .medium))
              .tracking(0.8)
              .foregroundStyle(.tertiary)
            Text(Greeting.text(hour: Calendar.current.component(.hour, from: context.date)))
              .font(.system(size: 34, weight: .semibold))
          }
        }
      }
      Spacer()
      if let status = model.store.status { Pulse(status: status) }
    }
    .padding(.horizontal, 4)
  }

  private func title(_ f: ThreadFilter, recent: [OmniThread]) -> String {
    let n = f == .all ? 0 : f.apply(to: recent).count
    return n > 0 ? "\(f.label) \(n)" : f.label
  }

  @ViewBuilder private func list(_ shown: [OmniThread], recent: [OmniThread]) -> some View {
    if !shown.isEmpty {
      ThreadDayList(model: model, threads: shown, showChannel: true)
    } else if recent.isEmpty && model.store.loadState == .loading {
      ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(.vertical, 40)
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
      Circle()
        .fill(busy ? ThreadStyle.info : ThreadStyle.ok)
        .frame(width: 6, height: 6)
      Text(busy ? "\(status.running) running" : "All quiet")
      if status.queued > 0 {
        Text("\(status.queued) queued")
          .foregroundStyle(.tertiary)
      }
    }
    .font(.system(size: 11.5))
    .monospacedDigit()
    .foregroundStyle(.secondary)
    .padding(.horizontal, 12)
    .frame(height: 28)
    .background(ThreadStyle.surface, in: Capsule())
  }
}
