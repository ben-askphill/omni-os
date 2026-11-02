import OmniKit
import SwiftUI

/// A thread branch's PRs, PR watch and changes, and its crew's PRs, read for the inspector: the Details tab's branch
/// card, the PRs tab and the PRs tab's dot all show it. Read again when a turn ends (it may have opened the PR) and
/// every minute to catch a merge, as `useThreadPR` in apps/web/src/components/thread/ThreadPR.tsx.
@MainActor @Observable final class ThreadBranchModel {
  struct Changes: Equatable {
    let files: Int
    let add: Int
    let del: Int
  }

  /// nil until the first answer, so nothing flashes "No PR yet" before the PR shows.
  private(set) var prs: ThreadPullRequests?
  private(set) var changes: Changes?
  var watch: PRWatch?
  var watchError: String?
  private(set) var asking = false
  private(set) var askError: String?

  var pr: PullRequestSummary? { prs?.pr }
  var next: ThreadGlance.Next? { ThreadGlance.next(pr, hasChanges: (changes?.files ?? 0) > 0) }

  /// A thread without a branch reads only its crew's PRs.
  func load(client: OmniClient, thread: String, hasBranch: Bool) async {
    do {
      prs = try await client.pullRequests(forThread: thread)
    } catch {
      // A failed read keeps the last answer, and says "No PR yet" before any.
      if prs == nil { prs = try? JSONDecoder().decode(ThreadPullRequests.self, from: Data(#"{"pr":null,"prs":[]}"#.utf8)) }
    }
    guard hasBranch else { return }
    if let view = try? await ChangesView(client.changes(forThread: thread)) {
      changes = Changes(files: view.fileCount, add: view.additions, del: view.deletions)
    }
    guard prs?.pr != nil else { return }
    if let w = try? await client.prWatch(forThread: thread) { watch = w }
  }

  /// Asks the agent for a branch step (open a PR, fix conflicts or checks). Mid-turn it queues, so the agent finishes
  /// its work before it commits.
  func ask(_ prompt: String, client: OmniClient, store: ThreadStore) async {
    guard !asking else { return }
    asking = true
    askError = nil
    defer { asking = false }
    do {
      let t = try await client.reply(to: store.id, prompt: prompt, mode: store.running ? .queue : nil, files: [])
      store.merge(t, isReply: true)
    } catch {
      askError = error.localizedDescription
    }
  }

  func toggleWatch(client: OmniClient, thread: String) async {
    let start = watch?.isWatching != true
    do {
      watch = start ? try await client.startPRWatch(forThread: thread) : try await client.stopPRWatch(forThread: thread)
      watchError = nil
    } catch {
      watchError = error.localizedDescription
    }
  }

  static func color(_ tone: ThreadGlance.Tone) -> Color {
    switch tone {
    case .live: Tok.live
    case .done: Tok.done
    case .needs: Tok.needs
    case .outline: Tok.fg4
    }
  }
}

/// The step the branch's PR calls for, as one button: a prompt to the agent, or Merge on the PR page.
struct PRNextButton: View {
  let model: AppModel
  let store: ThreadStore
  let branch: ThreadBranchModel
  let next: ThreadGlance.Next

  var body: some View {
    Button {
      if let prompt = next.prompt {
        Task { await branch.ask(prompt, client: model.client, store: store) }
      } else if let pr = branch.pr, let channel = store.thread?.channelID {
        model.route = .channel(id: channel, tab: .prs, pr: pr.number)
      }
    } label: {
      HStack(spacing: z(6)) {
        if branch.asking { Loader(size: 12) } else { OmniIcon(name: next == .open || next == .merge ? "pr" : "zap", size: 14) }
        Text(next == .merge ? "Merge #\(branch.pr?.number ?? 0)" : next.label)
      }
      .frame(maxWidth: .infinity)
    }
    .buttonStyle(.pill(next == .open || next == .merge ? .primary : .secondary, height: 28))
    .disabled(branch.asking)
    .help(next.prompt ?? "Open the PR to merge it")
  }
}

/// The top of the Details tab, as GlanceCard.tsx: the branch, its PR and what changed, each opening its tab, then the one
/// step the PR calls for. Nothing for a thread without a branch.
struct GlanceCard: View {
  let model: AppModel
  let store: ThreadStore
  let branch: ThreadBranchModel
  @Binding var tab: InspectorSelection.Tab
  @State private var copied = false

  var body: some View {
    if let name = store.thread?.branch, !name.isEmpty {
      VStack(spacing: 0) {
        row(icon: "branch") {
          Text(name).font(.omni(size: 12, design: .monospaced)).lineLimit(1).truncationMode(.middle)
          if let base = branch.pr?.baseRefName { Text("into \(base)").foregroundStyle(Tok.fg3).lineLimit(1) }
          Spacer(minLength: z(4))
          Button {
            Pasteboard.copy(name)
            copied = true
            Task {
              try? await Task.sleep(for: .seconds(1.5))
              copied = false
            }
          } label: {
            OmniIcon(name: copied ? "check" : "copy", size: 13)
          }
          .buttonStyle(.icon(size: 24))
          .help("Copy the branch name")
        }
        Button { tab = .prs } label: {
          row(icon: "pr", chevron: true) {
            if branch.prs == nil {
              Text("Checking for a PR").foregroundStyle(Tok.fg3)
            } else if let pr = branch.pr {
              let line = ThreadGlance.line(pr)
              Text("#\(pr.number)").monospacedDigit()
              Chip(text: line.tone == .needs && pr.badge == "open" ? "blocked" : pr.badge, tone: line.tone == .needs ? .needs : pr.badge == "open" ? .live : pr.badge == "merged" ? .done : .outline)
              Text(line.text).foregroundStyle(Tok.fg3).lineLimit(1)
            } else {
              Text("No PR yet").foregroundStyle(Tok.fg3)
            }
            Spacer(minLength: 0)
          }
        }
        .buttonStyle(.plain)
        .help("Show PRs")
        Button { tab = .changes } label: {
          row(icon: "diff", chevron: true) {
            if let c = branch.changes {
              if c.files > 0 {
                Text("\(Format.plural(c.files, "file")) changed")
                Spacer(minLength: z(4))
                (Text("+\(c.add)").foregroundStyle(Tok.fg2) + Text("  −\(c.del)").foregroundStyle(Tok.fg4)).font(.omni(size: 11.5).monospacedDigit())
              } else {
                Text("No changes against the base").foregroundStyle(Tok.fg3)
                Spacer(minLength: 0)
              }
            } else {
              Text("Changes").foregroundStyle(Tok.fg3)
              Spacer(minLength: 0)
            }
          }
        }
        .buttonStyle(.plain)
        .help("Show changes")
        if let next = branch.next {
          PRNextButton(model: model, store: store, branch: branch, next: next)
            .padding(.horizontal, z(4))
            .padding(.top, z(8))
            .padding(.bottom, z(4))
            .overlay(alignment: .top) { Hairline() }
            .padding(.top, z(4))
        }
        if let error = branch.askError {
          Text(error).font(.omni(size: 11.5)).foregroundStyle(Tok.needs).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, z(10)).padding(.bottom, z(6))
        }
      }
      .padding(z(6))
      .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(18), style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: z(18), style: .continuous).strokeBorder(Tok.line))
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Branch at a glance")
    }
  }

