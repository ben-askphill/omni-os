import OmniKit
import SwiftUI

/// Each thread's actions and setup run (GET /api/threads/:id/actions), for the transcript's setup card and strip.
/// The transcript asks `shows` before it draws either, so a ready thread whose setup runs alongside the agent gets
/// its strip without a view that waits on screen for it: an empty view never runs its tasks, and an empty row would
/// still take the stack's spacing.
@MainActor @Observable
final class SetupRuns {
  static let shared = SetupRuns()

  private(set) var actions: [String: ThreadActions] = [:]
  /// Each thread's `setup` when last asked. A thread first seen ready, or seen turning ready, is loaded once.
  @ObservationIgnored private var setups: [String: ThreadSetup?] = [:]

  /// The thread is preparing or failed, or it is a ready worktree thread here whose setup run still runs or failed.
  func shows(_ t: OmniThread, client: OmniClient) -> Bool {
    if t.setup != nil {
      setups[t.id] = t.setup
      return true
    }
    guard t.branch != nil, !t.harness.isRemote else { return false }
    if setups.updateValue(nil, forKey: t.id) != .some(nil) {
      Task { await load(t.id, client: client) }
    }
    return actions[t.id]?.backgroundSetupRun != nil
  }

  func load(_ thread: String, client: OmniClient) async {
    if let a = try? await client.threadActions(thread) { actions[thread] = a }
  }
}

/// SetupCard.tsx: a worktree thread whose worktree is not ready (apps/server/runner/setup.ts), and after that the
/// channel's setup action while it runs alongside the agent. Preparing shows the checkout, the setup action and the
/// agent as steps, with the setup run's output and Stop. Nothing runs until it is ready; the first message and its
/// files wait below, kept across restarts. Retry uses the same thread, branch and session. Nothing pushes run
/// updates, so the card asks every second while the thread prepares or the setup run runs.
struct SetupCard: View {
  let model: AppModel
  let store: ThreadStore
  let thread: OmniThread
  /// Counts answers, so each one schedules the next poll even when nothing changed.
  @State private var loads = 0

  private static let poll = Duration.seconds(1)

  static func shows(_ t: OmniThread, model: AppModel) -> Bool { SetupRuns.shared.shows(t, client: model.client) }

  var body: some View {
    let actions = SetupRuns.shared.actions[thread.id]
    Group {
      if thread.setup != nil {
        PreparationCard(model: model, store: store, thread: thread, actions: actions) { await load() }
      } else if let run = actions?.backgroundSetupRun {
        SetupStrip(client: model.client, thread: thread.id, run: run) { await load() }
      }
    }
    .task(id: thread.setup) { await load() }
    .task(id: pollToken(actions)) {
      guard pollToken(actions) != nil else { return }
      try? await Task.sleep(for: Self.poll)
      if !Task.isCancelled { await load() }
    }
  }

  private func pollToken(_ a: ThreadActions?) -> Int? {
    thread.setup == .preparing || a?.setupRun?.state == .running ? loads : nil
  }

  private func load() async {
    await SetupRuns.shared.load(thread.id, client: model.client)
    loads += 1
  }
}

/// The card while the worktree is prepared, or once preparing it failed or Ben stopped it.
private struct PreparationCard: View {
  let model: AppModel
  let store: ThreadStore
  let thread: OmniThread
  let actions: ThreadActions?
  let reload: () async -> Void
  @State private var busy = false
  @State private var error: String?
  /// Where the branch starts. Resolved during setup (a remote default fetches first), so it is read again as setup moves.
  @State private var base: ThreadBaseView?

