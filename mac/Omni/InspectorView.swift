import OmniKit
import SwiftUI
import WebKit

extension View {
  /// The thread's inspector: Artifacts, Browser, Terminal and Details in a side panel, its toggle in the toolbar.
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
  /// Presenting the inspector in the same pass that puts the thread on screen loops the window's layout and
  /// traps, so it comes one beat after.
  @State private var settled = false
  @Environment(\.paneTop) private var paneTop
  @State private var contentTop: CGFloat?

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
    // The inspector's split view lays both columns out from the window's top edge, not the pane's, which put
    // the header and the panel's tabs under the toolbar and outside the pane's clip. Push them back down.
    let drop = max(0, (paneTop ?? 0) - (contentTop ?? paneTop ?? 0))
    content
      .padding(.top, drop)
      .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).minY } action: { contentTop = $0 }
      .inspector(isPresented: Binding(get: { open && settled }, set: { open = $0 })) {
        InspectorPanel(model: model, store: store, selection: $selection) { open = false }
          .padding(.top, drop)
          .inspectorColumnWidth(min: 340, ideal: 360, max: 760)
      }
      .toolbar {
        ToolbarItem(placement: .primaryAction) {
          Button {
            open.toggle()
          } label: {
            HStack(spacing: 4) {
              OmniIcon(name: "panel", size: 15)
              if count > 0 { Text("\(count)").font(.omni(size: 11, weight: .medium).monospacedDigit()) }
            }
          }
          .help(count > 0 ? "Artifacts, browser, terminal, details (\(count))" : "Artifacts, browser, terminal, details")
        }
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
      .task {
        try? await Task.sleep(for: .milliseconds(300))
        settled = true
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
          case .artifacts, .browser, .terminal, .details:
            isOpen.wrappedValue = true
            picked.wrappedValue.tab = InspectorSelection.Tab(rawValue: command.rawValue) ?? .details
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
      HStack(spacing: 4) {
        SegmentedPill(
          selection: $selection.tab,
          counted: InspectorSelection.Tab.allCases.map { ($0, $0.title, count($0, files: files.count)) },
          small: true)
        Spacer(minLength: 0)
        Button("Close panel", systemImage: "xmark", action: close)
          .labelStyle(.iconOnly)
          .buttonStyle(.icon(size: 28))
          .help("Close panel")
      }
      .padding(10)
      switch selection.tab {
      case .artifacts:
        ArtifactsTab(client: model.client, files: files, selection: $selection)
      case .browser:
        BrowserTab(client: model.client, channel: store.thread?.channelID, shots: store.screenshots)
      case .terminal:
        TerminalTab(client: model.client, thread: store.id, cwd: store.thread?.cwd)
      case .details:
        DetailsTab(model: model, store: store)
      }
    }
    .frame(maxHeight: .infinity, alignment: .top)
    .background(Tok.surface)
  }

  private func count(_ tab: InspectorSelection.Tab, files: Int) -> Int? {
    let n = tab == .artifacts ? files : tab == .browser ? store.screenshots.count : 0
    return n > 0 ? n : nil
  }
}

private struct ArtifactsTab: View {
  let client: OmniClient
  let files: [Artifact]
  @Binding var selection: InspectorSelection

  var body: some View {
    if files.isEmpty {
      EmptyNote(symbol: "layers", title: "No artifacts yet", message: "Files the agent writes to its artifacts folder show up here and render inline.")
        .frame(maxHeight: .infinity, alignment: .top)
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
                  HStack(spacing: 8) {
                    OmniIcon(name: TranscriptIcon.artifact(file.kind), size: 13).foregroundStyle(Tok.fg3)
                    Text(file.name)
                      .font(.omni(size: 12.5, weight: .medium))
                      .foregroundStyle(on ? Tok.fg : Tok.fg2)
                      .lineLimit(1)
                      .truncationMode(.middle)
                    Spacer(minLength: 4)
                    Text(Format.relTime(file.updatedAt)).font(.omni(size: 10.5).monospacedDigit()).foregroundStyle(Tok.fg4)
                  }
                  .padding(.horizontal, 12)
                  .frame(height: z(32))
                  .contentShape(Capsule())
                  .background(on ? Tok.surface3 : .clear, in: Capsule())
                  .rowHover(radius: 16)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
              }
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
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
