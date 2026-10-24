import OmniKit
import SwiftUI

/// The thread's changes, read-only, two ways, as ChangesTab.tsx. Since base: its checkout against the base commit
/// Omni recorded, split into committed, staged, unstaged and untracked. This turn: what one turn changed, between the
/// snapshots Omni saved before and after it. Loads when opened, again when a turn starts or ends, and on Refresh.
struct ChangesTab: View {
  enum Mode: Hashable { case base, turn }

  let client: OmniClient
  let store: ThreadStore
  @State private var mode = Mode.base

  var body: some View {
    VStack(alignment: .leading, spacing: z(10)) {
      SegmentedPill(selection: $mode, options: [(.base, "Since base"), (.turn, "This turn")], small: true)
        .fixedSize()
        .padding(.horizontal, z(14))
        .accessibilityLabel("Changes to show")
      switch mode {
      case .base: SinceBaseChanges(client: client, store: store)
      case .turn: ThisTurnChanges(client: client, store: store)
      }
    }
    .frame(maxHeight: .infinity, alignment: .top)
    #if DEBUG
    .onAppear {
      let picked = $mode
      ChangesProbe.setMode = { picked.wrappedValue = $0 }
      if let asked = ChangesProbe.asked { mode = asked }
    }
    .onDisappear { ChangesProbe.setMode = nil }
    #endif
  }
}

#if DEBUG
/// The QA harness's way to the This turn view (`{"inspector": "turn"}`), whether or not the tab shows yet.
@MainActor
enum ChangesProbe {
  static var setMode: ((ChangesTab.Mode) -> Void)?
  static var asked: ChangesTab.Mode?

  static func show(_ mode: ChangesTab.Mode) {
    asked = mode
    setMode?(mode)
  }
}
#endif

/// The groups of a changes answer, each file a DiffFileView whose lines can be picked where `picking` says.
private struct ChangeGroupsView: View {
  let groups: [ChangesView.Group]
  let fileCount: Int
  let picking: (ChangesView.Group, ChangesView.File) -> DiffFileView.Picking?

  var body: some View {
    ForEach(groups) { group in
      VStack(alignment: .leading, spacing: z(8)) {
        HStack(spacing: z(8)) {
          Text(group.kind.title)
          Text("\(group.files.count)").monospacedDigit().foregroundStyle(Tok.fg4)
        }
        .font(.omni(size: 11.5, weight: .medium))
        .foregroundStyle(Tok.fg3)
        .padding(.horizontal, z(6))
        .accessibilityAddTraits(.isHeader)
        LazyVStack(spacing: z(8)) {
          ForEach(group.files) { f in
            DiffFileView(
              file: f.diff, startsOpen: DiffParser.startsOpen(f.diff, fileCount: fileCount),
              label: f.file.label, badge: f.file.letter, notice: f.file.notice, picking: picking(group, f))
          }
        }
        if group.truncated {
          Text("More files changed than are listed here.")
            .font(.omni(size: 12)).foregroundStyle(Tok.fg3).padding(.horizontal, z(6))
        }
      }
    }
  }
}

private struct RefreshButton: View {
  let loading: Bool
  let help: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      if loading { Loader(size: 12) } else { OmniIcon(name: "refresh", size: 14) }
    }
    .buttonStyle(.icon(size: 28))
    .help(help)
    .disabled(loading)
  }
}

private struct SinceBaseChanges: View {
  let client: OmniClient
  let store: ThreadStore
  @State private var result: Result<BranchChanges, OmniAPIError>?
  @State private var loading = false

  var body: some View {
    Group {
      switch result {
      case nil:
        ScrollView { LoadingNote(label: "Loading changes").padding(.horizontal, z(10)) }
      case .failure(let error):
        ScrollView { ErrorNote(text: error.message) { Task { await load() } }.padding(.horizontal, z(10)) }
      case .success(let changes):
        if let view = ChangesView(changes) {
          content(view, head: changes.head)
        } else {
          EmptyNote(symbol: "diff", title: "No changes to show", message: changes.reason ?? "")
            .panelEmptyNote()
        }
      }
    }
    .frame(maxHeight: .infinity, alignment: .top)
    .task(id: store.id) { await load() }
    // A turn that starts or ends has likely changed files.
    .onChange(of: store.thread?.status) { old, new in
      if old != new { Task { await load() } }
    }
  }

