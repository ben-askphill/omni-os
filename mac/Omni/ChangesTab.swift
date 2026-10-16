import OmniKit
import SwiftUI

/// The thread's branch changes before any PR, read-only, as ChangesTab.tsx: its checkout against the base commit
/// Omni recorded, split into committed, staged, unstaged and untracked. Loads when opened, again when a turn ends,
/// and on Refresh.
struct ChangesTab: View {
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
          content(view)
        } else {
          EmptyNote(symbol: "diff", title: "No changes to show", message: changes.reason ?? "")
            .panelEmptyNote()
        }
      }
    }
    .frame(maxHeight: .infinity, alignment: .top)
    .task(id: store.id) { await load() }
    // A turn that ends has likely changed files.
    .onChange(of: store.thread?.status) { old, new in
      if old != new, let new, new != .running, new != .queued { Task { await load() } }
    }
  }

  private func content(_ view: ChangesView) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: z(16)) {
        header(view)
        if view.fileCount == 0 {
          EmptyNote(symbol: "diff", title: "No changes", message: "Nothing changed since \(view.base.short): no commits, staged, unstaged or untracked files.")
            .frame(maxWidth: .infinity)
        }
        ForEach(view.groups) { group in
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
                  file: f.diff, startsOpen: DiffParser.startsOpen(f.diff, fileCount: view.fileCount),
                  label: f.file.label, badge: f.file.letter, notice: f.file.notice)
              }
            }
            if group.truncated {
              Text("More files changed than are listed here.")
                .font(.omni(size: 12)).foregroundStyle(Tok.fg3).padding(.horizontal, z(6))
            }
          }
        }
      }
      .padding(.horizontal, z(10))
      .padding(.bottom, z(12))
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
      Button {
        Task { await load() }
      } label: {
        if loading { Loader(size: 12) } else { OmniIcon(name: "refresh", size: 14) }
      }
      .buttonStyle(.icon(size: 28))
      .help("Refresh changes")
      .disabled(loading)
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
