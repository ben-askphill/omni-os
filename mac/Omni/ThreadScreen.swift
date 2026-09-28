import OmniKit
import SwiftUI

/// The `#/t/<id>` screen. It holds the thread's store while it shows, so the stream stays open only as long
/// as something shows the thread.
struct ThreadScreen: View {
  let model: AppModel
  let id: String
  @State private var store: ThreadStore?

  private struct Hold: Hashable {
    let registry: ObjectIdentifier
    let id: String
  }

  var body: some View {
    Group {
      if let store, store.id == id {
        ThreadView(model: model, store: store)
          .id(ObjectIdentifier(store))
      } else {
        Color.clear
      }
    }
    .task(id: Hold(registry: ObjectIdentifier(model.threads), id: id)) {
      let registry = model.threads
      let id = self.id
      #if DEBUG
      QAProbe.shownThread = nil
      #endif
      store = registry.acquire(id)
      while !Task.isCancelled { try? await Task.sleep(for: .seconds(86_400)) }
      registry.release(id)
    }
  }
}

private struct ThreadView: View {
  let model: AppModel
  let store: ThreadStore
  @State private var ui = TranscriptUI()
  @State private var markdown = MarkdownCache<Int>()

  var body: some View {
    switch store.loadState {
    case .notFound:
      ContentUnavailableView {
        Label("Thread not found", systemImage: "text.bubble")
      } description: {
        Text("It may have been deleted, or the link is wrong.")
      } actions: {
        Button("Go Home") { model.route = .home }
      }
    case .failed(let error):
      VStack {
        ErrorNote(text: error.message) { Task { await store.reload() } }
        Spacer()
      }
      .padding(24)
    case .loading:
      ProgressView("Loading thread")
        .controlSize(.small)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    case .loaded:
      if let thread = store.thread {
        VStack(spacing: 0) {
          ThreadHeader(model: model, store: store, thread: thread)
          TranscriptView(model: model, store: store, ui: ui, markdown: markdown)
        }
        #if DEBUG
        .onAppear { QAProbe.expand = { ui.expandAll(store.transcript.items) } }
        .onDisappear { QAProbe.expand = nil }
        #endif
      }
    }
  }
}

/// Channel, parent and task over the title, and the status, as the header in Thread.tsx.
private struct ThreadHeader: View {
  let model: AppModel
  let store: ThreadStore
  let thread: OmniThread

  var body: some View {
    let channel = store.channel?.name ?? thread.channelID
    HStack(spacing: 12) {
      ChannelAvatar(name: channel, conductor: thread.channelID == SidebarSections.conductorID)
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 4) {
          Button("#\(channel)") { model.route = .channel(id: thread.channelID) }
            .buttonStyle(.plain)
            .fixedSize()
          if let parent = store.parent {
            Image(systemName: "chevron.right")
              .font(.system(size: 9, weight: .semibold))
              .foregroundStyle(.tertiary)
            Button(parent.title) { model.route = .thread(id: parent.id) }
              .buttonStyle(.plain)
              .lineLimit(1)
              .truncationMode(.tail)
              .help("Delegated from \(parent.title)")
          }
          if let task = thread.taskID, !task.isEmpty {
            Text(task)
              .font(.system(size: 10.5))
              .monospacedDigit()
              .foregroundStyle(.tertiary)
              .padding(.leading, 4)
              .fixedSize()
          }
        }
        .font(.system(size: 12))
        .foregroundStyle(.secondary)
        Text(thread.title)
          .font(.system(size: 17, weight: .semibold))
          .lineLimit(1)
          .truncationMode(.tail)
          .help(thread.title)
          .textSelection(.enabled)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if store.isReconnecting {
        HStack(spacing: 6) {
          Image(systemName: "circle.fill")
            .font(.system(size: 6))
            .symbolEffect(.pulse)
          Text("Reconnecting")
        }
        .font(.system(size: 11))
        .foregroundStyle(ThreadStyle.warn)
        .help("Reconnecting to the live stream")
        .accessibilityElement(children: .combine)
      }
      StatusPill(status: thread.status)
    }
    .padding(.horizontal, 24)
    .padding(.top, 12)
    .padding(.bottom, 8)
  }
}

