import OmniKit
import SwiftUI

/// `#/prs`: every channel's PRs, open first, newest first. A row opens the PR on GitHub. After AllPRs.tsx.
struct AllPullRequestsScreen: View {
  let model: AppModel
  @State private var result: Result<AllPullRequests, OmniAPIError>?
  @State private var reloading = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        OmniPageHeader(title: "Pull requests", subtitle: "Every channel’s repo, open first, newest first.") {
          Button {
            Task { await load() }
          } label: {
            HStack(spacing: z(6)) {
              if reloading && result != nil { Loader(size: 12) } else { OmniIcon(name: "refresh", size: 14) }
              Text("Refresh")
            }
          }
          .buttonStyle(.pill(.ghost, height: 28))
          .disabled(reloading)
        }
        .padding(.top, z(40))
        .padding(.bottom, z(24))
        content
      }
      .frame(maxWidth: z(896))
      .padding(.horizontal, z(32))
      .padding(.bottom, z(64))
      .frame(maxWidth: .infinity)
    }
    .task(id: model.client.baseURL) {
      result = nil
      await load()
    }
  }

  @ViewBuilder private var content: some View {
    switch result {
    case nil:
      LoadingNote(label: "Asking GitHub")
    case .failure(let error):
      ErrorNote(text: error.message) { Task { await load() } }
    case .success(let all):
      switch all.empty {
      case .noRepos?:
        EmptyNote(symbol: "pr", title: "No pull requests", message: "No channel has a GitHub repo. Set a repo path in a channel’s settings and its PRs show here.")
      case .allFailed?:
        ErrorNote(text: all.failedText) { Task { await load() } }
      case .nothingYet?:
        EmptyNote(symbol: "pr", title: "No pull requests", message: "No pull requests yet.")
      case nil:
        VStack(alignment: .leading, spacing: z(12)) {
          if !all.failed.isEmpty { ErrorNote(text: all.failedText) }
          VStack(spacing: 0) {
            ForEach(all.prs) { pr in
              if let url = URL(string: pr.url) {
                Link(destination: url) { AllPullRequestRow(pr: pr) }
                  .buttonStyle(.plain)
              }
            }
          }
        }
      }
    }
  }

  private func load() async {
    reloading = true
    defer { reloading = false }
    let r = await attempt { () async throws(OmniAPIError) in try await model.client.allPullRequests() }
    if case .failure(.cancelled) = r { return }
    result = r
  }
}

private struct AllPullRequestRow: View {
  let pr: AllPullRequests.Listed

  var body: some View {
    VStack(alignment: .leading, spacing: z(3)) {
      HStack(spacing: z(8)) {
        PRStateIcon(state: pr.state, isDraft: pr.isDraft)
        Text(pr.title).font(.omni(size: 14, weight: .medium)).foregroundStyle(Tok.fg).lineLimit(1)
        Text("#\(pr.number)").font(.omni(size: 11.5)).monospacedDigit().foregroundStyle(Tok.fg4)
        Chip(text: pr.badge, tone: pr.badge == "open" ? .live : pr.badge == "merged" ? .done : .outline)
        Spacer(minLength: z(8))
        ChecksSummary(checks: pr.checks)
      }
      HStack(spacing: z(12)) {
        Text(pr.repo).font(.omni(size: 11.5, design: .monospaced)).lineLimit(1)
        Text(pr.author?.login ?? "unknown")
        Spacer(minLength: z(8))
        Text(Format.relTime(pr.updatedAt)).font(.omni(size: 11)).monospacedDigit().foregroundStyle(Tok.fg4)
      }
      .font(.omni(size: 12))
      .foregroundStyle(Tok.fg3)
      .padding(.leading, z(22))
    }
    .padding(.horizontal, z(14))
    .padding(.vertical, z(12))
    .contentShape(RoundedRectangle(cornerRadius: z(18), style: .continuous))
    .hoverWash()
    .accessibilityElement(children: .combine)
  }
}
