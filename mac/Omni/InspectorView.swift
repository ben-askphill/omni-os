import OmniKit
import SwiftUI
import WebKit

extension View {
  /// The thread's inspector: Artifacts, Browser and Details in a side panel, its toggle in the toolbar.
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
    content
      .inspector(isPresented: Binding(get: { open && settled }, set: { open = $0 })) {
        InspectorPanel(model: model, store: store, selection: $selection)
          .inspectorColumnWidth(min: 340, ideal: 420, max: 760)
      }
      .toolbar {
        ToolbarItem(placement: .primaryAction) {
          Button {
            open.toggle()
          } label: {
            HStack(spacing: 4) {
              Image(systemName: "sidebar.trailing")
              if count > 0 { Text("\(count)").font(.system(size: 11, weight: .medium).monospacedDigit()) }
            }
          }
          .help(count > 0 ? "Artifacts, browser, details (\(count))" : "Artifacts, browser, details")
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
          case .artifacts, .browser, .details:
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

private struct InspectorPanel: View {
  let model: AppModel
  let store: ThreadStore
  @Binding var selection: InspectorSelection

  var body: some View {
    let files = store.files
    VStack(spacing: 0) {
      Picker("Inspector", selection: $selection.tab) {
        ForEach(InspectorSelection.Tab.allCases, id: \.self) { tab in
          Text(label(tab, files: files.count)).tag(tab)
        }
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .padding(10)
      Divider()
      switch selection.tab {
      case .artifacts:
        ArtifactsTab(client: model.client, files: files, selection: $selection)
      case .browser:
        BrowserTab(client: model.client, shots: store.screenshots)
      case .details:
        DetailsTab(model: model, store: store)
      }
    }
  }

  private func label(_ tab: InspectorSelection.Tab, files: Int) -> String {
    let n = tab == .artifacts ? files : tab == .browser ? store.screenshots.count : 0
    return n > 0 ? "\(tab.title) \(n)" : tab.title
  }
}

private struct ArtifactsTab: View {
  let client: OmniClient
  let files: [Artifact]
  @Binding var selection: InspectorSelection

  var body: some View {
    if files.isEmpty {
      ContentUnavailableView {
        Label("No artifacts yet", systemImage: "square.stack.3d.up")
      } description: {
        Text("Files the agent writes to its artifacts folder show up here and render inline.")
      }
    } else {
      let shown = selection.shown(in: files)
      VStack(spacing: 0) {
        if files.count > 1 {
          ScrollView {
            VStack(spacing: 1) {
              ForEach(files.reversed()) { file in
                Button {
                  selection.artifactID = file.id
                } label: {
                  HStack(spacing: 8) {
                    Image(systemName: artifactSymbol(file.kind)).font(.system(size: 11)).foregroundStyle(.secondary).frame(width: 16)
                    Text(file.name).font(.system(size: 12.5, weight: .medium)).lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 4)
                    Text(Format.relTime(file.updatedAt)).font(.system(size: 10.5).monospacedDigit()).foregroundStyle(.tertiary)
                  }
                  .padding(.horizontal, 10)
                  .frame(height: 28)
                  .contentShape(Capsule())
                  .background(file.id == shown?.id ? ThreadStyle.surface2 : .clear, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(file.id == shown?.id ? .isSelected : [])
              }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
          }
          .frame(maxHeight: 168)
          Divider()
        }
        if let shown {
          ArtifactViewer(client: client, ref: ArtifactRef(shown))
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