/// A round badge in the name's hue with its first letter, as Avatar in ui.tsx.
struct ChannelAvatar: View {
  let name: String
  var conductor = false
  var size: CGFloat = 34

  var body: some View {
    let mark = AvatarMark(name: name)
    let hue = Double(mark.hue) / 360
    ZStack {
      Circle().fill(Self.dynamic(light: NSColor(hue: hue, saturation: 0.13, brightness: 0.95, alpha: 1),
                                 dark: NSColor(hue: hue, saturation: 0.35, brightness: 0.34, alpha: 1)))
      Group {
        if conductor {
          Image(systemName: "scope").font(.system(size: size * 0.45))
        } else {
          Text(mark.letter).font(.system(size: size * 0.42, weight: .medium, design: .rounded))
        }
      }
      .foregroundStyle(Self.dynamic(light: NSColor(hue: hue, saturation: 0.55, brightness: 0.45, alpha: 1),
                                    dark: NSColor(hue: hue, saturation: 0.18, brightness: 0.92, alpha: 1)))
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }

  private static func dynamic(light: NSColor, dark: NSColor) -> Color {
    Color(nsColor: NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light })
  }
}

struct ErrorNote: View {
  let text: String
  var retry: (() -> Void)?

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Image(systemName: "exclamationmark.circle")
      Text(text)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .textSelection(.enabled)
      if let retry {
        Button("Retry", action: retry)
          .buttonStyle(.plain)
          .fontWeight(.medium)
          .underline()
      }
    }
    .font(.system(size: 13))
    .foregroundStyle(ThreadStyle.bad)
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .background(ThreadStyle.badBackground, in: RoundedRectangle(cornerRadius: 16))
    .accessibilityElement(children: .contain)
  }
}

/// The auto scroll's state. Only whether the pill shows is observed, so a scroll does not lay the rows out again.
@MainActor @Observable
private final class PinState {
  @ObservationIgnored private var pin = ScrollPin()
  @ObservationIgnored private(set) var geometry: ScrollPin.Geometry?
  private(set) var showsJump = false

  func eventsChanged(_ count: Int) -> Bool {
    defer { sync() }
    return pin.eventsChanged(count: count)
  }

  func geometryChanged(_ g: ScrollPin.Geometry) -> Bool {
    geometry = g
    defer { sync() }
    return pin.geometryChanged(g)
  }

  func jump() {
    pin.jump()
    sync()
  }

  private func sync() {
    if showsJump != pin.showsJump { showsJump = pin.showsJump }
  }
}

/// The rows in a lazy stack that follows the bottom while Ben is near it, with the New activity pill when he
/// is not, as the transcript in Thread.tsx.
private struct TranscriptView: View {
  let model: AppModel
  let store: ThreadStore
  let ui: TranscriptUI
  let markdown: MarkdownCache<Int>
  @State private var pin = PinState()
  @State private var position = ScrollPosition(edge: .bottom)

  var body: some View {
    ScrollView {
      TranscriptRows(model: model, store: store, ui: ui, markdown: markdown)
        .frame(maxWidth: ThreadStyle.column)
        .padding(.horizontal, 24)
        .padding(.top, 16)
        .padding(.bottom, 40)
        .frame(maxWidth: .infinity)
    }
    .scrollPosition($position)
    .defaultScrollAnchor(.bottom, for: .initialOffset)
    .onScrollGeometryChange(for: ScrollPin.Geometry.self) { g in
      ScrollPin.Geometry(
        offset: g.contentOffset.y, contentHeight: g.contentSize.height + g.contentInsets.bottom,
        viewportHeight: g.containerSize.height)
    } action: { _, g in
      if pin.geometryChanged(g) { position.scrollTo(edge: .bottom) }
      #if DEBUG
      QAProbe.laidOut(store, g)
      #endif
    }
    .onChange(of: store.events.count, initial: true) { _, count in
      if pin.eventsChanged(count) { position.scrollTo(edge: .bottom) }
    }
    .overlay(alignment: .bottom) {
      NewActivityPill(pin: pin) {
        pin.jump()
        withAnimation(.smooth(duration: 0.3)) { position.scrollTo(edge: .bottom) }
      }
    }
    .modifier(ThreadLinks(model: model))
    #if DEBUG
    .onAppear { QAProbe.scroller = scroller }
    .onDisappear { QAProbe.scroller = nil }
    #endif
  }

