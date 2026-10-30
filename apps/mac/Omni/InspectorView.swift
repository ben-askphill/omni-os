import OmniKit
import SwiftUI
import WebKit

extension View {
  /// The thread's inspector: Artifacts, Changes, Browser, Web, Terminal, Actions and Details in a side panel, its toggle in the toolbar.
  func threadInspector(model: AppModel, store: ThreadStore) -> some View {
    modifier(ThreadInspector(model: model, store: store))
  }
}

/// Remembered open or closed for every thread.
private let inspectorOpenKey = "threadInspector.open"

private struct ThreadInspector: ViewModifier {
  let model: AppModel
  let store: ThreadStore
  @AppStorage(inspectorOpenKey) private var open = true
  @State private var selection: InspectorSelection
  @AppStorage("threadInspector.width") private var width = 360.0

  init(model: AppModel, store: ThreadStore) {
    self.model = model
    self.store = store
    _selection = State(initialValue: .initial(artifacts: store.artifacts, param: Self.param(model.route)))
  }

  private static func param(_ route: Route) -> Int? {
    if case .thread(_, let artifact) = route { artifact } else { nil }
  }

  func body(content: Content) -> some View {
    let count = store.artifacts.count
    GeometryReader { geometry in
      let scale = UIZoom.settings.scale
      let layout = ThreadInspectorLayout(paneWidth: geometry.size.width / scale, requestedPanelWidth: width)
      ZStack(alignment: .trailing) {
        content
          .frame(width: open ? z(layout.threadWidth) : geometry.size.width)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        if open {
          InspectorPanel(model: model, store: store, selection: $selection) { open = false }
            .frame(width: z(layout.panelWidth))
            .frame(maxHeight: .infinity)
            .background(Tok.surface)
            .overlay(alignment: .leading) { Hairline(vertical: true) }
            .overlay(alignment: .leading) {
              SidebarResizeHandle(
                width: $width, initial: 360,
                minimum: layout.minimumPanelWidth, maximum: layout.maximumPanelWidth,
                growsLeft: true, label: "Resize inspector")
            }
        }
      }
      .frame(width: geometry.size.width, height: geometry.size.height)
      .clipped()
    }
    .toolbar {
      // .primaryAction is the leading cluster, right after Back and Forward. The panel belongs to
      // this thread, so the spacer takes it to the trailing edge. Stop is the reply box's send button.
      ToolbarSpacer(.flexible, placement: .primaryAction)
      ToolbarItem(placement: .primaryAction) {
        Button {
          open.toggle()
        } label: {
          HStack(spacing: z(4)) {
            OmniIcon(name: "panel", size: 15)
            if count > 0 { Text("\(count)").font(.omni(size: 11, weight: .medium).monospacedDigit()) }
          }
        }
        .buttonStyle(.icon(size: 28, wide: count > 0))
        .help(count > 0 ? "Artifacts, changes, browser, web, terminal, actions, details (\(count))" : "Artifacts, changes, browser, web, terminal, actions, details")
      }
      .sharedBackgroundVisibility(.hidden)
    }
    .onChange(of: store.arrivedHTML?.id) {
      guard let page = store.arrivedHTML else { return }
      selection.arrived(page)
      open = true
    }
    .onChange(of: Self.param(model.route)) { _, artifact in
      guard let artifact else { return }
      selection.open(artifact: artifact)
      open = true
    }
    .onAppear {
      if Self.param(model.route) != nil { open = true }
      #if DEBUG
      let isOpen = $open
      let picked = $selection
      InspectorProbe.command = { command in
        switch command {
        case .open: isOpen.wrappedValue = true
        case .close: isOpen.wrappedValue = false
        case .artifacts, .changes, .browser, .web, .terminal, .actions, .details:
          isOpen.wrappedValue = true
          picked.wrappedValue.tab = InspectorSelection.Tab(rawValue: command.rawValue) ?? .details
        case .turn:
          isOpen.wrappedValue = true
          picked.wrappedValue.tab = .changes
          ChangesProbe.show(.turn)
        }
      }
      #endif
    }
    #if DEBUG
    .onDisappear { InspectorProbe.command = nil }
    #endif
  }
}

/// View > Show Inspector, with the open thread's artifact count.
struct InspectorCommand: View {
  let model: AppModel
  @AppStorage(inspectorOpenKey) private var open = true

  var body: some View {
    let thread: String? = if case .thread(let id, _) = model.route { id } else { nil }
    let count = thread.flatMap { model.threads.store($0) }?.artifacts.count ?? 0
    Button("\(open ? "Hide" : "Show") Inspector\(count > 0 ? " (\(count))" : "")") { open.toggle() }
      .keyboardShortcut("i", modifiers: [.command, .option])
      .disabled(thread == nil)
  }
}

/// The panel in Thread.tsx: small tabs and a close button over the tab, all on the surface.
private struct InspectorPanel: View {
  let model: AppModel
  let store: ThreadStore
  @Binding var selection: InspectorSelection
  let close: () -> Void

