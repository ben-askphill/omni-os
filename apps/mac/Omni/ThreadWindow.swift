import OmniKit
import SwiftUI

/// The sentence to show after Send to Grok Bot. Success, or the server's error.
@MainActor
func grokBotResult(_ model: AppModel, _ threadID: String) async -> String {
  do throws(OmniAPIError) {
    try await model.client.sendThreadToGrokBot(threadID: threadID)
    return "Sent this thread to Grok Bot."
  } catch {
    return error.message
  }
}

/// A thread in its own window: a `WindowGroup` keyed by the thread id. Windows share stores through
/// `AppModel.threads`, so two windows on one thread (or one window and the main window) read one store and
/// one stream. SwiftUI keeps one window per id and restores the ones that were open on relaunch.
enum ThreadWindow {
  static let id = "thread"
}

/// The thread the focused window shows, for the menu commands. nil when the focused window shows none.
struct ShownThread: Hashable {
  let id: String
  /// True in a thread window, where Open in New Window has nothing to add.
  let inOwnWindow: Bool
}

extension FocusedValues {
  @Entry var shownThread: ShownThread?
}

struct ThreadWindowView: View {
  let model: AppModel
  let id: String?
  @Environment(\.openWindow) private var openWindow
  @Environment(\.controlActiveState) private var activeState

  var body: some View {
    Group {
      if let id {
        if let screen = model.serverScreen {
          ServerView(model: model, screen: screen)
        } else {
          ThreadScreen(model: model, id: id)
        }
      } else {
        Color.clear
      }
    }
    .navigationTitle(title)
    .toolbar {
      if let notice = model.connectionNotice {
        ToolbarItem(placement: .status) {
          ReconnectingLabel(text: notice)
        }
      }
    }
    .frame(minWidth: 480, minHeight: 360)
    .focusedSceneValue(\.shownThread, id.map { ShownThread(id: $0, inOwnWindow: true) })
    // Links and buttons in a thread window navigate the main window, so bring it forward.
    .onChange(of: model.route) {
      if activeState == .key { openWindow(id: "main") }
    }
    .onChange(of: model.shell.paletteOpen) { _, open in
      if open, activeState == .key { openWindow(id: "main") }
    }
  }

  private var title: String {
    guard let id, model.serverScreen == nil else { return "Omni" }
    return model.threads.store(id)?.thread?.title ?? "Thread"
  }
}

/// Main window side: says which thread it shows to the menu commands and hands QA a way to open windows.
struct ThreadWindowSupport: ViewModifier {
  let model: AppModel
  @Environment(\.openWindow) private var openWindow

  func body(content: Content) -> some View {
    content
      .focusedSceneValue(\.shownThread, shown)
      #if DEBUG
      .onAppear { QARunner.openThreadWindow = { openWindow(id: ThreadWindow.id, value: $0) } }
      #endif
  }

  private var shown: ShownThread? {
    guard model.serverScreen == nil, case .thread(let id, _) = model.route else { return nil }
    return ShownThread(id: id, inOwnWindow: false)
  }
}

/// File > Open in New Window, for the thread the focused window shows.
struct OpenInNewWindowCommand: View {
  @FocusedValue(\.shownThread) private var shown
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    Button("Open in New Window") {
      if let shown { openWindow(id: ThreadWindow.id, value: shown.id) }
    }
    .keyboardShortcut("n", modifiers: [.command, .option])
    .disabled(shown == nil || shown?.inOwnWindow == true)
  }
}

/// Edit > Copy Thread as Markdown, for the thread the focused window shows.
struct CopyThreadMarkdownCommand: View {
  let model: AppModel
  @FocusedValue(\.shownThread) private var shown

  var body: some View {
    Button("Copy Thread as Markdown") {
      guard let shown else { return }
      Task { if let text = await model.threadMarkdown(shown.id) { Pasteboard.copy(text) } }
    }
    .keyboardShortcut("c", modifiers: [.command, .shift])
    .disabled(!(shown.map { model.canCopyThreadMarkdown($0.id) } ?? false))
  }
}

extension View {
  /// Open in New Window and the thread's actions (packages/shared/thread-actions.ts) in the context menu, and Open in
  /// New Window on an Option-click.
  /// - Parameter stub: a sidebar row's thread, which gives the menu its state: pin, done, move, fork and reference.
  /// - Parameter archived: the thread is archived, so the menu offers Unarchive.
  func openInNewWindow(_ threadID: String, model: AppModel? = nil, title: String = "", stub: ThreadStub? = nil, archived: Bool = false) -> some View {
    modifier(OpenInNewWindow(threadID: threadID, model: model, title: title, stub: stub, archived: archived))
  }
}