  /// Lines are picked against the base Omni recorded and HEAD now.
  private func content(_ view: ChangesView, head: String?) -> some View {
    LinePicking(store: store, groups: view.groups) { group in
      DiffSelectionContext.Group(rawValue: group.kind.rawValue).flatMap { g in
        head.map { DiffSelectionContext.Source(group: g, from: view.base.sha, to: $0, turn: nil) }
      }
    } content: { picking in
      ScrollView {
        VStack(alignment: .leading, spacing: z(16)) {
          header(view)
          if view.fileCount == 0 {
            EmptyNote(symbol: "diff", title: "No changes", message: "Nothing changed since \(view.base.short): no commits, staged, unstaged or untracked files.")
              .frame(maxWidth: .infinity)
          }
          ChangeGroupsView(groups: view.groups, fileCount: view.fileCount, picking: picking)
        }
        .padding(.horizontal, z(10))
        .padding(.bottom, z(12))
      }
    }
  }

  private func header(_ view: ChangesView) -> some View {
    HStack(alignment: .top, spacing: z(8)) {
      VStack(alignment: .leading, spacing: z(2)) {
        (Text("Base ").foregroundStyle(Tok.fg2)
          + Text(view.base.short).font(.omni(size: 11.5, design: .monospaced)).foregroundStyle(Tok.fg)
          + Text(", \(view.base.label)"))
          .lineLimit(1)
          .truncationMode(.tail)
          .help(view.base.sha)
        if view.fileCount > 0 {
          (Text(Format.plural(view.fileCount, "file")) + Text("  +\(view.additions)").foregroundStyle(Tok.fg2) + Text("  -\(view.deletions)")
            + Text(view.branch.map { " on \($0)" } ?? "").font(.omni(size: 11, design: .monospaced)))
            .font(.omni(size: 11))
            .monospacedDigit()
            .lineLimit(1)
        }
      }
      .font(.omni(size: 12))
      .foregroundStyle(Tok.fg3)
      .frame(maxWidth: .infinity, alignment: .leading)
      RefreshButton(loading: loading, help: "Refresh changes") { Task { await load() } }
    }
    .padding(.horizontal, z(4))
  }

  private func load() async {
    loading = true
    defer { loading = false }
    do {
      result = .success(try await client.changes(forThread: store.id))
    } catch {
      // Keep the changes on screen when a refresh fails; say so only when there is nothing else to show.
      if case .success = result { return }
      result = .failure(error)
    }
  }
}

private struct ThisTurnChanges: View {
  let client: OmniClient
  let store: ThreadStore
  /// nil: the newest turn, which moves on as new turns end.
  @State private var picked: String?
  @State private var result: Result<TurnChanges, OmniAPIError>?
  @State private var loading = false

  /// How often to look again while a turn's after snapshot is being saved.
  private static let settlePoll = Duration.milliseconds(1500)

  var body: some View {
    Group {
      switch result {
      case nil:
        ScrollView { LoadingNote(label: "Loading this turn").padding(.horizontal, z(10)) }
      case .failure(let error):
        ScrollView { ErrorNote(text: error.message) { Task { await load() } }.padding(.horizontal, z(10)) }
      case .success(let changes):
        if let view = TurnChangesView(changes) {
          content(view, turns: changes.turns)
        } else {
          EmptyNote(
            symbol: "diff", title: changes.available ? "No turns saved yet" : "No turns to show",
            message: changes.reason ?? "Each turn's changes are saved here when it ends."
          )
          .panelEmptyNote()
        }
      }
    }
    .frame(maxHeight: .infinity, alignment: .top)
    .task(id: "\(store.id) \(picked ?? "")") { await load() }
    .onChange(of: store.thread?.status) { old, new in
      if old != new { Task { await load() } }
    }
    // The turn ended and its snapshot is still being saved: look again shortly.
    .task(id: capturingTurn) {
      guard capturingTurn != nil else { return }
      try? await Task.sleep(for: Self.settlePoll)
      if !Task.isCancelled { await load() }
    }
  }