  private func row<V: View>(icon: String, chevron: Bool = false, @ViewBuilder _ content: () -> V) -> some View {
    HStack(spacing: z(10)) {
      OmniIcon(name: icon, size: 15).foregroundStyle(Tok.fg3)
      HStack(spacing: z(8)) { content() }
      if chevron { OmniIcon(name: "chevronRight", size: 13).foregroundStyle(Tok.fg4) }
    }
    .font(.omni(size: 12.5))
    .padding(.horizontal, z(10))
    .frame(height: z(40))
    .contentShape(RoundedRectangle(cornerRadius: z(12), style: .continuous))
    .rowHover(radius: 12)
  }
}

/// The PRs tab, as PRsTab.tsx: every PR from the branch with what decides whether it can merge, the step it calls for,
/// and the watch that wakes the thread on a failed check or a review. Then the PRs of the threads it delegated to, also
/// on a thread without a branch, such as the Conductor's.
struct PRsTab: View {
  let model: AppModel
  let store: ThreadStore
  let branch: ThreadBranchModel

  var body: some View {
    let hasBranch = !(store.thread?.branch?.isEmpty ?? true)
    if let prs = branch.prs, hasBranch || !prs.crew.isEmpty {
      ScrollView {
        VStack(alignment: .leading, spacing: z(10)) {
          if hasBranch { branchSection(prs) }
          if !prs.crew.isEmpty { crewSection(prs.crew) }
        }
        .padding(.horizontal, z(10))
        .padding(.bottom, z(12))
      }
    } else if branch.prs != nil {
      EmptyNote(symbol: "pr", title: "No branch", message: "This thread works in the channel folder, not on a branch of its own, so it has no PRs.")
        .panelEmptyNote()
    } else {
      ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  @ViewBuilder private func branchSection(_ prs: ThreadPullRequests) -> some View {
    if prs.prs.isEmpty {
      VStack(spacing: z(6)) {
        Text("No PR yet").font(.omni(size: 13, weight: .medium))
        Text("Nothing from \(store.thread?.branch ?? "this branch") has been sent for review.")
          .font(.omni(size: 12.5)).foregroundStyle(Tok.fg3).multilineTextAlignment(.center)
        PRNextButton(model: model, store: store, branch: branch, next: .open).fixedSize().padding(.top, z(6))
      }
      .frame(maxWidth: .infinity)
      .padding(.vertical, z(20))
      .padding(.horizontal, z(16))
      .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(20), style: .continuous))
    } else {
      HStack {
        Text("Pull requests").omniCaption()
        Spacer()
        Text("\(Format.plural(prs.prs.count, "PR")) from \(store.thread?.branch ?? "")").font(.omni(size: 11)).foregroundStyle(Tok.fg3).lineLimit(1).truncationMode(.middle)
      }
      .padding(.horizontal, z(8))
      VStack(spacing: 0) {
        ForEach(prs.prs) { p in prRow(p) }
      }
      .padding(z(4))
      .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(20), style: .continuous))
      HStack(spacing: z(6)) {
        if let next = branch.next, next != .open { PRNextButton(model: model, store: store, branch: branch, next: next).fixedSize() }
        if prs.canOpenAnother { PRNextButton(model: model, store: store, branch: branch, next: .open).fixedSize() }
      }
      .padding(.horizontal, z(4))
    }
    if let pr = prs.pr { watchCard(open: pr.isOpen) }
  }

  private func crewSection(_ crew: [CrewPullRequest]) -> some View {
    VStack(alignment: .leading, spacing: z(10)) {
      HStack {
        Text("From delegated threads").omniCaption()
        Spacer()
        Text(Format.plural(crew.count, "PR")).font(.omni(size: 11)).foregroundStyle(Tok.fg3)
      }
      .padding(.horizontal, z(8))
      VStack(spacing: 0) {
        ForEach(crew) { p in crewRow(p) }
      }
      .padding(z(4))
      .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(20), style: .continuous))
    }
  }

  /// Opens the PR in its channel's PRs, and beside it the thread that opened it.
  private func crewRow(_ p: CrewPullRequest) -> some View {
    HStack(spacing: z(4)) {
      Button {
        model.route = .channel(id: p.channelID, tab: .prs, pr: p.number)
      } label: {
        HStack(alignment: .top, spacing: z(10)) {
          Text("#\(p.number)").font(.omni(size: 12.5).monospacedDigit()).foregroundStyle(Tok.fg3).frame(width: z(36), alignment: .leading)
          VStack(alignment: .leading, spacing: z(3)) {
            Text(p.title).font(.omni(size: 13, weight: .medium)).lineLimit(1)
            Text(p.byline).font(.omni(size: 11.5)).foregroundStyle(Tok.fg3).lineLimit(1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          PRChip(text: p.badge, tone: p.badge == "open" ? .ok : p.badge == "merged" ? .info : .outline)
        }
        .padding(.leading, z(12))
        .padding(.vertical, z(10))
        .contentShape(RoundedRectangle(cornerRadius: z(16), style: .continuous))
      }
      .buttonStyle(.plain)
      .help("\(p.repo)#\(p.number): \(p.title)")
      Button {
        model.route = .thread(id: p.threadID)
      } label: {
        OmniIcon(name: "delegate", size: 13)
      }
      .buttonStyle(.icon(size: 24))
      .help("Open the delegated thread")
    }
    .padding(.trailing, z(8))
    .rowHover(radius: 16)
  }

  private func prRow(_ p: PullRequestSummary) -> some View {
    let line = ThreadGlance.line(p)
    return Button {
      if let channel = store.thread?.channelID { model.route = .channel(id: channel, tab: .prs, pr: p.number) }
    } label: {
      HStack(alignment: .top, spacing: z(10)) {
        Text("#\(p.number)").font(.omni(size: 12.5).monospacedDigit()).foregroundStyle(Tok.fg3).frame(width: z(36), alignment: .leading)
        VStack(alignment: .leading, spacing: z(3)) {
          Text(p.title).font(.omni(size: 13, weight: .medium)).lineLimit(1)
          HStack(spacing: z(6)) {
            Circle().fill(ThreadBranchModel.color(line.tone)).frame(width: z(6), height: z(6))
            Text(line.text).lineLimit(1)
          }
          .font(.omni(size: 11.5)).foregroundStyle(Tok.fg3)
          (Text("+\(p.additions)").foregroundStyle(Tok.fg3) + Text("  −\(p.deletions)  ") + Text(Format.relTime(p.updatedAt)))
            .font(.omni(size: 11).monospacedDigit()).foregroundStyle(Tok.fg4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        PRChip(text: p.badge, tone: p.badge == "open" ? .ok : p.badge == "merged" ? .info : .outline)
      }
      .padding(.horizontal, z(12))
      .padding(.vertical, z(10))
      .contentShape(RoundedRectangle(cornerRadius: z(16), style: .continuous))
      .rowHover(radius: 16)
    }
    .buttonStyle(.plain)
    .help(p.title)
  }

  @ViewBuilder private func watchCard(open: Bool) -> some View {
    let watching = branch.watch?.isWatching == true
    let copy = PRWatch.copy(branch.watch)
    if open || watching {
      Button {
        Task { await branch.toggleWatch(client: model.client, thread: store.id) }
      } label: {
        HStack(alignment: .top, spacing: z(10)) {
          OmniIcon(name: "bell", size: 14).foregroundStyle(watching ? Tok.live : Tok.fg3)
          VStack(alignment: .leading, spacing: z(2)) {
            Text(copy.action).font(.omni(size: 12.5, weight: .medium))
            Text(branch.watchError ?? copy.line).font(.omni(size: 11.5)).foregroundStyle(branch.watchError == nil ? Tok.fg3 : Tok.needs)
              .fixedSize(horizontal: false, vertical: true)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, z(14))
        .padding(.vertical, z(12))
        .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(20), style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: z(20), style: .continuous))
      }
      .buttonStyle(.plain)
      .padding(.top, z(6))
      .accessibilityAddTraits(watching ? .isSelected : [])
    } else if let watch = branch.watch {
      Text(watch.watchLine).font(.omni(size: 11.5)).foregroundStyle(Tok.fg4).padding(.horizontal, z(8)).padding(.top, z(6))
    }
  }
}

/// Where the thread sits among its agents, as AgentsSection.tsx: where it came from, what it handed on to, the sub-agents
/// and delegated threads running now, and the finished delegations folded under Previous agents.
struct AgentsCard: View {
  let model: AppModel
  let store: ThreadStore
  @State private var showPrevious = true

  var body: some View {
    let agents = OmniKit.BackgroundTask.runningSubagents(model.store.tasks, in: store.id)
    let running = store.children.filter(\.status.isActive)
    let previous = store.children.filter { !$0.status.isActive }
    let lineage = store.parent != nil || store.continuedFrom != nil || !store.continuedIn.isEmpty
    if lineage || !agents.isEmpty || !store.children.isEmpty {
      VStack(alignment: .leading, spacing: 0) {
        if lineage {
          caption("Lineage")
          if let parent = store.parent {
            link(parent.id, title: parent.title, sub: "From", side: parent.status.rawValue.capitalized) { mark(icon: "arrowUpRight", status: parent.status) }
          }
          if let from = store.continuedFrom {
            link(from.id, title: from.title, sub: "Continued from", side: Format.relTime(from.createdAt)) { mark(harness: from.harness, status: from.status) }
          }
          ForEach(store.continuedIn) { l in
            link(l.id, title: l.title, sub: "Continued in", side: Format.relTime(l.createdAt)) { mark(harness: l.harness, status: l.status) }
          }
        }
        if !agents.isEmpty || !running.isEmpty {
          HStack {
            Text("Running").omniCaption()
            Spacer()
            Text("\(agents.count + running.count)").font(.omni(size: 11)).monospacedDigit().foregroundStyle(Tok.fg3)
          }
          .padding(.horizontal, z(12))
          .padding(.top, z(lineage ? 10 : 8))
          .padding(.bottom, z(4))
          .overlay(alignment: .top) { if lineage { Hairline() } }
          ForEach(running) { c in
            link(c.id, title: c.title, side: Format.relTime(c.updatedAt)) { mark(harness: c.harness, status: c.status) }
          }
          ForEach(agents) { SubagentRow(task: $0, jump: jump) }
        }
        if !previous.isEmpty {
          Button {
            showPrevious.toggle()
          } label: {
            HStack(spacing: z(10)) {
              OmniIcon(name: "delegate", size: 15).foregroundStyle(Tok.fg3)
              Text("Previous agents").foregroundStyle(Tok.fg2).frame(maxWidth: .infinity, alignment: .leading)
              Text("\(previous.count)").font(.omni(size: 11)).monospacedDigit().foregroundStyle(Tok.fg3)
              OmniIcon(name: "chevronDown", size: 13).foregroundStyle(Tok.fg4).rotationEffect(.degrees(showPrevious ? 0 : -90))
            }
            .padding(.horizontal, z(12))
            .frame(height: z(36))
            .contentShape(Capsule())
            .rowHover(radius: 18)
          }
          .buttonStyle(.plain)
          .accessibilityValue(showPrevious ? "Expanded" : "Collapsed")
          if showPrevious {
            ForEach(previous) { c in
              link(c.id, title: c.title, side: Format.relTime(c.updatedAt)) { mark(harness: c.harness, status: c.status) }
            }
          }
        }
      }
      .font(.omni(size: 12.5))
      .padding(z(4))
      .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(20), style: .continuous))
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Agents")
      #if DEBUG
      .onAppear { QAProbe.jumpSubagent = { press($0, agents) } }
      .onChange(of: agents) { QAProbe.jumpSubagent = { press($0, agents) } }
      .onDisappear { QAProbe.jumpSubagent = nil }
      #endif
    }
  }

  private func jump(_ at: Int) {
    Task { await store.reveal(at) }
  }

  #if DEBUG
  /// What a click on the running subagent row at an index does, for the QA runner's `subagent` step.
  private func press(_ i: Int, _ agents: [OmniKit.BackgroundTask]) -> (thread: String, at: Int)? {
    guard agents.indices.contains(i), let at = agents[i].eventID else { return nil }
    jump(at)
    return (agents[i].threadID, at)
  }
  #endif

  private func caption(_ text: String) -> some View {
    Text(text).omniCaption().padding(.horizontal, z(12)).padding(.top, z(8)).padding(.bottom, z(4))
  }

  /// A thread's harness logo, or an icon, with its status dot on the corner.
  private func mark(harness: HarnessID? = nil, icon: String? = nil, status: ThreadStatus) -> some View {
    ZStack(alignment: .bottomTrailing) {
      Group {
        if let icon { OmniIcon(name: icon, size: 15) } else { HarnessLogo(harness: harness?.rawValue ?? "claude-code", size: 15) }
      }
      .foregroundStyle(Tok.fg3)
      .frame(width: z(20), height: z(20))
      StatusDot(status: status, size: 6)
        .padding(z(1.5))
        .background(Tok.bg, in: Circle())
        .offset(x: z(2), y: z(2))
    }
  }

  private func link<M: View>(_ id: String, title: String, sub: String? = nil, side: String, @ViewBuilder mark: () -> M) -> some View {
    Button {
      model.route = .thread(id: id)
    } label: {
      HStack(spacing: z(10)) {
        mark()
        (Text(sub.map { "\($0) " } ?? "").foregroundStyle(Tok.fg3) + Text(title.isEmpty ? "Untitled" : title))
          .lineLimit(1).truncationMode(.tail).frame(maxWidth: .infinity, alignment: .leading)
        Text(side).font(.omni(size: 11)).foregroundStyle(Tok.fg3)
      }
      .padding(.horizontal, z(12))
      .frame(height: z(36))
      .contentShape(Capsule())
      .rowHover(radius: 18)
    }
    .buttonStyle(.plain)
    .help(sub.map { "\($0): \(title)" } ?? title)
  }
}
