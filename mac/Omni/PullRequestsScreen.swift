import OmniKit
import SwiftUI

@MainActor func attempt<T>(_ body: () async throws(OmniAPIError) -> T) async -> Result<T, OmniAPIError> {
  do { return .success(try await body()) } catch { return .failure(error) }
}

/// The channel's PRs tab: `#/c/<id>/prs` lists, `#/c/<id>/prs/<n>` shows one. After PRs.tsx.
struct PullRequestsScreen: View {
  let model: AppModel
  let channelID: String
  let number: Int?

  var body: some View {
    if let channel = model.store.channel(channelID) {
      if let repo = channel.githubRepo {
        if let number {
          PullRequestDetailView(model: model, channelID: channelID, repo: repo, number: number)
            .id(number)
        } else {
          PullRequestListView(model: model, channelID: channelID, repo: repo)
        }
      } else {
        ContentUnavailableView {
          Label("No GitHub repo linked", systemImage: "arrow.triangle.pull")
        } description: {
          Text("Set a local repo path in settings. Omni detects the GitHub repo from it, and builder threads get their own worktree.")
        } actions: {
          Button("Open settings") { model.route = .channel(id: channelID, tab: .settings) }
        }
      }
    } else {
      ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

// MARK: List

private struct PullRequestListView: View {
  let model: AppModel
  let channelID: String
  let repo: String
  @State private var state = PullRequestListState.open
  @State private var result: Result<[PullRequestSummary], OmniAPIError>?
  @State private var reloading = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        HStack {
          Picker("State", selection: $state) {
            ForEach(PullRequestListState.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
          }
          .pickerStyle(.segmented)
          .labelsHidden()
          .fixedSize()
          Spacer()
          Button {
            Task { await load() }
          } label: {
            Label("Refresh", systemImage: "arrow.clockwise")
          }
          .disabled(reloading)
          if let url = URL(string: "https://github.com/\(repo)/pulls") {
            Link(destination: url) { Label("GitHub", systemImage: "arrow.up.right.square") }
          }
        }
        content
      }
      .frame(maxWidth: 896)
      .padding(.horizontal, 24)
      .padding(.vertical, 20)
      .frame(maxWidth: .infinity)
    }
    .task(id: state) {
      result = nil
      await load()
    }
  }

  @ViewBuilder private var content: some View {
    switch result {
    case nil:
      ProgressView("Asking GitHub").controlSize(.small).foregroundStyle(.secondary)
        .frame(maxWidth: .infinity).padding(.top, 60)
    case .failure(let error):
      ErrorNote(text: error.message) { Task { await load() } }
    case .success(let prs) where prs.isEmpty:
      ContentUnavailableView {
        Label("No \(state == .all ? "" : state.rawValue + " ")pull requests", systemImage: "arrow.triangle.pull")
      } description: {
        Text(repo)
      }
    case .success(let prs):
      VStack(spacing: 2) {
        ForEach(prs) { pr in
          Button {
            model.route = .channel(id: channelID, tab: .prs, pr: pr.number)
          } label: {
            PullRequestRow(pr: pr)
          }
          .buttonStyle(RowButtonStyle())
        }
      }
    }
  }

  private func load() async {
    reloading = true
    defer { reloading = false }
    let r = await attempt { () async throws(OmniAPIError) in try await model.client.pullRequests(in: channelID, state: state) }
    if case .failure(.cancelled) = r { return }
    result = r
  }
}

private struct RowButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .contentShape(Rectangle())
      .background(configuration.isPressed ? ThreadStyle.surface2 : .clear, in: RoundedRectangle(cornerRadius: 14))
  }
}

