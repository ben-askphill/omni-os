import OmniKit
import SwiftUI

private enum DetailTab: String, CaseIterable {
  case conversation = "Conversation"
  case checks = "Checks"
  case files = "Files"
  case diff = "Diff"
}

/// One PR: header, merge and review actions, and the Conversation, Checks, Files and Diff tabs.
struct PullRequestDetailView: View {
  let model: AppModel
  let channelID: String
  let repo: String
  let number: Int
  @State private var result: Result<PullRequestDetail, OmniAPIError>?
  @State private var tab = Self.firstTab
  @State private var mergeSheet = Self.firstMergeSheet
  @State private var mergedOutput: String?
  @State private var reviewBusy = false
  @State private var reviewError: String?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        backButton
        switch result {
        case nil:
          LoadingNote(label: "Loading pull request")
        case .failure(let error):
          ErrorNote(text: error.message) { Task { await load() } }.padding(.top, 12)
        case .success(let pr):
          content(pr)
        }
      }
      .frame(maxWidth: z(1024), alignment: .leading)
      .padding(.horizontal, 32)
      .padding(.top, 24)
      .padding(.bottom, 64)
      .frame(maxWidth: .infinity)
    }
    .task { await load() }
  }

  #if DEBUG
  // QA scripts pick a route only, so launch arguments open the tab and the merge sheet.
  private static var firstTab: DetailTab { DetailTab(rawValue: UserDefaults.standard.string(forKey: "OmniPRTab") ?? "") ?? .conversation }
  private static var firstMergeSheet: Bool { UserDefaults.standard.bool(forKey: "OmniPRMergeSheet") }
  #else
  private static let firstTab = DetailTab.conversation
  private static let firstMergeSheet = false
  #endif

  private var backButton: some View {
    Button {
      model.route = .channel(id: channelID, tab: .prs)
    } label: {
      HStack(spacing: 4) {
        OmniIcon(name: "chevronLeft", size: 13)
        Text("All pull requests")
      }
      .font(.omni(size: 12.5))
      .foregroundStyle(Tok.fg3)
      .padding(.horizontal, 10)
      .frame(height: z(28))
      .hoverWash(14, fill: Tok.wash)
    }
    .buttonStyle(.plain)
    .padding(.leading, -10)
    .padding(.bottom, 12)
  }

  @ViewBuilder private func content(_ pr: PullRequestDetail) -> some View {
    header(pr)
    if let reviewError { ErrorNote(text: reviewError).padding(.top, 8) }
    if let mergedOutput {
      HStack(alignment: .firstTextBaseline, spacing: 10) {
        GlyphView(glyph: .done, size: 9)
        Text(mergedOutput).textSelection(.enabled)
      }
      .font(.omni(size: 13))
      .foregroundStyle(Tok.fg)
      .padding(.horizontal, 16).padding(.vertical, 12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Tok.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
      .padding(.top, 20)
    }

    SegmentedPill(selection: $tab, counted: DetailTab.allCases.map { ($0, $0.rawValue, count($0, pr)) }, small: true)
      .fixedSize()
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Section")
      .padding(.top, 24)
      .padding(.bottom, 16)

    switch tab {
    case .conversation: ConversationTab(pr: pr)
    case .checks: ChecksTab(runs: pr.checkRuns)
    case .files: FilesTab(files: pr.files) { tab = .diff }
    case .diff: DiffView(diff: pr.diff)
    }
  }

  private func count(_ tab: DetailTab, _ pr: PullRequestDetail) -> Int? {
    switch tab {
    case .checks: pr.checkRuns.count
    case .files: pr.files.count
    default: nil
    }
  }

  private func header(_ pr: PullRequestDetail) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .top, spacing: 12) {
        (Text(pr.title).font(.omni(size: 22, weight: .medium)).foregroundStyle(Tok.fg)
          + Text("  #\(pr.number)").font(.omni(size: 15)).foregroundStyle(Tok.fg4))
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
        HStack(spacing: 8) {
          if let url = URL(string: pr.url) {
            Link(destination: url) {
              Label { Text("Open on GitHub") } icon: { OmniIcon(name: "external", size: 15) }
            }
            .buttonStyle(.icon(size: 32))
            .help("Open on GitHub")
          }
          if pr.isOpen {
            Button("Merge…") { mergeSheet = true }
              .buttonStyle(.pill(.primary, height: 34))
              .disabled(pr.mergeable == "CONFLICTING")
              .help(pr.mergeable == "CONFLICTING" ? "Resolve conflicts first" : "Merge this pull request")
              .sheet(isPresented: $mergeSheet) {
                MergeSheet(pr: pr, repo: repo) { method, deleteBranch in
                  await merge(method: method, deleteBranch: deleteBranch)
                }
              }
          }
          Button {
            Task { await askForReview(pr) }
          } label: {
            HStack(spacing: 8) {
              if reviewBusy { Loader(size: 14) } else { OmniIcon(name: "layers", size: 15) }
              Text("Ask builder to review")
            }
          }
          .buttonStyle(.pill(.secondary, height: 34))
          .disabled(reviewBusy)
        }
      }
      HStack(spacing: 12) {
        if let state = pr.state {
          PRChip(text: state.lowercased(), tone: state == "OPEN" ? .info : state == "MERGED" ? .ok : .outline)
        }
        if pr.isDraft { PRChip(text: "Draft", tone: .outline) }
        ReviewChip(decision: pr.reviewDecision)
        Text(pr.author?.login ?? "unknown")
        BranchLabel(head: pr.headRefName, base: pr.baseRefName)
          .font(.omni(size: 11, design: .monospaced))
          .padding(.horizontal, 8).frame(height: z(20))
          .background(Tok.surface2, in: Capsule())
        ChecksSummary(checks: pr.checks)
        Changes(add: pr.additions, del: pr.deletions)
      }
      .font(.omni(size: 12.5))
      .foregroundStyle(Tok.fg3)
    }
  }

  private func load() async {
    let r = await attempt { () async throws(OmniAPIError) in try await model.client.pullRequest(number, in: channelID) }
    if case .failure(.cancelled) = r { return }
    result = r
  }

  /// Returns the error text to show in the sheet, nil when the merge went through.
  private func merge(method: MergeMethod, deleteBranch: Bool) async -> String? {
    let r = await attempt { () async throws(OmniAPIError) in try await model.client.merge(pullRequest: number, in: channelID, method: method, deleteBranch: deleteBranch) }
    switch r {
    case .success(let output):
      let text = output.trimmingCharacters(in: .whitespacesAndNewlines)
      mergedOutput = text.isEmpty ? "Merged." : text
      await load()
      return nil
    case .failure(let error):
      return error.message
    }
  }

  private func askForReview(_ pr: PullRequestDetail) async {
    reviewBusy = true
    reviewError = nil
    defer { reviewBusy = false }
    let r = await attempt { () async throws(OmniAPIError) in try await model.client.createThread(PullRequestDetail.reviewThread(number: pr.number, repo: repo, channel: channelID)) }
    switch r {
    case .success(let thread): model.route = .thread(id: thread.id)
    case .failure(let error): reviewError = error.message
    }
  }
}

