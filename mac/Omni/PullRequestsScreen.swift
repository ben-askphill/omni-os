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
        EmptyNote(symbol: "pr", title: "No GitHub repo linked",
                  message: "Set a local repo path in settings. Omni detects the GitHub repo from it, and builder threads get their own worktree.") {
          Button { model.route = .channel(id: channelID, tab: .settings) } label: {
            HStack(spacing: z(8)) {
              OmniIcon(name: "sliders", size: 15)
              Text("Open settings")
            }
          }
          .buttonStyle(.pill(.secondary, height: 34))
        }
        .frame(maxHeight: .infinity, alignment: .top)
      }
    } else {
      LoadingNote().padding(.horizontal, z(32)).frame(maxHeight: .infinity, alignment: .top)
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
      VStack(alignment: .leading, spacing: z(12)) {
        HStack(spacing: z(4)) {
          SegmentedPill(selection: $state, options: PullRequestListState.allCases.map { ($0, $0.rawValue.capitalized) }, small: true)
            .fixedSize()
            .accessibilityElement(children: .contain)
            .accessibilityLabel("State")
          Spacer()
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
          if let url = URL(string: "https://github.com/\(repo)/pulls") {
            Link(destination: url) {
              HStack(spacing: z(6)) {
                OmniIcon(name: "external", size: 14)
                Text("GitHub")
              }
            }
            .buttonStyle(.pill(.ghost, height: 28))
          }
        }
        content
      }
      .frame(maxWidth: z(896))
      .padding(.horizontal, z(32))
      .padding(.top, z(24))
      .padding(.bottom, z(64))
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
      LoadingNote(label: "Asking GitHub")
    case .failure(let error):
      ErrorNote(text: error.message) { Task { await load() } }
    case .success(let prs) where prs.isEmpty:
      EmptyNote(symbol: "pr", title: "No \(state == .all ? "" : state.rawValue + " ")pull requests", message: repo)
    case .success(let prs):
      VStack(spacing: 0) {
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
      .contentShape(RoundedRectangle(cornerRadius: z(18), style: .continuous))
      .background(configuration.isPressed ? Tok.surface2 : .clear, in: RoundedRectangle(cornerRadius: z(18), style: .continuous))
  }
}

private struct PullRequestRow: View {
  let pr: PullRequestSummary

  var body: some View {
    VStack(alignment: .leading, spacing: z(3)) {
      HStack(spacing: z(8)) {
        PRStateIcon(state: pr.state, isDraft: pr.isDraft)
        Text(pr.title).font(.omni(size: 14, weight: .medium)).foregroundStyle(Tok.fg).lineLimit(1)
        Text("#\(pr.number)").font(.omni(size: 11.5)).monospacedDigit().foregroundStyle(Tok.fg4)
        if pr.isDraft { PRChip(text: "Draft", tone: .outline) }
        ReviewChip(decision: pr.reviewDecision)
        Spacer(minLength: z(8))
        ChecksSummary(checks: pr.checks)
      }
      HStack(spacing: z(12)) {
        Text(pr.author?.login ?? "unknown")
        BranchLabel(head: pr.headRefName, base: pr.baseRefName)
        Changes(add: pr.additions, del: pr.deletions)
        Spacer(minLength: z(8))
        Text(Format.relTime(pr.updatedAt)).font(.omni(size: 11)).monospacedDigit().foregroundStyle(Tok.fg4)
      }
      .font(.omni(size: 12))
      .foregroundStyle(Tok.fg3)
      .padding(.leading, z(22))
    }
    .padding(.horizontal, z(14))
    .padding(.vertical, z(12))
    .hoverWash()
    .accessibilityElement(children: .combine)
  }
}

// MARK: Shared pieces

struct PRStateIcon: View {
  let state: String?
  let isDraft: Bool

  var body: some View {
    OmniIcon(name: "pr", size: 14)
      .foregroundStyle(color)
      .frame(width: z(14))
  }

  /// Open is live, merged is fg-2, closed and drafts recede.
  private var color: Color {
    if isDraft { return Tok.fg4 }
    switch state {
    case "MERGED": return Tok.fg2
    case "CLOSED": return Tok.fg4
    default: return Tok.live
    }
  }
}

struct PRChip: View {
  enum Tone { case plain, ok, bad, warn, info, outline }
  let text: String
  var tone = Tone.plain

  /// The tones map onto Chip's: ok is volt, bad is vermilion with ink text, info is ultramarine.
  var body: some View {
    Chip(text: text, tone: chipTone)
  }

  private var chipTone: Chip.Tone {
    switch tone {
    case .ok: .done
    case .bad: .needs
    case .info: .live
    case .outline: .outline
    case .warn, .plain: .plain
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
      Text("no checks").font(.omni(size: 12)).foregroundStyle(Tok.fg4)
    } else {
      HStack(spacing: z(8)) {
        if checks.passed > 0 { count(.done, checks.passed).foregroundStyle(Tok.fg2) }
        if checks.failed > 0 { count(.needs, checks.failed).foregroundStyle(Tok.fg2) }
        if checks.pending > 0 { count(.running, checks.pending).foregroundStyle(Tok.live) }
      }
      .font(.omni(size: 11.5))
      .monospacedDigit()
      .help("\(checks.passed) passed, \(checks.failed) failed, \(checks.pending) pending")
    }
  }

  private func count(_ glyph: Glyph, _ n: Int) -> some View {
    HStack(spacing: z(4)) {
      GlyphView(glyph: glyph, size: 7)
      Text("\(n)")
    }
  }
}

struct BranchLabel: View {
  let head: String
  let base: String

  var body: some View {
    (Text(head) + Text(" into ").font(.omni(size: 11.5)).foregroundStyle(Tok.fg4) + Text(base))
      .font(.omni(size: 11.5, design: .monospaced))
      .lineLimit(1)
      .truncationMode(.middle)
  }
}

struct Changes: View {
  let add: Int
  let del: Int

  var body: some View {
    HStack(spacing: z(4)) {
      Text("+\(add)").foregroundStyle(Tok.fg2)
      Text("-\(del)").foregroundStyle(Tok.fg3)
    }
    .font(.omni(size: 11))
    .monospacedDigit()
  }
}