private struct PullRequestRow: View {
  let pr: PullRequestSummary
  @State private var hovering = false

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 8) {
        PRStateIcon(state: pr.state, isDraft: pr.isDraft)
        Text(pr.title).font(.system(size: 14, weight: .medium)).lineLimit(1)
        Text("#\(pr.number)").font(.system(size: 11.5)).monospacedDigit().foregroundStyle(.tertiary)
        if pr.isDraft { PRChip(text: "Draft", tone: .outline) }
        ReviewChip(decision: pr.reviewDecision)
        Spacer(minLength: 8)
        ChecksSummary(checks: pr.checks)
      }
      HStack(spacing: 12) {
        Text(pr.author?.login ?? "unknown")
        BranchLabel(head: pr.headRefName, base: pr.baseRefName)
        Changes(add: pr.additions, del: pr.deletions)
        Spacer(minLength: 8)
        Text(Format.relTime(pr.updatedAt)).foregroundStyle(.tertiary)
      }
      .font(.system(size: 12))
      .foregroundStyle(.secondary)
      .padding(.leading, 22)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .background(hovering ? ThreadStyle.surface : .clear, in: RoundedRectangle(cornerRadius: 14))
    .onHover { hovering = $0 }
    .accessibilityElement(children: .combine)
  }
}

// MARK: Shared pieces

struct PRStateIcon: View {
  let state: String?
  let isDraft: Bool

  var body: some View {
    Image(systemName: state == "MERGED" ? "arrow.triangle.merge" : "arrow.triangle.pull")
      .font(.system(size: 13))
      .foregroundStyle(color)
      .frame(width: 14)
  }

  private var color: Color {
    if isDraft { return .secondary }
    switch state {
    case "MERGED": return ThreadStyle.info
    case "CLOSED": return ThreadStyle.bad
    default: return ThreadStyle.ok
    }
  }
}

struct PRChip: View {
  enum Tone { case plain, ok, bad, warn, info, outline }
  let text: String
  var tone = Tone.plain

  var body: some View {
    Text(text)
      .font(.system(size: 11, weight: .medium))
      .foregroundStyle(colors.fg)
      .padding(.horizontal, 8)
      .frame(height: 20)
      .background(colors.bg, in: Capsule())
      .overlay { if tone == .outline { Capsule().strokeBorder(ThreadStyle.line) } }
  }

  private var colors: (fg: Color, bg: Color) {
    switch tone {
    case .ok: (ThreadStyle.ok, ThreadStyle.okBackground)
    case .bad: (ThreadStyle.bad, ThreadStyle.badBackground)
    case .warn: (ThreadStyle.warn, ThreadStyle.warnBackground)
    case .info: (ThreadStyle.info, ThreadStyle.infoBackground)
    case .outline: (.secondary, .clear)
    case .plain: (.primary.opacity(0.8), ThreadStyle.surface2)
    }
  }
}

struct ReviewChip: View {
  let decision: String?

  var body: some View {
    switch decision {
    case nil, "": EmptyView()
    case "APPROVED": PRChip(text: "Approved", tone: .ok)
    case "CHANGES_REQUESTED": PRChip(text: "Changes requested", tone: .bad)
    case "REVIEW_REQUIRED": PRChip(text: "Review required")
    case let other?: PRChip(text: other.lowercased().replacingOccurrences(of: "_", with: " "))
    }
  }
}

struct ChecksSummary: View {
  let checks: PRChecks

  var body: some View {
    if checks.isEmpty {
      Text("no checks").font(.system(size: 12)).foregroundStyle(.tertiary)
    } else {
      HStack(spacing: 8) {
        if checks.passed > 0 { Text("✓ \(checks.passed)").foregroundStyle(ThreadStyle.ok) }
        if checks.failed > 0 { Text("✗ \(checks.failed)").foregroundStyle(ThreadStyle.bad) }
        if checks.pending > 0 { Text("• \(checks.pending)").foregroundStyle(ThreadStyle.warn) }
      }
      .font(.system(size: 11.5))
      .monospacedDigit()
      .help("\(checks.passed) passed, \(checks.failed) failed, \(checks.pending) pending")
    }
  }
}

struct BranchLabel: View {
  let head: String
  let base: String

  var body: some View {
    (Text(head) + Text(" into ").font(.system(size: 11.5)).foregroundStyle(.tertiary) + Text(base))
      .font(.system(size: 11.5, design: .monospaced))
      .lineLimit(1)
      .truncationMode(.middle)
  }
}

struct Changes: View {
  let add: Int
  let del: Int

  var body: some View {
    HStack(spacing: 4) {
      Text("+\(add)").foregroundStyle(ThreadStyle.ok)
      Text("-\(del)").foregroundStyle(ThreadStyle.bad)
    }
    .font(.system(size: 11))
    .monospacedDigit()
  }
}
