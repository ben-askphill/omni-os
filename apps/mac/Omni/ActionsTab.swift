import OmniKit
import SwiftUI

/// The channel's named actions, run in this thread's checkout, and the thread's runs newest first. Nothing pushes run
/// updates, so the tab asks again every second while a run runs, and stops when it leaves the screen.
struct ActionsTab: View {
  let client: OmniClient
  let thread: String
  @State private var result: Result<ThreadActions, OmniAPIError>?
  /// Counts answers, so each one schedules the next poll even when nothing changed.
  @State private var loads = 0
  /// What the last Run, Stop or Retry was refused with, like a fixed port another thread holds.
  @State private var refusal: String?
  /// Actions and runs with a call in flight.
  @State private var busy: Set<String> = []
  /// Runs Ben opened or closed. The newest starts open.
  @State private var toggled: Set<String> = []

  private static let poll = Duration.seconds(1)

  var body: some View {
    Group {
      switch result {
      case nil:
        ScrollView { LoadingNote(label: "Loading actions").padding(.horizontal, z(10)) }
      case .failure(let error):
        ScrollView { ErrorNote(text: error.message) { Task { await load() } }.padding(.horizontal, z(10)) }
      case .success(let actions):
        content(actions)
      }
    }
    .frame(maxHeight: .infinity, alignment: .top)
    .task(id: thread) { await load() }
    .task(id: pollToken) {
      guard pollToken != nil else { return }
      try? await Task.sleep(for: Self.poll)
      if !Task.isCancelled { await load() }
    }
  }

  private var pollToken: Int? {
    guard case .success(let a) = result, a.keepPolling else { return nil }
    return loads
  }

  @ViewBuilder private func content(_ a: ThreadActions) -> some View {
    if a.actions.isEmpty && a.runs.isEmpty {
      EmptyNote(
        symbol: "play", title: "No actions in this channel",
        message: "Name the commands threads here can run, like a theme preview or the tests, in the channel's settings.")
        .panelEmptyNote()
    } else {
      ScrollView {
        VStack(alignment: .leading, spacing: z(10)) {
          if let blocked = a.blocked {
            Note(text: blocked)
          }
          ForEach(a.actions) { action in
            ActionRow(action: action, running: a.running(action), blocked: a.blocked != nil, busy: busy) {
              Task { await call(action.id) { () async throws(OmniAPIError) in _ = try await client.runAction(action.id, thread: thread) } }
            } stop: { run in
              Task { await stop(run) }
            }
          }
          if a.actions.isEmpty {
            Note(text: "This channel has no actions now. Add them in its settings.")
          }
          if let refusal { ErrorNote(text: refusal) }
          if !a.runs.isEmpty {
            Text("Runs")
              .font(.omni(size: 11.5, weight: .medium))
              .foregroundStyle(Tok.fg3)
              .padding(.horizontal, z(6))
              .padding(.top, z(6))
              .accessibilityAddTraits(.isHeader)
            ForEach(a.runs) { run in
              RunCard(
                run: run, expanded: (run.id == a.runs.first?.id) != toggled.contains(run.id), blocked: a.blocked != nil,
                busy: busy.contains(run.id)
              ) {
                toggled.formSymmetricDifference([run.id])
              } stop: {
                Task { await stop(run) }
              } retry: {
                Task { await call(run.id) { () async throws(OmniAPIError) in _ = try await client.retryActionRun(run.id, thread: thread) } }
              }
            }
          }
        }
        .padding(.horizontal, z(10))
        .padding(.bottom, z(12))
      }
    }
  }

  private func stop(_ run: ActionRun) async {
    await call(run.id) { () async throws(OmniAPIError) in _ = try await client.stopActionRun(run.id, thread: thread) }
  }

  private func call(_ key: String, _ request: () async throws(OmniAPIError) -> Void) async {
    busy.insert(key)
    refusal = nil
    do {
      try await request()
    } catch {
      refusal = error.message
    }
    busy.remove(key)
    await load()
  }

  private func load() async {
    defer { loads += 1 }
    do {
      result = .success(try await client.threadActions(thread))
    } catch {
      // Keep the runs on screen when a poll fails; say so only when there is nothing else to show.
      if case .success = result { return }
      result = .failure(error)
    }
  }
}

/// A quiet line on the surface: why nothing can run now.
private struct Note: View {
  let text: String

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: z(8)) {
      OmniIcon(name: "info", size: 13).foregroundStyle(Tok.fg3)
      Text(text)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
    .font(.omni(size: 12.5))
    .foregroundStyle(Tok.fg2)
    .padding(.horizontal, z(14))
    .padding(.vertical, z(10))
    .background(Tok.surface2, in: RoundedRectangle(cornerRadius: z(14), style: .continuous))
  }
}

private struct ActionRow: View {
  let action: ChannelAction
  let running: ActionRun?
  let blocked: Bool
  let busy: Set<String>
  let run: () -> Void
  let stop: (ActionRun) -> Void