  var body: some View {
    let files = store.files
    VStack(spacing: 0) {
      HStack(spacing: z(4)) {
        // Counts can widen the icon tabs. Keep them scrollable at the narrowest panel width.
        ScrollView(.horizontal) {
          SegmentedPill(
            selection: $selection.tab,
            counted: InspectorSelection.Tab.allCases.map { ($0, $0.title, count($0, files: files.count)) },
            small: true,
            icon: { tab in
              switch tab {
              case .artifacts: "layers"
              case .changes: "diff"
              case .browser: "browser"
              case .web: "globe"
              case .terminal: "terminal"
              case .actions: "play"
              case .details: "info"
              }
            })
            .fixedSize()
        }
        .scrollIndicators(.never)
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        Spacer(minLength: 0)
        Button("Close panel", systemImage: "xmark", action: close)
          .labelStyle(.iconOnly)
          .buttonStyle(.icon(size: 28))
          .help("Close panel")
      }
      .padding(z(10))
      switch selection.tab {
      case .artifacts:
        ArtifactsTab(client: model.client, files: files, selection: $selection)
      case .changes:
        ChangesTab(client: model.client, store: store)
      case .browser:
        BrowserTab(
          client: model.client, channel: store.thread?.channelID, shots: store.screenshots, thread: store.id, draft: store.draftContext,
          deliver: send)
      case .web:
        WebTab(client: model.client, channel: store.thread?.channelID, thread: store.id, draft: store.draftContext, deliver: send)
      case .terminal:
        TerminalTab(client: model.client, thread: store.id, cwd: store.thread?.cwd, draft: store.draftContext)
      case .actions:
        ActionsTab(client: model.client, thread: store.id)
      case .details:
        DetailsTab(model: model, store: store)
      }
    }
    .frame(maxHeight: .infinity, alignment: .top)
    .background(Tok.surface)
    .overlay(alignment: .leading) { Rectangle().fill(Tok.line).frame(width: 1) }
  }

  private func count(_ tab: InspectorSelection.Tab, files: Int) -> Int? {
    let n =
      switch tab {
      case .artifacts: files
      case .browser: store.screenshots.count
      // The Details tab lists them: a count on it says some run while another tab is open.
      case .details: OmniKit.BackgroundTask.runningSubagents(model.store.tasks, in: store.id).count
      default: 0
      }
    return n > 0 ? n : nil
  }

  /// Live Annotate's Send, the reply box's send: the same call and mode (`SendRules`), and the answer merged into the thread.
  private var send: @Sendable (String, MessageContext, String) async throws(OmniAPIError) -> Void {
    { @MainActor [model, store] prompt, record, request throws(OmniAPIError) in
      let thread = store.thread
      let caps = model.store.harnesses.first { $0.id == thread?.harness }?.capabilities
      let canSteer = thread.map { SendRules.canSteer(harness: $0.harness, capabilities: caps) && RunSwitch.queued($0) == nil } ?? false
      let mode = SendRules.mode(busy: thread?.status.isActive ?? false, canSteer: canSteer, shift: false)
      let t = try await model.client.reply(to: store.id, prompt: prompt, mode: mode, files: [], requestID: request, context: [record])
      store.merge(t, isReply: true)
    }
  }
}

private struct ArtifactsTab: View {
  let client: OmniClient
  let files: [Artifact]
  @Binding var selection: InspectorSelection

  var body: some View {
    if files.isEmpty {
      EmptyNote(symbol: "layers", title: "No artifacts yet", message: "Files the agent writes to its artifacts folder show up here and render inline.")
        .panelEmptyNote()
    } else {
      let shown = selection.shown(in: files)
      VStack(spacing: 0) {
        if files.count > 1 {
          ScrollView {
            VStack(spacing: 0) {
              ForEach(files.reversed()) { file in
                let on = file.id == shown?.id
                Button {
                  selection.artifactID = file.id
                } label: {
                  HStack(spacing: z(8)) {
                    OmniIcon(name: TranscriptIcon.artifact(file.kind), size: 13).foregroundStyle(Tok.fg3)
                    Text(file.name)
                      .font(.omni(size: 12.5, weight: .medium))
                      .foregroundStyle(on ? Tok.fg : Tok.fg2)
                      .lineLimit(1)
                      .truncationMode(.middle)
                    Spacer(minLength: z(4))
                    Text(Format.relTime(file.updatedAt)).font(.omni(size: 10.5).monospacedDigit()).foregroundStyle(Tok.fg4)
                  }
                  .padding(.horizontal, z(12))
                  .frame(height: z(32))
                  .contentShape(Capsule())
                  .background(on ? Tok.surface3 : .clear, in: Capsule())
                  .rowHover(radius: 16)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
              }
            }
            .padding(.horizontal, z(8))
            .padding(.bottom, z(8))
          }
          .frame(maxHeight: z(168))
        }
        if let shown {
          ArtifactViewer(client: client, ref: ArtifactRef(shown))
            .background(Tok.bg)
        }
      }
    }
  }
}

#if DEBUG
/// What the QA runner reaches in the inspector: a way to drive it, and the artifact's web view.
@MainActor
enum InspectorProbe {
  static var command: ((QAInspector) -> Void)?
  static weak var webView: WKWebView?

  static func waitForTitle(_ title: String) async throws(QAScriptError) {
    let deadline = ContinuousClock.now + .seconds(10)
    var last = ""
    while ContinuousClock.now < deadline {
      last = webView?.title ?? ""
      if last == title { return }
      try? await Task.sleep(for: .milliseconds(150))
    }
    throw QAScriptError("the page title is \"\(last)\", not \"\(title)\"")
  }
}
#endif
