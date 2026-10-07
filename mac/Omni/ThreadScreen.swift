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
      EmptyNote(symbol: "message", title: "Thread not found", message: "It may have been deleted, or the link is wrong.") {
        Button("Go home") { model.route = .home }
          .buttonStyle(.pill(.secondary))
      }
      .frame(maxHeight: .infinity)
    case .failed(let error):
      VStack {
        ErrorNote(text: error.message) { Task { await store.reload() } }
        Spacer()
      }
      .padding(z(24))
    case .loading:
      HStack(spacing: z(8)) {
        Loader(size: 14)
        Text("Loading thread")
      }
      .font(.omni(size: 13))
      .foregroundStyle(Tok.fg3)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    case .loaded:
      if let thread = store.thread {
        VStack(spacing: 0) {
          ThreadHeader(model: model, store: store, thread: thread)
          TranscriptView(model: model, store: store, ui: ui, markdown: markdown)
          ReplyComposerHost(model: model, store: store, thread: thread)
        }
        #if DEBUG
        .onAppear { QAProbe.expand = { ui.expandAll(store.transcript.items) } }
        .onDisappear { QAProbe.expand = nil }
        #endif
        .threadInspector(model: model, store: store)
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
    HStack(spacing: z(12)) {
      ChannelAvatar(name: channel, conductor: thread.channelID == SidebarSections.conductorID, icon: store.channel?.icon)
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: z(4)) {
          Button("#\(channel)") { model.route = .channel(id: thread.channelID) }
            .buttonStyle(.plain)
            .fixedSize()
          if let parent = store.parent {
            OmniIcon(name: "chevronRight", size: 10)
              .foregroundStyle(Tok.fg4)
            Button(parent.title) { model.route = .thread(id: parent.id) }
              .buttonStyle(.plain)
              .lineLimit(1)
              .truncationMode(.tail)
              .help("Delegated from \(parent.title)")
          }
          if let task = thread.taskID, !task.isEmpty {
            Text(task)
              .font(.omni(size: 10.5))
              .monospacedDigit()
              .foregroundStyle(Tok.fg4)
              .padding(.leading, z(4))
              .fixedSize()
          }
        }
        .font(.omni(size: 12))
        .foregroundStyle(Tok.fg3)
        Text(thread.title)
          .font(.omni(size: 17, weight: .medium))
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
          .truncationMode(.tail)
          .help(thread.title)
          .textSelection(.enabled)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if store.isReconnecting {
        HStack(spacing: z(6)) {
          GlyphView(glyph: .running, size: 6)
          Text("Reconnecting")
        }
        .font(.omni(size: 11))
        .foregroundStyle(Tok.fg3)
        .help("Reconnecting to the live stream")
        .accessibilityElement(children: .combine)
      }
      StatusPill(status: thread.status)
    }
    .padding(.horizontal, z(24))
    .padding(.top, z(12))
    .padding(.bottom, z(8))
  }
}

/// A neutral disc with the channel's icon or first letter, as Avatar in ui.tsx. Conductor wears the ink mark.
struct ChannelAvatar: View {
  let name: String
  var conductor = false
  var size: CGFloat = 34
  /// The channel's own icon (an emoji or `icon:<name>`), in place of the letter.
  var icon: String?

  var body: some View {
    ZStack {
      Circle().fill(conductor ? Tok.fg : Tok.surface2)
      if conductor {
        StaticMark(size: size * 0.55)
          .foregroundStyle(Tok.onInk)
      } else if let mark = ChannelIcon(icon) {
        ChannelMark(icon: mark, size: size * mark.avatarScale)
          .foregroundStyle(Tok.fg2)
      } else {
        Text(AvatarMark(name: name).letter)
          .font(.omni(size: size * 0.42, weight: .medium, design: .rounded))
          .foregroundStyle(Tok.fg2)
      }
    }
    .frame(width: z(size), height: z(size))
    .accessibilityHidden(true)
  }
}

/// A channel's own icon: the emoji, the design system icon in the text color, or the uploaded SVG in its own colors.
struct ChannelMark: View {
  let icon: ChannelIcon
  let size: CGFloat

  var body: some View {
    switch icon {
    case .glyph(let name): OmniIcon(name: name, size: size)
    case .emoji(let text):
      // An emoji is wider than its font size; scale it down to fit the box so a row never clips it.
      Text(text).font(.omni(size: size * 0.85)).lineLimit(1).fixedSize().frame(width: z(size), height: z(size))
    case .svg(let markup):
      if let image = SVGIconCache.image(markup) {
        Image(nsImage: image)
          .resizable()
          .interpolation(.high)
          .scaledToFit()
          .frame(width: z(size), height: z(size))
      } else {
        OmniIcon(name: "image", size: size)
      }
    }
  }
}

extension ChannelIcon {
  /// Its size in a ChannelAvatar, as a share of the disc, as in Avatar in ui.tsx.
  var avatarScale: CGFloat {
    switch self {
    case .glyph: 0.5
    case .emoji: 0.52
    case .svg: 0.58
    }
  }
}