// MARK: Merge

/// The merge confirmation. Return does not confirm: neither button is the default one.
private struct MergeSheet: View {
  let pr: PullRequestDetail
  let repo: String
  let merge: (MergeMethod, Bool) async -> String?
  @Environment(\.dismiss) private var dismiss
  @State private var method = MergeMethod.squash
  @State private var deleteBranch = true
  @State private var busy = false
  @State private var error: String?

  private static let methods: [(MergeMethod, String, String)] = [
    (.squash, "Squash and merge", "One commit on the base branch"),
    (.merge, "Merge commit", "Keep every commit plus a merge commit"),
    (.rebase, "Rebase and merge", "Replay the commits, no merge commit"),
  ]

  private var warnings: [String] {
    let failing = pr.checkRuns.filter { $0.tone == .bad }.count
    return [
      failing > 0 ? "\(Format.plural(failing, "check")) failing" : nil,
      pr.isDraft ? "Still a draft" : nil,
      pr.reviewDecision == "CHANGES_REQUESTED" ? "Changes requested" : nil,
    ].compactMap { $0 }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("Merge #\(pr.number)").font(.omni(size: 17, weight: .medium)).foregroundStyle(Tok.fg)
      (Text(pr.headRefName).font(.omni(size: 12, design: .monospaced))
        + Text(" into ") + Text(pr.baseRefName).font(.omni(size: 12, design: .monospaced))
        + Text(" on ") + Text(repo).font(.omni(size: 12, design: .monospaced))
        + Text(deleteBranch ? ", then the branch is deleted." : "."))
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg3)
      if !warnings.isEmpty {
        HStack(spacing: 6) { ForEach(warnings, id: \.self) { PRChip(text: $0, tone: .bad) } }
      }
      VStack(alignment: .leading, spacing: 0) {
        FieldLabel(text: "Method", hint: Self.methods.first { $0.0 == method }?.2)
        SegmentedPill(selection: $method, options: Self.methods.map { ($0.0, $0.1) }, small: true)
          .fixedSize()
          .accessibilityElement(children: .contain)
          .accessibilityLabel("Method")
      }
      HStack(spacing: 10) {
        Toggle("Delete branch after merge", isOn: $deleteBranch)
          .toggleStyle(.omni)
          .accessibilityLabel("Delete branch after merge")
        Text("Delete branch after merge").font(.omni(size: 13)).foregroundStyle(Tok.fg2)
          .accessibilityHidden(true)
      }
      Text("Runs gh pr merge and cannot be undone from here.")
        .font(.omni(size: 12)).foregroundStyle(Tok.fg3)
      if let error { ErrorNote(text: error) }
      HStack {
        Spacer()
        Button("Cancel") { dismiss() }
          .buttonStyle(.pill(.ghost, height: 34))
          .keyboardShortcut(.cancelAction)
          .disabled(busy)
        Button {
          busy = true
          error = nil
          Task {
            let failure = await merge(method, deleteBranch)
            busy = false
            if let failure { error = failure } else { dismiss() }
          }
        } label: {
          HStack(spacing: 8) {
            if busy { Loader(size: 14) }
            Text("Merge")
          }
        }
        .buttonStyle(.pill(.primary, height: 34))
        .disabled(busy)
      }
    }
    .padding(24)
    .frame(width: z(460))
    .background(Tok.bg)
  }
}

