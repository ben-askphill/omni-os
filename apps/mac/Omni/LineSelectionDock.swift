import OmniKit
import SwiftUI

/// Picking lines in one view of the Changes tab, as `useLineSelection` in LineSelection.tsx: one pick at a time, and
/// the dock under the diff while there is one. Add to Message puts the lines and the note on the thread's reply box
/// (`ThreadStore.draftContext`), next to whatever Ben typed.
struct LinePicking<Content: View>: View {
  let store: ThreadStore
  let groups: [ChangesView.Group]
  /// Where a group's lines come from. Nil when they can't be named, so they can't be picked.
  let source: (ChangesView.Group) -> DiffSelectionContext.Source?
  @ViewBuilder let content: (_ picking: @escaping (ChangesView.Group, ChangesView.File) -> DiffFileView.Picking?) -> Content

  /// The pick, with the file as it was drawn when Ben picked, and where it came from.
  private struct Picked {
    var pick: LinePick
    let file: ChangesView.File
    let source: DiffSelectionContext.Source

    var selection: Result<DiffSelectionContext.Body, DiffSelectionContext.SelectionError> {
      DiffSelectionContext.select(
        file: file.diff, path: file.file.path, oldPath: file.file.oldPath, from: pick.from, to: pick.to, source: source)
    }
  }

  @State private var picked: Picked?
  @State private var note = ""
  @State private var error: String?

  var body: some View {
    VStack(spacing: 0) {
      content(picking)
      if let picked {
        Hairline()
        LineSelectionDock(selection: picked.selection, note: $note, error: error, cancel: clear) { add(note: note) }
      }
    }
    // A reload that changed the picked file's lines leaves nothing for the pick to point at.
    .onChange(of: groups) { _, groups in
      guard let p = picked else { return }
      if groups.flatMap(\.files).first(where: { $0.id == p.file.id })?.diff != p.file.diff { clear() }
    }
    #if DEBUG
    .onChange(of: groups, initial: true) { _, groups in
      LineSelectionProbe.select = { path, from, to in
        guard let group = groups.first(where: { $0.files.contains { $0.file.path == path } }),
          let file = group.files.first(where: { $0.file.path == path }), let picking = picking(group, file)
        else { return false }
        picking.press(from, false)
        self.picking(group, file)?.press(to, true)
        return true
      }
      LineSelectionProbe.add = { text in
        guard picked != nil else { return "no lines are picked" }
        note = text
        return add(note: text)
      }
    }
    .onDisappear {
      LineSelectionProbe.select = nil
      LineSelectionProbe.add = nil
    }
    #endif
  }

  private func picking(_ group: ChangesView.Group, _ file: ChangesView.File) -> DiffFileView.Picking? {
    guard let source = source(group) else { return nil }
    let current = picked?.pick.file == file.id ? picked : nil
    return DiffFileView.Picking(range: current?.pick.range) { row, extend in
      let next = LinePick.press(picked?.pick, file: file.id, row: row, extend: extend, lines: file.diff.rows)
      picked = next.map { Picked(pick: $0, file: file, source: current?.source ?? source) }
      error = nil
    }
  }

  /// Nil when the lines went on the reply box; else why not.
  @discardableResult
  private func add(note: String) -> String? {
    guard let picked else { return "no lines are picked" }
    switch picked.selection {
    case .failure(let e):
      return e.message
    case .success(let lines):
      if let refused = store.draftContext.add(.make(DiffSelectionContext.self, body: lines, note: note)) {
        error = refused
        return refused
      }
      clear()
      return nil
    }
  }

  private func clear() {
    picked = nil
    note = ""
    error = nil
  }
}

/// Under the diff while lines are picked, as SelectionDock in LineSelection.tsx: what they are, a note, Cancel and
/// Add to Message (Return or Cmd-Return in the note; Esc there cancels).
struct LineSelectionDock: View {
  let selection: Result<DiffSelectionContext.Body, DiffSelectionContext.SelectionError>
  @Binding var note: String
  /// Why the last Add to Message did not go through.
  let error: String?
  let cancel: () -> Void
  let add: () -> Void
  @FocusState private var focused: Bool

  var body: some View {
    let picked = try? selection.get()
    VStack(alignment: .leading, spacing: z(8)) {
      HStack(spacing: z(8)) {
        OmniIcon(name: DiffSelectionView.icon, size: 14).foregroundStyle(Tok.fg3)
        Text(picked.map(DiffSelectionContext.label) ?? "No lines")
          .font(.omni(size: 12, weight: .medium, design: .monospaced))
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
          .truncationMode(.head)
        if let picked {
          Text(DiffSelectionContext.range(picked)).font(.omni(size: 11.5)).foregroundStyle(Tok.fg3).lineLimit(1)
        }
        Spacer(minLength: 0)
      }
      TextField("Add a note (optional)", text: $note, axis: .vertical)
        .textFieldStyle(.omni)
        .lineLimit(1...5)
        .focused($focused)
        .onSubmit(add)
        .onKeyPress(.return, phases: .down) { press in
          guard press.modifiers.contains(.command) else { return .ignored }
          add()
          return .handled
        }
        .onExitCommand(perform: cancel)
      if let message = error ?? selection.failureMessage { ErrorNote(text: message) }
      HStack(spacing: z(8)) {
        Spacer(minLength: 0)
        Button("Cancel", action: cancel).buttonStyle(.pill(.ghost, height: 28))
        Button("Add to Message", action: add)
          .buttonStyle(.pill(.primary, height: 28))
          .disabled(picked == nil)
          .help("Puts the lines and your note in the reply box (Cmd-Return)")
      }
    }
    .padding(.horizontal, z(14))
    .padding(.vertical, z(12))
    .background(Tok.bg)
    .onAppear { focused = true }
  }
}

#if DEBUG
/// The QA harness's way to pick lines and add them (`{"selectLines": …}`, `{"addContext": "note"}`), through the
/// same clicks and Add to Message as Ben.
@MainActor
enum LineSelectionProbe {
  /// Clicks row `from` of the file at this path, then Shift-clicks row `to`. false when no such file can be picked.
  static var select: ((_ path: String, _ from: Int, _ to: Int) -> Bool)?
  /// Writes the note and presses Add to Message. Nil when the lines went on the reply box, else why not.
  static var add: ((String) -> String?)?
}
#endif