/// Uploaded SVGs, parsed once each: the sidebar redraws its rows often. NSImage draws SVG itself (NSSVGImageRep)
/// and runs nothing in it.
@MainActor enum SVGIconCache {
  private static var images: [String: NSImage] = [:]

  static func image(_ markup: String) -> NSImage? {
    if let hit = images[markup] { return hit }
    guard let image = NSImage(data: Data(markup.utf8)), image.isValid else { return nil }
    if images.count > 64 { images.removeAll() }
    images[markup] = image
    return image
  }
}

/// A failure: the vermilion diamond carries the alarm, the text stays ink.
struct ErrorNote: View {
  let text: String
  var retry: (() -> Void)?

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: z(10)) {
      GlyphView(glyph: .needs, size: 8)
        .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
      Text(text)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .textSelection(.enabled)
      if let retry {
        Button("Retry", action: retry)
          .buttonStyle(.pill(.secondary, height: 26))
      }
    }
    .font(.omni(size: 13))
    .foregroundStyle(Tok.fg)
    .padding(.horizontal, z(16))
    .padding(.vertical, z(10))
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
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
        .frame(maxWidth: ThreadStyle.thread)
        .padding(.horizontal, z(24))
        .padding(.top, z(16))
        .padding(.bottom, z(40))
        .frame(maxWidth: .infinity)
        .foregroundStyle(Tok.fg)
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
        HStack(spacing: z(6)) {
          OmniIcon(name: "chevronDown", size: 13)
          Text("New activity")
        }
        .font(.omni(size: 12, weight: .medium))
        .foregroundStyle(Tok.fg)
        .padding(.horizontal, z(14))
        .frame(height: z(32))
        .background(Tok.elev, in: Capsule())
        .menuShadow(16)
        .contentShape(Capsule())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("New activity")
      .padding(.bottom, z(16))
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
    let agents = Set(model.store.tasks.filter { $0.threadID == store.id }.compactMap(\.toolUseID))
    let known = Dictionary((store.children + store.team).map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })
    let members = Delegation.team(of: store.children)
    let pages = PublishedPage.byGroup(transcript.items)
    let first = transcript.items.first?.id
    let live: TranscriptItemID? =
      if case .tools(let g)? = transcript.last, transcript.isLive(g, running: running) { .event(g.eventID) } else { nil }
    LazyVStack(alignment: .leading, spacing: z(16)) {
      if let error = store.refreshError {
        ErrorNote(text: error.message) { Task { await store.reload() } }
      }
      ForEach(transcript.items) { item in
        TranscriptRow(
          item: item, live: item.id == live, running: running, cwd: cwd, threadID: store.id, model: model, ui: ui,
          markdown: markdown, agents: agents, known: known, pages: pages, artifacts: store.artifacts
        )
        .copyMenu { TranscriptMarkdown.copyText(item, cwd: cwd) }
        // A team lead's members, under its brief.
        if item.id == first, case .user = item, !members.isEmpty {
          DelegationCard(delegation: Delegation(id: "team", lead: nil, branches: members), team: true, model: model)
        }
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
  var agents: Set<String> = []
  /// Threads this one started and their team members, for the delegation cards.
  var known: [String: OmniThread] = [:]
  /// Pages the thread published, by the tool group that shows each one's card.
  var pages: [Int: [PublishedPage]] = [:]
  var artifacts: [Artifact] = []

  var body: some View {
    switch item {
    case .user(let id, let at, let message):
      CopyableMessage(text: message.text, alignment: .trailing) {
        UserBubbleView(eventID: id, at: at, message: message, threadID: threadID, client: model.client, ui: ui)
      }
    case .text(let id, _, let text):
      CopyableMessage(text: text) {
        MarkdownView(document: markdown.document(for: id, text: text))
      }
    case .tools(let group):
      let cards = Delegation.of(group.calls).map { d in
        Delegation(id: d.id, lead: d.lead?.live(known), branches: d.branches.map { $0.live(known) })
      }
      // Sub-agents and the delegations that worked show as cards; the group keeps every other call.
      let (subagents, rest, agentsFirst) = Delegation.split(group.calls)
      VStack(alignment: .leading, spacing: z(16)) {
        if agentsFirst { subagentCard(subagents) }
        if !rest.isEmpty {
          let kept = group.keeping(rest)
          ToolGroupView(group: kept, live: live && kept.hasPending, running: running, cwd: cwd, ui: ui, agents: agents)
        }
        if !agentsFirst { subagentCard(subagents) }
        ForEach(cards) { DelegationCard(delegation: $0, model: model) }
        ForEach(pages[group.eventID] ?? []) { page in
          PublishedCard(page: page, threadID: threadID, artifact: artifacts.last { $0.url == page.url }, model: model)
        }
      }
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

  @ViewBuilder private func subagentCard(_ calls: [ToolCall]) -> some View {
    if !calls.isEmpty {
      DelegationCard(
        delegation: Delegation(id: "agents", lead: nil, branches: []), model: model,
        agents: AgentRows(calls: calls, live: agents, running: running, cwd: cwd, ui: ui))
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
