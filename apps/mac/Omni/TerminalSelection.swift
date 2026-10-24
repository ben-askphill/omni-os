import AppKit
import OmniKit
import SwiftTerm
import SwiftUI

/// SwiftTerm's view, told when its selection changes, so the dock follows what is selected. Copy, paste and keys are SwiftTerm's own.
final class ShellTerminalView: SwiftTerm.TerminalView {
  var onSelectionChange: (() -> Void)?

  override func selectionChanged(source: Terminal) {
    super.selectionChanged(source: source)
    onSelectionChange?()
  }
}

extension TerminalSession {
  static let selectionGone = "The selection is gone. Select the output again."

  /// Puts what is selected in the terminal now on the thread's reply box as a terminal_excerpt, with the shell's pid and
  /// the time. Nil when it went on; else why not, and nothing changes. The wording is `TerminalSelectionDock` in the Web UI's.
  func addSelection(note: String, cwd: String?, to draft: DraftContextModel) async -> String? {
    let at = Date()
    let picked = view.getSelection() ?? ""
    guard !TerminalExcerptContext.plainText(picked).isEmpty else { return Self.selectionGone }
    // The shell's pid says which shell this was after a restart. Not worth refusing for when the server can't say.
    let info = try? await client.terminal(thread)
    let source = TerminalExcerptContext.Source(thread: thread, pid: info?.pid, cwd: info?.cwd ?? cwd ?? "", at: at)
    switch TerminalExcerptContext.select(picked, from: source) {
    case .failure(let e):
      return e.message
    case .success(let body):
      if let refused = draft.add(.make(TerminalExcerptContext.self, body: body, note: note)) { return refused }
      view.selectNone()
      return nil
    }
  }
}

/// Over the terminal's foot while output is selected, as `TerminalSelectionDock` in TerminalSelection.tsx: what is
/// selected, a note, Clear and Add to Message (Return in the note; Esc clears), which puts it on the thread's reply box.
struct TerminalSelectionDock: View {
  let session: TerminalSession
  let cwd: String?
  let draft: DraftContextModel
  @State private var note = ""
  @State private var error: String?
  @FocusState private var focused: Bool

  private var lines: Int { session.selected.isEmpty ? 0 : session.selected.unicodeScalars.count { $0 == "\n" } + 1 }

  var body: some View {
    if lines > 0 || error != nil {
      VStack(alignment: .leading, spacing: z(8)) {
        HStack(spacing: z(8)) {
          OmniIcon(name: TerminalExcerptView.icon, size: 14).foregroundStyle(Tok.fg3)
          Text(lines > 0 ? TerminalExcerptContext.countLine(lines) : "Nothing selected")
            .font(.omni(size: 12, weight: .medium))
            .foregroundStyle(Tok.fg2)
          Spacer(minLength: 0)
          if error == nil { Text("Cmd-C still copies").font(.omni(size: 11.5)).foregroundStyle(Tok.fg4) }
        }
        TextField("Add a note (optional)", text: $note, axis: .vertical)
          .textFieldStyle(.omni)
          .lineLimit(1...3)
          .focused($focused)
          .onSubmit { add() }
          .onKeyPress(.escape) {
            session.view.selectNone()
            return .handled
          }
          .onChange(of: note) { error = nil }
        if let error { ErrorNote(text: error) }
        HStack(spacing: z(8)) {
          Spacer(minLength: 0)
          Button("Clear") {
            session.view.selectNone()
            error = nil
          }
          .buttonStyle(.pill(.ghost, height: 28))
          Button("Add to Message") { add() }
            .buttonStyle(.pill(.primary, height: 28))
            .disabled(lines == 0)
            .help("Puts the output and your note in the reply box")
        }
      }
      .padding(.horizontal, z(14))
      .padding(.vertical, z(12))
      .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: z(16), style: .continuous).strokeBorder(Tok.lineStrong))
      .shadow(color: .black.opacity(0.3), radius: z(12), y: z(4))
      .padding(z(8))
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Selected output")
      .onChange(of: session.selected) { error = nil }
      #if DEBUG
      .onAppear { TerminalSelectionProbe.add = { text in note = text; return await addNow() } }
      #endif
    }
  }

  private func add() {
    Task { _ = await addNow() }
  }

  /// Nil when the output went on the reply box; else why not.
  @discardableResult
  private func addNow() async -> String? {
    let why = await session.addSelection(note: note, cwd: cwd, to: draft)
    if why == nil { note = "" }
    error = why
    return why
  }
}

#if DEBUG
/// The QA harness's way to select the terminal's output and add it (`{"selectTerminal": true}`, `{"addTerminal": "note"}`),
/// through the same Add to Message as Ben.
@MainActor
enum TerminalSelectionProbe {
  /// Selects everything the terminal shows. False when no terminal is showing.
  static var select: (() -> Bool)?
  /// Writes the note and presses Add to Message. Nil when the output went on the reply box, else why not.
  static var add: ((String) async -> String?)?
}
#endif
