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
  /// Open in New Window in the context menu, and on an Option-click.
  /// - Parameter stub: a sidebar row's thread, which also gets "Move to Folder".
  /// - Parameter archived: the thread is archived, so the menu offers Unarchive.
  func openInNewWindow(_ threadID: String, model: AppModel? = nil, title: String = "", stub: ThreadStub? = nil, archived: Bool = false) -> some View {
    modifier(OpenInNewWindow(threadID: threadID, model: model, title: title, stub: stub, archived: archived))
  }
}

private struct OpenInNewWindow: ViewModifier {
  let threadID: String
  /// With a model the menu also archives the thread.
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

  func body(content: Content) -> some View {
    content
      .contextMenu {
        Button("Open in New Window") { openWindow(id: ThreadWindow.id, value: threadID) }
        if let model {
          Divider()
          Button("Rename Thread...") {
            draft = title
            renaming = true
          }
          // Archived threads are out of the lists, so out of Pinned too. Pinning needs the row; unpinning only the id.
          if !archived, let pin = model.store.pinned.first(where: { $0.id == threadID }) ?? stub {
            let on = model.store.pinned.contains { $0.id == threadID }
            Button(on ? "Unpin Thread" : "Pin Thread") { Task { await model.setThreadPinned(pin, !on) } }
          }
          // A running thread brings its own result; done waits until it ends.
          if !archived, let stub, stub.canMarkDone {
            let done = stub.doneAt != nil
            Button(done ? "Mark as Not Done" : "Mark as Done") { Task { await model.setThreadDone(threadID, !done) } }
          }
          if let stub { MoveToFolderMenu(model: model, thread: stub) }
          HandOffMenu(model: model, threadID: threadID)
          TakeOverItem(model: model, threadID: threadID)
          Button {
            Task {
              grokNote = await grokBotResult(model, threadID)
              showingGrokNote = true
            }
          } label: {
            Label { Text("Send to Grok Bot") } icon: { OmniIcon(name: "grok") }
          }
          Button(archived ? "Unarchive Thread" : "Archive Thread") { Task { await model.setThreadArchived(threadID, !archived) } }
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
      .simultaneousGesture(
        TapGesture().modifiers(.option).onEnded { openWindow(id: ThreadWindow.id, value: threadID) }
      )
  }
}
