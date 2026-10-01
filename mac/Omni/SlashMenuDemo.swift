#if DEBUG
import OmniKit
import SwiftUI

/// A text editor wired to the `/` menu with a canned command list and no server, for the QA harness
/// (launch with `-OmniQASlashDemo YES`, and `-OmniQASlashText <text>` to start with other text) and as the reference wiring for a composer.
struct SlashMenuDemo: View {
  private static let list = CommandList(
    status: .ready,
    commands: [
      SlashCommand(name: "tdd", description: "Test-driven development with a red-green-refactor loop", source: "personal", mentionable: true),
      SlashCommand(name: "deploy-preview", description: "Push this branch to a preview theme", source: "project", mentionable: true),
      SlashCommand(name: "document-skills:pdf", aliases: ["pdf"], description: "Read, create and edit PDF files", source: "plugin", plugin: "document-skills", mentionable: true),
      SlashCommand(name: "compact", description: "Clear conversation history but keep a summary in context", argumentHint: "[instructions]", source: "builtin", mentionable: false),
    ],
    fetchedAt: 1, recent: ["tdd"])

  @State private var text: AttributedString = {
    let args = ProcessInfo.processInfo.arguments
    if let i = args.firstIndex(of: "-OmniQASlashText"), i + 1 < args.count { return AttributedString(args[i + 1]) }
    return AttributedString("/")
  }()
  @State private var selection = AttributedTextSelection()
  @State private var menu: SlashMenuModel = {
    let store = SlashCommandsStore(api: DemoAPI(), source: .thread("demo"))
    store.set(list)
    return SlashMenuModel(commands: store, placement: .reply, harness: "claude-code")
  }()
  @FocusState private var focused: Bool

  var body: some View {
    VStack {
      Spacer()
      VStack(alignment: .leading, spacing: 4) {
        TextEditor(text: $text, selection: $selection)
          .focused($focused)
          .frame(height: 60)
          .scrollContentBackground(.hidden)
        SlashHintView(model: menu) {}
      }
      .padding(10)
      .background(Tok.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .slashMenu(menu)
      .padding(20)
      .frame(maxWidth: ThreadStyle.column)
    }
    .frame(maxWidth: .infinity)
    .onAppear {
      menu.onEdit = { new, caret in
        text = AttributedString(new)
        let at = text.index(utf16Offset: caret)
        selection = AttributedTextSelection(range: at..<at)
      }
      focused = true
      menu.setFocused(true)
      sync()
    }
    .onChange(of: text) { sync() }
    .onChange(of: selection) { sync() }
  }

  private func sync() {
    var caret = String(text.characters).utf16.count
    if case .insertionPoint(let at) = selection.indices(in: text) { caret = text.utf16Offset(of: at) }
    menu.update(text: String(text.characters), caret: caret)
  }
}

private struct DemoAPI: CommandsAPI {
  func commands(_ source: CommandsSource, wait: Bool) async throws(OmniAPIError) -> CommandList {
    throw .unreachable("demo")
  }
}
#endif
