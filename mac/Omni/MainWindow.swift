import OmniKit
import SwiftUI

/// The sidebar and the screen for the route, or the server screen while there is no server to talk to.
struct MainWindow: View {
  let model: AppModel
  let updater: Updater
  #if DEBUG
  @Environment(\.openSettings) private var openSettings
  #endif

  var body: some View {
    NavigationSplitView {
      SidebarView(model: model)
        .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 340)
    } detail: {
      VStack(spacing: 0) {
        UpdateBar(updater: updater)
        DetailView(model: model)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
      .overlay(alignment: .bottomTrailing) { BannerStack(model: model) }
    }
    .navigationTitle(model.title)
    .toolbar { toolbar }
    .frame(minWidth: 720, minHeight: 460)
    #if DEBUG
    .onAppear { QARunner.openSettings = openSettings }
    #endif
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    if let notice = model.connectionNotice {
      ToolbarItem(placement: .status) {
        ReconnectingLabel(text: notice)
      }
    }
    ToolbarItem(placement: .primaryAction) {
      Menu {
        ServerMenuItems(model: model, shortcuts: false)
      } label: {
        Label("Server", systemImage: "server.rack")
      }
      .help("Server")
    }
    ToolbarItem(placement: .primaryAction) {
      NewThreadButton(model: model)
        .help("New thread")
    }
  }
}

struct ReconnectingLabel: View {
  let text: String

  var body: some View {
    HStack(spacing: 6) {
      ProgressView().controlSize(.small)
      Text(text)
    }
    .foregroundStyle(.secondary)
    .padding(.horizontal, 8)
    .accessibilityElement(children: .combine)
  }
}

struct NewThreadButton: View {
  let model: AppModel

  var body: some View {
    Button {
      model.route = model.route.newThreadRoute
    } label: {
      Label("New Thread", systemImage: "square.and.pencil")
    }
  }
}

struct DetailView: View {
  let model: AppModel

  var body: some View {
    if let screen = model.serverScreen {
      ServerView(model: model, screen: screen)
    } else if case .thread(let id, _) = model.route {
      ThreadScreen(model: model, id: id)
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
    if case .notFound(let path) = route {
      ContentUnavailableView {
        Label("Nothing here", systemImage: "questionmark.folder")
      } description: {
        Text("Nothing lives at \(path).")
      } actions: {
        Button("Go Home", action: goHome)
      }
    } else {
      ContentUnavailableView {
        Label(title, systemImage: route.symbol)
      } description: {
        Text("This screen is not built yet.\n\(Text(route.hash).monospaced())")
      }
    }
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
