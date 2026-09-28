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
          ProgressView("Loading pull request").controlSize(.small).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity).padding(.top, 60)
        case .failure(let error):
          ErrorNote(text: error.message) { Task { await load() } }.padding(.top, 12)
        case .success(let pr):
          content(pr)
        }
      }
      .frame(maxWidth: 960, alignment: .leading)
      .padding(.horizontal, 24)
      .padding(.vertical, 20)
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
      Label("All pull requests", systemImage: "chevron.left")
        .font(.system(size: 12.5))
    }
    .buttonStyle(.plain)
    .foregroundStyle(.secondary)
    .padding(.bottom, 12)
  }

  @ViewBuilder private func content(_ pr: PullRequestDetail) -> some View {
    header(pr)
    if let reviewError { ErrorNote(text: reviewError).padding(.top, 8) }
    if let mergedOutput {
      HStack(alignment: .firstTextBaseline, spacing: 10) {
        Image(systemName: "checkmark")
        Text(mergedOutput).textSelection(.enabled)
      }
      .font(.system(size: 13))
      .foregroundStyle(ThreadStyle.ok)
      .padding(.horizontal, 16).padding(.vertical, 12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(ThreadStyle.okBackground, in: RoundedRectangle(cornerRadius: 16))
      .padding(.top, 16)
    }

    Picker("Section", selection: $tab) {
      ForEach(DetailTab.allCases, id: \.self) { t in Text(label(t, pr)).tag(t) }
    }
    .pickerStyle(.segmented)
    .labelsHidden()
    .fixedSize()
    .padding(.top, 20)
    .padding(.bottom, 14)

    switch tab {
    case .conversation: ConversationTab(pr: pr)
    case .checks: ChecksTab(runs: pr.checkRuns)
    case .files: FilesTab(files: pr.files) { tab = .diff }
    case .diff: DiffView(diff: pr.diff)
    }
  }

  private func label(_ tab: DetailTab, _ pr: PullRequestDetail) -> String {
    switch tab {
    case .checks: "Checks \(pr.checkRuns.count)"
    case .files: "Files \(pr.files.count)"
    default: tab.rawValue
    }
  }

  private func header(_ pr: PullRequestDetail) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .top, spacing: 12) {
        (Text(pr.title).font(.system(size: 22, weight: .semibold))
          + Text("  #\(pr.number)").font(.system(size: 15)).foregroundStyle(.tertiary))
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
        HStack(spacing: 8) {
          if let url = URL(string: pr.url) {
            Link(destination: url) { Image(systemName: "arrow.up.right.square") }
              .help("Open on GitHub")
          }
          if pr.isOpen {
            Button("Merge…") { mergeSheet = true }
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
            Label("Ask builder to review", systemImage: "square.stack.3d.up")
          }
          .disabled(reviewBusy)
        }
      }
      HStack(spacing: 12) {
        if let state = pr.state {
          PRChip(text: state.lowercased(), tone: state == "OPEN" ? .ok : state == "MERGED" ? .info : .plain)
        }
        if pr.isDraft { PRChip(text: "Draft", tone: .outline) }
        ReviewChip(decision: pr.reviewDecision)
        Text(pr.author?.login ?? "unknown")
        BranchLabel(head: pr.headRefName, base: pr.baseRefName)
          .padding(.horizontal, 8).frame(height: 20)
          .background(ThreadStyle.surface2, in: Capsule())
        ChecksSummary(checks: pr.checks)
        Changes(add: pr.additions, del: pr.deletions)
      }
      .font(.system(size: 12.5))
      .foregroundStyle(.secondary)
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
      Text("Merge #\(pr.number)").font(.system(size: 17, weight: .semibold))
      (Text(pr.headRefName).font(.system(size: 12, design: .monospaced))
        + Text(" into ") + Text(pr.baseRefName).font(.system(size: 12, design: .monospaced))
        + Text(" on ") + Text(repo).font(.system(size: 12, design: .monospaced))
        + Text(deleteBranch ? ", then the branch is deleted." : "."))
        .font(.system(size: 13))
        .foregroundStyle(.secondary)
      if !warnings.isEmpty {
        HStack { ForEach(warnings, id: \.self) { PRChip(text: $0, tone: .warn) } }
      }
      Picker("Method", selection: $method) {
        ForEach(Self.methods, id: \.0) { m in Text(m.1).tag(m.0) }
      }
      Text(Self.methods.first { $0.0 == method }?.2 ?? "")
        .font(.system(size: 12)).foregroundStyle(.secondary)
      Toggle("Delete branch after merge", isOn: $deleteBranch)
      Text("Runs gh pr merge and cannot be undone from here.")
        .font(.system(size: 12)).foregroundStyle(.secondary)
      if let error { ErrorNote(text: error) }
      HStack {
        Spacer()
        Button("Cancel") { dismiss() }
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
          if busy { ProgressView().controlSize(.small) } else { Text("Merge") }
        }
        .buttonStyle(.borderedProminent)
        .disabled(busy)
      }
    }
    .padding(22)
    .frame(width: 440)
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
          Text("No description.").font(.system(size: 13)).foregroundStyle(.secondary)
        } else {
          MarkdownView(document: MarkdownDocument(parsing: body))
        }
      }
      ForEach(pr.conversation) { item in
        VStack(alignment: .leading, spacing: 8) {
          HStack(spacing: 8) {
            Text(String((item.who ?? "?").prefix(1)).uppercased())
              .font(.system(size: 10.5, weight: .semibold))
              .frame(width: 22, height: 22)
              .background(ThreadStyle.surface2, in: Circle())
            Text(item.who ?? "unknown").fontWeight(.medium)
            if let state = item.reviewState {
              PRChip(text: state.lowercased().replacingOccurrences(of: "_", with: " "), tone: state == "APPROVED" ? .ok : state == "CHANGES_REQUESTED" ? .bad : .plain)
            }
            Spacer()
            if let at = item.at { Text(Format.relTime(at)).font(.system(size: 11)).foregroundStyle(.tertiary) }
          }
          .font(.system(size: 12.5))
          .foregroundStyle(.secondary)
          if !item.body.isEmpty { MarkdownView(document: MarkdownDocument(parsing: item.body)) }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 18))
      }
    }
  }

  private func card<C: View>(@ViewBuilder _ content: () -> C) -> some View {
    content()
      .padding(.horizontal, 20).padding(.vertical, 16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 18))
  }
}