  #if DEBUG
  private var scroller: QAProbe.Scroller {
    QAProbe.Scroller(
      toTop: { position.scrollTo(edge: .top) },
      toBottom: {
        pin.jump()
        position.scrollTo(edge: .bottom)
      },
      pageUp: {
        guard let g = pin.geometry, g.offset > 0.5 else { return false }
        position.scrollTo(y: max(0, g.offset - g.viewportHeight / 2))
        return true
      })
  }
  #endif
}

private struct NewActivityPill: View {
  let pin: PinState
  let jump: () -> Void

  var body: some View {
    if pin.showsJump {
      Button(action: jump) {
        Label("New activity", systemImage: "chevron.down")
          .font(.system(size: 12, weight: .medium))
          .padding(.horizontal, 6)
          .padding(.vertical, 2)
      }
      .buttonStyle(.glass)
      .buttonBorderShape(.capsule)
      .padding(.bottom, 16)
      .transition(.scale(scale: 0.9).combined(with: .opacity))
    }
  }
}

private struct TranscriptRows: View {
  let model: AppModel
  let store: ThreadStore
  let ui: TranscriptUI
  let markdown: MarkdownCache<Int>

  var body: some View {
    // Queued means waiting for a slot: nothing is working yet.
    let running = store.thread?.status == .running
    let cwd = store.cwd
    let transcript = store.transcript
    let live: TranscriptItemID? =
      if case .tools(let g)? = transcript.last, transcript.isLive(g, running: running) { .event(g.eventID) } else { nil }
    LazyVStack(alignment: .leading, spacing: 16) {
      if let error = store.refreshError {
        ErrorNote(text: error.message) { Task { await store.reload() } }
      }
      ForEach(transcript.items) { item in
        TranscriptRow(
          item: item, live: item.id == live, running: running, cwd: cwd, threadID: store.id, model: model, ui: ui,
          markdown: markdown
        )
        .copyMenu { TranscriptMarkdown.copyText(item, cwd: cwd) }
      }
      if let line = store.workingLine {
        WorkingLine(text: line)
      }
      if !store.pending.isEmpty {
        QueuedMessagesView(items: store.pending, starting: store.betweenTurns)
      }
    }
  }
}

private struct TranscriptRow: View {
  let item: TranscriptItem
  let live: Bool
  let running: Bool
  let cwd: String?
  let threadID: String
  let model: AppModel
  let ui: TranscriptUI
  let markdown: MarkdownCache<Int>

  var body: some View {
    switch item {
    case .user(let id, let at, let message):
      UserBubbleView(eventID: id, at: at, message: message, threadID: threadID, client: model.client, ui: ui)
    case .text(let id, _, let text):
      MarkdownView(document: markdown.document(for: id, text: text))
    case .tools(let group):
      ToolGroupView(group: group, live: live, running: running, cwd: cwd, ui: ui)
    case .plan(let plan):
      PlanCard(plan: plan)
    case .result(_, let result):
      ResultLineView(result: result)
    case .error(_, let text):
      ErrorCallout(text: text)
    case .report(let id, _, let report):
      ReportCard(report: report, document: markdown.document(for: id, text: report.text.isEmpty ? "(no reply)" : report.text), model: model)
    }
  }
}

#if DEBUG
/// What the QA runner reads off the thread screen: which transcript is laid out and since when, and a way to
/// scroll it.
@MainActor
enum QAProbe {
  struct Scroller {
    let toTop: () -> Void
    let toBottom: () -> Void
    /// Up by half a screen. false once at the top.
    let pageUp: () -> Bool
  }

  static var shownThread: String?
  static var shownAt: ContinuousClock.Instant?
  static var scroller: Scroller?
  static var expand: (() -> Void)?

  static func laidOut(_ store: ThreadStore, _ g: ScrollPin.Geometry) {
    guard shownThread != store.id, store.loadState == .loaded, g.contentHeight > 0 else { return }
    shownThread = store.id
    shownAt = .now
  }
}
#endif