  var body: some View {
    let failed = thread.setup == .failed
    let stopped = failed && thread.status == .stopped
    // A thread that runs off this Mac gets no setup action, whatever the channel has.
    let action = thread.harness.isRemote ? nil : actions?.setupAction
    let run = actions?.setupRun
    let steps = PreparationStep.steps(setup: thread.setup, action: action, run: run)
    let title = stopped ? "Setup stopped" : failed ? "Setup failed" : "Preparing worktree"
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: z(12)) {
        ZStack {
          Circle().fill(failed ? Tok.needs.opacity(0.12) : Tok.surface2)
          if failed {
            OmniIcon(name: stopped ? "stop" : "alert", size: 15).foregroundStyle(Tok.needs)
          } else {
            Loader(size: 14, color: Tok.fg2)
          }
        }
        .frame(width: z(28), height: z(28))
        VStack(alignment: .leading, spacing: z(2)) {
          Text(title)
            .font(.omni(size: 14, weight: .semibold))
            .foregroundStyle(Tok.fg)
          Text(failed ? "Nothing ran. Your message and files are kept and send once the worktree is ready." : note(steps))
            .font(.omni(size: 12.5))
            .foregroundStyle(Tok.fg3)
            .fixedSize(horizontal: false, vertical: true)
          if let base {
            Text(base.line)
              .font(.omni(size: 12.5))
              .foregroundStyle(Tok.fg2)
              .fixedSize(horizontal: false, vertical: true)
              .padding(.top, z(4))
          }
          if actions != nil {
            StepList(steps: steps).padding(.top, z(8))
          }
          if failed, let reason = thread.setupError {
            Text(reason)
              .font(.omni(size: 11.5, design: .monospaced))
              .foregroundStyle(Tok.fg2)
              .textSelection(.enabled)
              .fixedSize(horizontal: false, vertical: true)
              .padding(.horizontal, z(10))
              .padding(.vertical, z(6))
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(Tok.surface2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
              .padding(.top, z(6))
          }
          if let run, run.state == .running || (failed && !run.output.isEmpty) {
            SetupOutput(run: run).padding(.top, z(8))
          }
          if let branch = thread.branch {
            IconLabel(branch, icon: "branch", size: 12)
              .font(.omni(size: 11.5, design: .monospaced))
              .foregroundStyle(Tok.fg4)
              .lineLimit(1)
              .help(thread.cwd ?? branch)
              .padding(.top, z(6))
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        if failed {
          Button { retry() } label: {
            HStack(spacing: z(6)) {
              if busy { Loader(size: 12) } else { OmniIcon(name: "refresh", size: 13) }
              Text("Retry setup")
            }
          }
          .buttonStyle(.pill(.primary, height: 28))
          .help("Prepare the worktree again on the same branch, then send the waiting message")
          .disabled(busy)
        } else {
          Button { stop() } label: {
            HStack(spacing: z(6)) {
              if busy { Loader(size: 12) } else { OmniIcon(name: "stop", size: 12) }
              Text("Stop")
            }
          }
          .buttonStyle(.pill(.secondary, height: 28))
          .help("Stop preparing the worktree. Your message is kept for Retry setup.")
          .disabled(busy)
        }
      }
      .padding(.horizontal, z(16))
      .padding(.vertical, z(12))
      if let error {
        ErrorNote(text: error)
          .padding(.horizontal, z(12))
          .padding(.bottom, z(12))
      }
    }
    .background(Tok.surface)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Tok.line))
    .padding(.top, z(8))
    .accessibilityElement(children: .contain)
    .accessibilityLabel(title)
    .task(id: thread.setup) {
      if let view = try? await model.client.threadBase(thread.id) { base = view }
    }
    // Stop and Retry stay busy until the server moves the thread on: a stop lands once the setup run has exited.
    .onChange(of: thread.setup) { busy = false }
  }

  /// What preparing is doing now.
  private func note(_ steps: [PreparationStep]) -> String {
    switch steps.first(where: { $0.state == .active })?.kind {
    case .setup?: "Running the channel's setup in the new checkout before the agent starts."
    case .agent?: "Starting the agent."
    default: "Making the thread its own checkout before anything runs."
    }
  }

  private func stop() {
    guard !busy else { return }
    busy = true
    Task {
      await store.interrupt()
      if store.actionError != nil { busy = false }
      await reload()
    }
  }

  private func retry() {
    guard !busy else { return }
    busy = true
    error = nil
    let client = model.client
    let id = thread.id
    Task {
      do {
        store.apply(recovery: try await client.retrySetup(in: id))
      } catch let e as OmniAPIError {
        error = e.message
        busy = false
      } catch {
        self.error = error.localizedDescription
        busy = false
      }
    }
  }
}

/// Checkout, the channel's setup action, then the agent, each with how far it got.
private struct StepList: View {
  let steps: [PreparationStep]

  var body: some View {
    VStack(alignment: .leading, spacing: z(6)) {
      ForEach(steps) { step in
        HStack(alignment: .firstTextBaseline, spacing: z(8)) {
          StepGlyph(state: step.state)
          Text(step.title)
            .font(.omni(size: 12.5, weight: step.state == .active ? .medium : .regular))
            .foregroundStyle(step.state == .waiting ? Tok.fg4 : Tok.fg2)
            .lineLimit(1)
          if let detail = step.detail {
            Text(detail)
              .font(.omni(size: 11.5))
              .foregroundStyle(Tok.fg4)
              .lineLimit(1)
          }
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(Self.spoken(step.state))
      }
    }
  }

  private static func spoken(_ state: PreparationStep.State) -> String {
    switch state {
    case .done: "Done"
    case .active: "In progress"
    case .failed: "Failed"
    case .waiting: "Waiting"
    }
  }
}

private struct StepGlyph: View {
  let state: PreparationStep.State