// MARK: Tabs

private struct ConversationTab: View {
  let pr: PullRequestDetail

  var body: some View {
    let body = PullRequestDetail.cleanBody(pr.body)
    VStack(alignment: .leading, spacing: 14) {
      card {
        if body.isEmpty {
          Text("No description.").font(.omni(size: 13)).foregroundStyle(Tok.fg3)
        } else {
          MarkdownView(document: MarkdownDocument(parsing: body))
        }
      }
      ForEach(pr.conversation) { item in
        VStack(alignment: .leading, spacing: 8) {
          HStack(spacing: 8) {
            Text(String((item.who ?? "?").prefix(1)).uppercased())
              .font(.omni(size: 10.5, weight: .medium))
              .foregroundStyle(Tok.fg2)
              .frame(width: z(22), height: z(22))
              .background(Tok.surface2, in: Circle())
            Text(item.who ?? "unknown").fontWeight(.medium).foregroundStyle(Tok.fg2)
            if let state = item.reviewState {
              PRChip(text: state.lowercased().replacingOccurrences(of: "_", with: " "), tone: state == "APPROVED" ? .ok : state == "CHANGES_REQUESTED" ? .bad : .plain)
            }
            Spacer()
            if let at = item.at { Text(Format.relTime(at)).font(.omni(size: 11)).monospacedDigit().foregroundStyle(Tok.fg4) }
          }
          .font(.omni(size: 12.5))
          .foregroundStyle(Tok.fg3)
          if !item.body.isEmpty { MarkdownView(document: MarkdownDocument(parsing: item.body)) }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .omniCard()
      }
    }
  }

  private func card<C: View>(@ViewBuilder _ content: () -> C) -> some View {
    content()
      .padding(.horizontal, 20).padding(.vertical, 16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .omniCard()
  }
}

private struct ChecksTab: View {
  let runs: [CheckRun]

  var body: some View {
    if runs.isEmpty {
      Text("No checks on this PR.").font(.omni(size: 13)).foregroundStyle(Tok.fg3)
    } else {
      VStack(spacing: 0) {
        ForEach(Array(runs.enumerated()), id: \.offset) { _, run in
          HStack(spacing: 10) {
            GlyphView(glyph: glyph(run.tone), size: 7).frame(width: z(12))
            Text(run.name).foregroundStyle(Tok.fg).lineLimit(1)
            Spacer()
            Text(run.state.isEmpty ? "pending" : run.state.lowercased().replacingOccurrences(of: "_", with: " "))
              .font(.omni(size: 11)).foregroundStyle(color(run.tone))
            if let url = run.url.flatMap(URL.init(string:)) {
              Link(destination: url) {
                Label { Text("Open check") } icon: { OmniIcon(name: "external", size: 13) }
              }
              .buttonStyle(.icon(size: 26))
              .help("Open check")
            }
          }
          .font(.omni(size: 13))
          .padding(.horizontal, 12)
          .frame(height: z(40))
        }
      }
      .padding(6)
      .omniCard()
    }
  }

  private func color(_ tone: PRTone) -> Color {
    switch tone {
    case .ok, .bad: Tok.fg3
    case .pending: Tok.live
    }
  }

  private func glyph(_ tone: PRTone) -> Glyph {
    switch tone {
    case .ok: .done
    case .bad: .needs
    case .pending: .running
    }
  }
}

private struct FilesTab: View {
  let files: [PRFile]
  let showDiff: () -> Void

  var body: some View {
    if files.isEmpty {
      Text("No files.").font(.omni(size: 13)).foregroundStyle(Tok.fg3)
    } else {
      VStack(spacing: 0) {
        ForEach(files, id: \.path) { f in
          Button(action: showDiff) {
            HStack(spacing: 8) {
              OmniIcon(name: "file", size: 13).foregroundStyle(Tok.fg4)
              Text(f.path).font(.omni(size: 12, design: .monospaced)).foregroundStyle(Tok.fg).lineLimit(1).truncationMode(.middle)
              Spacer()
              Changes(add: f.additions, del: f.deletions)
            }
            .font(.omni(size: 12.5))
            .padding(.horizontal, 12)
            .frame(height: z(36))
            .hoverWash(16, fill: Tok.surface2)
          }
          .buttonStyle(.plain)
        }
      }
      .padding(6)
      .omniCard()
    }
  }
}