  /// The shown turn while its after snapshot is saved, with the answer's identity so each poll schedules the next.
  private var capturingTurn: String? {
    guard case .success(let c) = result, let t = c.turn, t.state == .capturing else { return nil }
    return "\(t.id) \(c.hashValue)"
  }

  /// Lines are picked against the snapshots saved before and after the turn.
  private func content(_ view: TurnChangesView, turns: [TurnView]) -> some View {
    LinePicking(store: store, groups: view.groups) { _ in
      view.turn.before.flatMap { before in
        view.turn.after.map { DiffSelectionContext.Source(group: .turn, from: before.sha, to: $0.sha, turn: view.turn.id) }
      }
    } content: { picking in
      ScrollView {
        VStack(alignment: .leading, spacing: z(12)) {
          header(view, turns: turns)
          Text(TurnChangesView.note)
            .font(.omni(size: 11.5))
            .foregroundStyle(Tok.fg4)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, z(4))
          if let note = view.turn.stateNote {
            if view.turn.state == .failed {
              ErrorNote(text: note)
            } else {
              LoadingNote(label: note)
            }
          } else if view.fileCount == 0 {
            EmptyNote(symbol: "diff", title: "No changes", message: "Nothing in the worktree changed during this turn.")
              .frame(maxWidth: .infinity)
          } else {
            ChangeGroupsView(groups: view.groups, fileCount: view.fileCount, picking: picking)
          }
        }
        .padding(.horizontal, z(10))
        .padding(.bottom, z(12))
      }
    }
  }

  private func header(_ view: TurnChangesView, turns: [TurnView]) -> some View {
    HStack(alignment: .top, spacing: z(8)) {
      VStack(alignment: .leading, spacing: z(4)) {
        Menu {
          Picker("Turn", selection: Binding(get: { view.turn.id }, set: { picked = $0 == turns.first?.id ? nil : $0 })) {
            ForEach(turns) { t in Text(label(t)).tag(t.id) }
          }
          .pickerStyle(.inline)
          .labelsHidden()
        } label: {
          PickerPill(text: view.turn.title, secondary: view.turn.startedAt.map { Format.clock($0) }) { PillIcon(name: "diff") }
        }
        .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
        .help("Turn")
        .accessibilityLabel("Turn: \(view.turn.title)")
        if view.turn.state == .ready {
          (Text(view.fileCount == 0 ? "No files changed" : Format.plural(view.fileCount, "file"))
            + Text(view.fileCount == 0 ? "" : "  +\(view.additions)").foregroundStyle(Tok.fg2)
            + Text(view.fileCount == 0 ? "" : "  -\(view.deletions)")
            + Text(view.turn.headMove.map { "  · HEAD \($0)" } ?? "").font(.omni(size: 11, design: .monospaced)))
            .font(.omni(size: 11))
            .monospacedDigit()
            .foregroundStyle(Tok.fg3)
            .lineLimit(1)
            .help(view.turn.headMove == nil ? "" : "HEAD before and after the turn: \(view.turn.before?.head ?? "") → \(view.turn.after?.head ?? "")")
            .padding(.horizontal, z(4))
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      RefreshButton(loading: loading, help: "Refresh this turn") { Task { await load() } }
    }
  }

  private func label(_ t: TurnView) -> String {
    let at = t.startedAt.map { " · \(Format.clock($0))" } ?? ""
    return t.state == .ready ? "\(t.title)\(at)" : "\(t.title)\(at), \(t.state.rawValue)"
  }

  private func load() async {
    loading = true
    defer { loading = false }
    do {
      result = .success(try await client.turns(forThread: store.id, turn: picked))
    } catch {
      if case .success = result { return }
      result = .failure(error)
    }
  }
}
