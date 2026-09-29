import OmniKit
import SwiftUI

/// The sidebar and the screen for the route, or the server screen while there is no server to talk to.
struct MainWindow: View {
  let model: AppModel
  let updater: Updater
  @Environment(\.openSettings) private var openSettings
  @AppStorage(sidebarShownKey) private var sidebarShown = true
  @State private var paneTop: CGFloat?

  var body: some View {
    HStack(spacing: 0) {
      if sidebarShown {
        SidebarView(model: model)
          .transition(.move(edge: .leading).combined(with: .opacity))
      }
      // The pane: a white card with a hairline edge, inset from the canvas, as the main in App.tsx.
      VStack(spacing: 0) {
        UpdateBar(updater: updater)
        DetailView(model: model)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
      .environment(\.paneTop, paneTop)
      .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).minY } action: { paneTop = $0 }
      .overlay(alignment: .bottomTrailing) { BannerStack(model: model) }
      .background(Tok.bg)
      .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
      .cardShadow(22)
      .padding(.leading, sidebarShown ? 0 : 8)
      .padding([.trailing, .bottom], 8)
    }
    .background(Tok.canvas.ignoresSafeArea())
    .tint(Tok.fg)
    .navigationTitle(model.title)
    .toolbar(removing: .title)
    .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
    .toolbar { toolbar }
    .overlay { PaletteOverlay(model: model) }
    .modifier(ThreadWindowSupport(model: model))
    .frame(minWidth: 720, minHeight: 460)
    .onChange(of: model.route) { old, new in
      // A route that lives in Settings, such as #/secrets from a script, opens it there instead.
      guard let tab = new.settingsTab else { return }
      model.route = old
      model.settingsTab = tab
      openSettings()
    }
    #if DEBUG
    .onAppear { QARunner.openSettings = openSettings }
    #endif
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    ToolbarItemGroup(placement: .navigation) {
      Button {
        withAnimation(Motion.settle) { sidebarShown.toggle() }
      } label: {
        Label("Toggle Sidebar", systemImage: "sidebar.left")
      }
      .buttonStyle(.icon(size: 28))
      .help(sidebarShown ? "Hide sidebar (⌃⌘S)" : "Show sidebar (⌃⌘S)")
      Button(action: model.goBack) {
        Label { Text("Back") } icon: { OmniIcon(name: "chevronLeft", size: 15) }
      }
      .buttonStyle(.icon(size: 28))
      .disabled(!model.shell.history.canGoBack)
      .help("Back (⌘[)")
      Button(action: model.goForward) {
        Label { Text("Forward") } icon: { OmniIcon(name: "chevronRight", size: 15) }
      }
      .buttonStyle(.icon(size: 28))
      .disabled(!model.shell.history.canGoForward)
      .help("Forward (⌘])")
    }
    .sharedBackgroundVisibility(.hidden)
    if let notice = model.connectionNotice {
      ToolbarItem(placement: .status) {
        ReconnectingLabel(text: notice)
      }
      .sharedBackgroundVisibility(.hidden)
    }
    OpenInNewWindowToolbar(model: model)
  }
}

let sidebarShownKey = "sidebar.shown"

extension EnvironmentValues {
  /// Where the main window's pane starts, in window space. nil outside the main window.
  @Entry var paneTop: CGFloat?
}

/// View > Show Sidebar, since the sidebar is ours rather than a split view's.
struct SidebarToggleCommand: View {
  @AppStorage(sidebarShownKey) private var shown = true

  var body: some View {
    Button(shown ? "Hide Sidebar" : "Show Sidebar") {
      withAnimation(Motion.settle) { shown.toggle() }
    }
    .keyboardShortcut("s", modifiers: [.control, .command])
  }
}

struct ReconnectingLabel: View {
  let text: String

  var body: some View {
    HStack(spacing: 6) {
      GlyphView(glyph: .running, size: 6)
      Text(text)
    }
    .font(.system(size: 12))
    .foregroundStyle(Tok.fg3)
    .padding(.horizontal, 8)
    .accessibilityElement(children: .combine)
  }
}

struct NewThreadButton: View {
  let model: AppModel

  var body: some View {
    Button {
      model.startNewThread()
    } label: {
      Label("New Thread", systemImage: "square.and.pencil")
    }
  }
}

struct DetailView: View {
  let model: AppModel

  var body: some View {
    #if DEBUG
    if ProcessInfo.processInfo.arguments.contains("-OmniQASlashDemo") {
      SlashMenuDemo()
    } else {
      screen
    }
    #else
    screen
    #endif
  }

  @ViewBuilder private var screen: some View {
    if let screen = model.serverScreen {
      ServerView(model: model, screen: screen)
    } else if case .thread(let id, _) = model.route {
      ThreadScreen(model: model, id: id)
    } else if case .home = model.route {
      HomeScreen(model: model)
    } else if case .channel(let id, .prs, let pr) = model.route {
      VStack(spacing: 0) {
        ChannelTabsBar(model: model, channelID: id)
        PullRequestsScreen(model: model, channelID: id, number: pr)
      }
    } else if case .channel(let id, let tab, let pr) = model.route {
      ChannelScreen(model: model, id: id, tab: tab, pr: pr)
    } else if case .newChannel = model.route {
      NewChannelScreen(model: model)
    } else if case .search(let query) = model.route {
      SearchScreen(model: model, query: query)
    } else if model.route == .automations {
      AutomationsView(model: model)
    } else if case .artifacts = model.route {
      ArtifactsScreen(model: model)
    } else {
      RoutePlaceholder(route: model.route, title: model.route.title { model.store.channel($0)?.name }) {
        model.route = .home
      }
    }
  }
}

/// Stands in for a screen that is not built yet, and says which route it is.
struct RoutePlaceholder: View {
  let route: Route
  let title: String
  let goHome: () -> Void

  var body: some View {
    Group {
      if case .notFound(let path) = route {
        EmptyNote(symbol: "home", title: "Nothing here", message: "Nothing lives at \(path).") {
          Button("Go Home", action: goHome)
            .buttonStyle(.pill(.secondary, height: 32))
        }
      } else {
        EmptyNote(symbol: route.symbol, title: title, message: "This screen is not built yet.") {
          Text(route.hash)
            .font(.system(size: 12, design: .monospaced))
            .foregroundStyle(Tok.fg4)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Tok.bg)
  }
}

extension Route {
  var symbol: String {
    switch self {
    case .home: "house"
    case .channel(SidebarSections.conductorID, _, _): "scope"
    case .channel: "number"
    case .thread: "text.bubble"
    case .search: "magnifyingglass"
    case .automations: "bolt"
    case .secrets: "key"
    case .artifacts: "square.stack.3d.up"
    case .newChannel: "plus"
    case .notFound: "questionmark.folder"
    }
  }
}