private struct OpenInNewWindow: ViewModifier {
  let threadID: String
  /// With a model the menu also has the thread's actions.
  let model: AppModel?
  /// The thread's title, which the rename alert starts from.
  let title: String
  let stub: ThreadStub?
  let archived: Bool
  @Environment(\.openWindow) private var openWindow
  @State private var renaming = false
  @State private var draft = ""
  @State private var grokNote = ""
  @State private var showingGrokNote = false
  /// The thread Fork thread continues, once its detail has come.
  @State private var forking: OmniThread?
  @State private var referencing: ReferencePick?

  func body(content: Content) -> some View {
    content
      .contextMenu {
        Button("Open in New Window") { openWindow(id: ThreadWindow.id, value: threadID) }
        if let model {
          // The groups and items of packages/shared/thread-actions.ts, as the Web UI's menus list them.
          ForEach(SlashEngine.shared.threadMenu(facts(model))) { group in
            Section(group.title) {
              ForEach(group.items) { menuItem(model, $0) }
            }
          }
        }
      }
      .alert("Rename Thread", isPresented: $renaming) {
        TextField("Title", text: $draft)
        Button("Rename") {
          if let model { Task { await model.renameThread(threadID, to: draft) } }
        }
        Button("Cancel", role: .cancel) {}
      }
      .alert("Grok Bot", isPresented: $showingGrokNote) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(grokNote)
      }
      .sheet(item: $forking) { thread in
        if let model { ContinueSheet(model: model, thread: thread) }
      }
      .popover(item: $referencing, arrowEdge: .trailing) { pick in
        ThreadReferencePanel(picker: pick.picker) { referencing = nil }
      }
      .simultaneousGesture(
        TapGesture().modifiers(.option).onEnded { openWindow(id: ThreadWindow.id, value: threadID) }
      )
  }

  /// The row the menu acts on: the sidebar's, the pinned one, or the open thread's.
  private func row(_ model: AppModel) -> ThreadStub? {
    stub ?? model.store.pinned.first { $0.id == threadID } ?? model.threads.store(threadID)?.thread.map { ThreadStub($0) }
  }

  /// What the menu knows. Where the turn runs comes only from the thread's open store, so a row whose thread is not
  /// open leaves Hand Off and Take Over out.
  private func facts(_ model: AppModel) -> ThreadMenuFacts {
    var f = ThreadMenuFacts(
      stub: row(model), archived: archived, pinned: model.store.pinned.contains { $0.id == threadID }, grokBot: model.store.status?.grokBot == true)
    let store = model.threads.store(threadID)
    f.handOff = model.devices.targets(store) != nil
    if let store, store.canTakeOver { f.takeOverFrom = store.takeover?.from.name }
    return f
  }

  @ViewBuilder
  private func menuItem(_ model: AppModel, _ item: ThreadMenuItem) -> some View {
    switch item.id {
    case .pin:
      if let pin = row(model) {
        let on = model.store.pinned.contains { $0.id == threadID }
        Button(item.label) { Task { await model.setThreadPinned(pin, !on) } }
      }
    case .done:
      Button(item.label) { Task { await model.setThreadDone(threadID, row(model)?.doneAt == nil) } }
    case .rename:
      Button(item.label) {
        draft = title
        renaming = true
      }
    case .move:
      if let row = row(model) { MoveToFolderMenu(model: model, thread: row, title: item.label) }
    case .archive:
      Button(item.label) { Task { await model.setThreadArchived(threadID, !archived) } }
    case .fork:
      Button {
        Task { forking = try? await model.client.thread(threadID).thread }
      } label: {
        Text(item.label)
        if let off = item.off { Text(off) }
      }
      .disabled(item.off != nil)
    case .reference:
      if let row = row(model) {
        Button(item.label) {
          let draft = model.threads.store(threadID)?.draftContext ?? DraftContextModel(threadID: threadID)
          referencing = ReferencePick(
            picker: ThreadReferencePicker(threadID: threadID, channelID: row.channelID, api: model.client, draft: draft))
        }
      }
    case .handOff:
      HandOffMenu(model: model, threadID: threadID, title: item.label)
    case .takeOver:
      TakeOverItem(model: model, threadID: threadID, title: item.label)
    case .grok:
      Button {
        Task {
          grokNote = await grokBotResult(model, threadID)
          showingGrokNote = true
        }
      } label: {
        Label { Text(item.label) } icon: { OmniIcon(name: item.icon) }
      }
    }
  }
}

/// The thread reference picker the right-click opens, for a thread whose header may not be on screen.
private struct ReferencePick: Identifiable {
  let id = UUID()
  let picker: ThreadReferencePicker
}