  var body: some View {
    Group {
      switch state {
      case .done: GlyphView(glyph: .done, size: 8)
      case .active: Loader(size: 11, color: Tok.live)
      case .failed: GlyphView(glyph: .needs, size: 8)
      case .waiting: Circle().strokeBorder(Tok.lineStrong, lineWidth: 1).frame(width: z(8), height: z(8))
      }
    }
    .frame(width: z(12), height: z(12))
    .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + z(4) }
  }
}

/// The setup run's output in the card: its end, in a short scroll, or a line while it has printed nothing.
private struct SetupOutput: View {
  let run: ActionRun

  var body: some View {
    VStack(alignment: .leading, spacing: z(4)) {
      if let note = run.outputNote {
        Text(note).font(.omni(size: 11)).foregroundStyle(Tok.fg4)
      }
      if run.output.isEmpty {
        Text("Waiting for output").font(.omni(size: 12)).foregroundStyle(Tok.fg4)
      } else {
        RunOutput(text: run.output, height: 180)
      }
    }
  }
}

/// A ready thread's setup run alongside the agent: one line while it runs, with Stop and its output on request, and
/// the failure with its output and Run again. Gone once it succeeds or is stopped.
private struct SetupStrip: View {
  let client: OmniClient
  let thread: String
  let run: ActionRun
  let reload: () async -> Void
  @State private var busy = false
  @State private var error: String?
  /// Ben opened or closed the output. A running run starts closed, a failed one open.
  @State private var toggled = false

  var body: some View {
    let running = run.state == .running
    let expanded = (run.state == .failed) != toggled
    let title = running ? "Setup \"\(run.name)\" is running alongside the agent" : "Setup \"\(run.name)\" failed"
    VStack(alignment: .leading, spacing: z(8)) {
      HStack(spacing: z(10)) {
        Button { toggled.toggle() } label: {
          HStack(spacing: z(10)) {
            RunGlyph(state: run.state)
            Text(title)
              .font(.omni(size: 12.5, weight: .medium))
              .foregroundStyle(Tok.fg)
              .lineLimit(1)
              .truncationMode(.middle)
            summary
              .font(.omni(size: 11.5).monospacedDigit())
              .foregroundStyle(Tok.fg3)
              .lineLimit(1)
            Spacer(minLength: z(4))
            OmniIcon(name: expanded ? "chevronDown" : "chevronRight", size: 12).foregroundStyle(Tok.fg4)
          }
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityHint(expanded ? "Hides the output" : "Shows the output")
        Button { act(running) } label: {
          HStack(spacing: z(6)) {
            if busy { Loader(size: 12) } else { OmniIcon(name: running ? "stop" : "refresh", size: 12) }
            Text(running ? "Stop" : "Run again")
          }
        }
        .buttonStyle(.pill(.secondary, height: 26))
        .disabled(busy || (!running && run.actionID == nil))
        .help(running ? "Stop \(run.name). The agent keeps going." : "Run \(run.name) again in this checkout")
      }
      if let e = run.error, !running {
        Text(e)
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg2)
          .fixedSize(horizontal: false, vertical: true)
          .textSelection(.enabled)
      }
      if expanded { SetupOutput(run: run) }
      if let error { ErrorNote(text: error) }
    }
    .padding(.horizontal, z(14))
    .padding(.vertical, z(10))
    .background(Tok.surface)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Tok.line))
    .padding(.top, z(8))
    .accessibilityElement(children: .contain)
  }

  @ViewBuilder private var summary: some View {
    if run.state == .running {
      TimelineView(.periodic(from: .now, by: 1)) { context in Text(run.summary(now: context.date)) }
    } else {
      Text(run.summary())
    }
  }

  private func act(_ running: Bool) {
    guard !busy else { return }
    busy = true
    error = nil
    Task {
      do throws(OmniAPIError) {
        if running {
          _ = try await client.stopActionRun(run.id, thread: thread)
        } else {
          _ = try await client.retryActionRun(run.id, thread: thread)
        }
      } catch {
        self.error = error.message
      }
      await reload()
      busy = false
    }
  }
}