private struct ChecksTab: View {
  let runs: [CheckRun]

  var body: some View {
    if runs.isEmpty {
      Text("No checks on this PR.").font(.system(size: 13)).foregroundStyle(.secondary)
    } else {
      VStack(spacing: 0) {
        ForEach(Array(runs.enumerated()), id: \.offset) { _, run in
          HStack(spacing: 10) {
            Text(glyph(run.tone)).font(.system(size: 13, design: .monospaced)).foregroundStyle(color(run.tone)).frame(width: 14)
            Text(run.name).lineLimit(1)
            Spacer()
            Text(run.state.isEmpty ? "pending" : run.state.lowercased().replacingOccurrences(of: "_", with: " "))
              .font(.system(size: 11)).foregroundStyle(color(run.tone))
            if let url = run.url.flatMap(URL.init(string:)) {
              Link(destination: url) { Image(systemName: "arrow.up.right.square") }.help("Open check")
            }
          }
          .font(.system(size: 13))
          .padding(.horizontal, 12)
          .frame(height: 38)
        }
      }
      .padding(6)
      .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 18))
    }
  }

  private func color(_ tone: PRTone) -> Color {
    switch tone {
    case .ok: ThreadStyle.ok
    case .bad: ThreadStyle.bad
    case .pending: ThreadStyle.warn
    }
  }

  private func glyph(_ tone: PRTone) -> String {
    switch tone {
    case .ok: "✓"
    case .bad: "✗"
    case .pending: "•"
    }
  }
}

private struct FilesTab: View {
  let files: [PRFile]
  let showDiff: () -> Void

  var body: some View {
    if files.isEmpty {
      Text("No files.").font(.system(size: 13)).foregroundStyle(.secondary)
    } else {
      VStack(spacing: 0) {
        ForEach(files, id: \.path) { f in
          Button(action: showDiff) {
            HStack(spacing: 8) {
              Image(systemName: "doc").foregroundStyle(.tertiary)
              Text(f.path).font(.system(size: 12, design: .monospaced)).lineLimit(1).truncationMode(.middle)
              Spacer()
              Changes(add: f.additions, del: f.deletions)
            }
            .padding(.horizontal, 12)
            .frame(height: 34)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
      }
      .padding(6)
      .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 18))
    }
  }
}