  var body: some View {
    HStack(spacing: z(10)) {
      VStack(alignment: .leading, spacing: z(3)) {
        Text(action.name)
          .font(.omni(size: 13, weight: .medium))
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
        Text(action.command)
          .font(.omni(size: 11.5, design: .monospaced))
          .foregroundStyle(Tok.fg3)
          .lineLimit(1)
          .truncationMode(.tail)
          .help(action.command)
        if action.port != nil {
          Text(ChannelActions.portLabel(action.port))
            .font(.omni(size: 11))
            .foregroundStyle(Tok.fg4)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if let running {
        Button { stop(running) } label: {
          HStack(spacing: z(6)) {
            if busy.contains(running.id) { Loader(size: 12) } else { OmniIcon(name: "stop", size: 12) }
            Text("Stop")
          }
        }
        .buttonStyle(.pill(.secondary, height: 28))
        .disabled(busy.contains(running.id))
        .help("Stop \(action.name)")
      } else {
        Button(action: run) {
          HStack(spacing: z(6)) {
            if busy.contains(action.id) { Loader(size: 12) } else { OmniIcon(name: "play", size: 12) }
            Text("Run")
          }
        }
        .buttonStyle(.pill(.secondary, height: 28))
        .disabled(blocked || busy.contains(action.id))
        .help("Run \(action.name) in this thread's checkout")
      }
    }
    .padding(.horizontal, z(14))
    .padding(.vertical, z(10))
    .background(Tok.surface2, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
  }
}

private struct RunCard: View {
  let run: ActionRun
  let expanded: Bool
  let blocked: Bool
  let busy: Bool
  let toggle: () -> Void
  let stop: () -> Void
  let retry: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: z(8)) {
      HStack(spacing: z(8)) {
        Button(action: toggle) {
          HStack(spacing: z(10)) {
            RunGlyph(state: run.state)
            VStack(alignment: .leading, spacing: z(2)) {
              Text(run.name)
                .font(.omni(size: 13, weight: .medium))
                .foregroundStyle(Tok.fg)
                .lineLimit(1)
              summary
                .font(.omni(size: 11.5).monospacedDigit())
                .foregroundStyle(Tok.fg3)
                .lineLimit(1)
            }
            Spacer(minLength: z(4))
            OmniIcon(name: expanded ? "chevronDown" : "chevronRight", size: 12).foregroundStyle(Tok.fg4)
          }
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(run.name), \(run.state.label)")
        .accessibilityHint(expanded ? "Hides the output" : "Shows the output")
        if run.state == .running {
          Button(action: stop) {
            if busy { Loader(size: 12) } else { Text("Stop") }
          }
          .buttonStyle(.pill(.secondary, height: 26))
          .disabled(busy)
        } else if run.actionID != nil {
          Button(action: retry) {
            if busy { Loader(size: 12) } else { Text("Retry") }
          }
          .buttonStyle(.pill(.secondary, height: 26))
          .disabled(busy || blocked)
          .help("Run \(run.name) again")
        }
      }
      if let error = run.error {
        Text(error)
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg2)
          .fixedSize(horizontal: false, vertical: true)
          .textSelection(.enabled)
      }
      if expanded {
        if let note = run.outputNote {
          Text(note).font(.omni(size: 11)).foregroundStyle(Tok.fg4)
        }
        if run.output.isEmpty {
          Text(run.state == .running ? "Waiting for output" : "No output")
            .font(.omni(size: 12))
            .foregroundStyle(Tok.fg4)
        } else {
          RunOutput(text: run.output)
        }
      }
    }
    .padding(z(12))
    .background(Tok.surface2, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
  }

  @ViewBuilder private var summary: some View {
    if run.state == .running {
      TimelineView(.periodic(from: .now, by: 1)) { context in
        Text(run.summary(now: context.date))
      }
    } else {
      Text(run.summary())
    }
  }
}

/// Status is the only colour: a running run turns ultramarine, a failed one is the vermilion diamond, a succeeded one
/// the volt disc, a stopped one settles grey.
private struct RunGlyph: View {
  let state: ActionRunState

  var body: some View {
    Group {
      switch state {
      case .running: Loader(size: 11, color: Tok.live)
      case .failed: GlyphView(glyph: .needs, size: 8)
      case .succeeded: GlyphView(glyph: .done, size: 8)
      default: GlyphView(glyph: .settled, size: 8)
      }
    }
    .frame(width: z(12), height: z(12))
    .help(state.label)
  }
}

/// The run's bounded output, selectable, scrolled to its end where a failure says why.
private struct RunOutput: View {
  let text: String

  var body: some View {
    let body = Text(text)
      .font(.omni(size: ThreadStyle.mono, design: .monospaced))
      .lineSpacing(3)
      .foregroundStyle(Tok.fg2)
      .textSelection(.enabled)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, z(12))
      .padding(.vertical, z(10))
    Group {
      if Format.isTall(text) {
        ScrollView { body }
          .defaultScrollAnchor(.bottom)
          .frame(height: z(280))
      } else {
        body
      }
    }
    .background(ThreadStyle.code, in: RoundedRectangle(cornerRadius: z(12), style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: z(12), style: .continuous).strokeBorder(ThreadStyle.line))
  }
}
