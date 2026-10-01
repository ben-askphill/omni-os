import OmniKit
import SwiftUI

/// The Automations page, like the Web UI's. There is no create or edit: automations are YAML files, read
/// again when they change. A new model per client and per visit.
struct AutomationsView: View {
  let model: AppModel
  @State private var automations: AutomationsModel?
  @State private var feedTicket: UUID?

  var body: some View {
    Group {
      if let automations {
        AutomationsList(model: model, automations: automations)
      } else {
        LoadingNote().padding(.horizontal, 32).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      }
    }
    .task(id: model.client.baseURL) {
      detachFeed()
      automations?.stop()
      let page = AutomationsModel(client: model.client)
      automations = page
      feedTicket = model.subscribeFeed { event in
        if case .message(let message) = event { page.feed(message) }
      }
      await page.load()
    }
    .onChange(of: model.store.feedOpens) { _, opens in
      // The first open is the initial connection. Later ones are reconnects: the Web UI reloads for
      // `e.type === 'reconnect'`, a second later. The workspace refetch on that open stays immediate.
      if opens > 1 { automations?.scheduleReload() }
    }
    .onDisappear {
      detachFeed()
      automations?.stop()
    }
  }

  private func detachFeed() {
    if let feedTicket {
      model.unsubscribeFeed(feedTicket)
      self.feedTicket = nil
    }
  }
}

struct AutomationsList: View {
  let model: AppModel
  let automations: AutomationsModel

  var body: some View {
    ScreenColumn {
      VStack(alignment: .leading, spacing: 0) {
        OmniPageHeader(
          title: "Automations",
          subtitle: "Scheduled prompts. Each run becomes a thread in its channel. Definitions live in automations/*.yaml and reload on save."
        ) {
          Button {
            Task { await automations.load() }
          } label: {
            if automations.isRefreshing && automations.loadState == .loaded {
              Loader(size: 12)
            } else {
              OmniIcon(name: "refresh", size: 14)
            }
          }
          .buttonStyle(.pill(.ghost, height: 28))
          .help("Refresh")
          .accessibilityLabel("Refresh")
        }
        .padding(.top, 40)
        .padding(.bottom, 24)
        content
      }
    }
  }

  @ViewBuilder private var content: some View {
    switch automations.loadState {
    case .loading:
      LoadingNote()
    case .failed(let message):
      ErrorNote(text: message) { Task { await automations.load() } }
    case .loaded where automations.automations.isEmpty:
      EmptyNote(symbol: "clock", title: "No automations yet",
                message: "Add a YAML file to automations/ with name, cron, channel and prompt. It shows up here right away.")
    case .loaded:
      VStack(spacing: 12) {
        ForEach(automations.automations) { a in
          AutomationSection(model: model, automations: automations, automation: a)
        }
      }
    }
  }
}

/// AutomationCard in Automations.tsx: a surface card at 24pt corners.
struct AutomationSection: View {
  let model: AppModel
  let automations: AutomationsModel
  let automation: Automation
  @State private var showPrompt = false

  private var enabled: Bool { automations.isEnabled(automation) }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header.padding(20)
      if let note = automation.errorNote {
        ErrorNote(text: note).padding(.horizontal, 20).padding(.bottom, 16)
      }
      if let error = automations.errors[automation.id] {
        ErrorNote(text: error).padding(.horizontal, 20).padding(.bottom, 16)
      }
      prompt.padding(.horizontal, 10).padding(.bottom, 4)
      runs.padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 16)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    .overlay {
      if automation.error != nil {
        RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Tok.needs.opacity(0.35))
      }
    }
  }

  private var prompt: some View {
    VStack(alignment: .leading, spacing: 4) {
      Button {
        withAnimation(Motion.settle) { showPrompt.toggle() }
      } label: {
        HStack(spacing: 6) {
          OmniIcon(name: "chevronRight", size: 12)
            .rotationEffect(.degrees(showPrompt ? 90 : 0))
          Text("Prompt")
        }
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(Tok.fg3)
        .padding(.horizontal, 10)
        .frame(height: 32)
        .hoverWash(16, fill: Tok.surface2)
      }
      .buttonStyle(.plain)
      .accessibilityValue(showPrompt ? "Expanded" : "Collapsed")
      if showPrompt {
        Text(automation.prompt.isEmpty ? "(empty)" : automation.prompt)
          .font(.system(size: 12, design: .monospaced))
          .lineSpacing(3)
          .foregroundStyle(Tok.fg2)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 14)
          .padding(.vertical, 12)
          .background(Tok.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
          .padding(.horizontal, 10)
          .padding(.bottom, 8)
      }
    }
  }

  private var header: some View {
    HStack(alignment: .top, spacing: 12) {
      OmniIcon(name: "zap", size: 16)
        .foregroundStyle(enabled && automation.error == nil ? Tok.fg : Tok.fg4)
        .frame(width: 36, height: 36)
        .background(Tok.bg, in: Circle())
        .padding(.top, 2)
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 8) {
          Text(automation.name).font(.system(size: 16, weight: .medium)).foregroundStyle(Tok.fg)
          if let badge = automation.badge(enabled: enabled) { Badge(badge: badge) }
        }
        details.padding(.top, 8)
        if automation.nextRun(enabled: enabled) != nil {
          TimelineView(.everyMinute) { context in
            if let next = automation.nextRun(enabled: enabled, now: context.date) {
              Text("Next run \(Text(next.when).foregroundStyle(Tok.fg).fontWeight(.medium))\(next.zone.map { " (\($0))" } ?? "")")
                .font(.system(size: 12.5))
                .foregroundStyle(Tok.fg3)
            }
          }
          .padding(.top, 10)
        }
      }
      Spacer(minLength: 8)
      HStack(spacing: 10) {
        Button {
          Task {
            if let id = await automations.runNow(automation) { model.route = .thread(id: id) }
          }
        } label: {
          HStack(spacing: 6) {
            if automations.starting.contains(automation.id) {
              Loader(size: 12)
            } else {
              OmniIcon(name: "play", size: 14)
            }
            Text("Run now")
          }
        }
        .buttonStyle(.pill(.secondary, height: 28))
        .disabled(!automations.canRun(automation))
        Toggle(enabled ? "Pause automation" : "Enable automation", isOn: Binding {
          enabled
        } set: { on in
          Task { await automations.setEnabled(on, for: automation) }
        })
        .toggleStyle(.omni)
        .accessibilityLabel(enabled ? "Pause automation" : "Enable automation")
        .disabled(!automations.canToggle(automation))
        .help(enabled ? "Pause automation" : "Enable automation")
      }
    }
  }

  private var details: some View {
    FlowRow(spacing: 6, lineSpacing: 6) {
      HStack(spacing: 6) {
        OmniIcon(name: "clock", size: 12).foregroundStyle(Tok.fg3)
        Text(automation.schedule)
      }
      .chip()
      .help(automation.scheduleHelp)
      Text(automation.cron)
        .font(.system(size: 11, design: .monospaced))
        .foregroundStyle(Tok.fg4)
        .padding(.horizontal, 8)
        .frame(height: 24)
        .overlay(Capsule().strokeBorder(Tok.line))
      Button("#\(model.store.channel(automation.channel)?.name ?? automation.channel)") {
        model.route = .channel(id: automation.channel)
      }
      .buttonStyle(.plain)
      .chip()
      .help("Open the channel")
      if let role = automation.role { Text(role).chip() }
      if let m = automation.model { Text(m).font(.system(size: 11)).monospacedDigit().chip() }
    }
    .font(.system(size: 12))
    .foregroundStyle(Tok.fg2)
  }

  @ViewBuilder private var runs: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 12) {
        Text("Last runs").omniCaption()
        RunStrip(automation: automation)
      }
      if automation.runs.isEmpty {
        Text("Never run.").font(.system(size: 12.5)).foregroundStyle(Tok.fg4)
      } else {
        VStack(spacing: 0) {
          ForEach(Array(automation.runs.enumerated()), id: \.offset) { _, run in
            RunRow(run: run) { id in model.route = .thread(id: id) }
          }
        }
        .padding(.horizontal, -8)
      }
    }
  }
}

private struct Badge: View {
  let badge: AutomationBadge

  var body: some View {
    switch badge {
    case .paused: Chip(text: badge.title, tone: .outline)
    case .invalid: Chip(text: badge.title, tone: .needs)
    }
  }
}

/// The last runs as bars, oldest left: a glance at reliability.
private struct RunStrip: View {
  let automation: Automation
  @State private var dim = false

  var body: some View {
    if !automation.runs.isEmpty {
      TimelineView(.everyMinute) { context in
        HStack(alignment: .bottom, spacing: 3) {
          ForEach(Array(automation.strip.enumerated()), id: \.offset) { _, run in
            Capsule()
              .fill(runColor(run.status))
              .frame(width: 5, height: run.isTall ? 14 : 10)
              .opacity(run.status == .running && dim ? 0.35 : 1)
              .help(run.stripHelp(now: context.date))
          }
        }
        .frame(height: 14, alignment: .bottom)
      }
      .accessibilityElement()
      .accessibilityLabel(automation.stripSummary)
      // A running one pulses, as in the Web UI.
      .onAppear {
        withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
      }
    }
  }
}

private struct RunRow: View {
  let run: AutomationRun
  let open: (String) -> Void

  var body: some View {
    if let id = run.threadID {
      Button { open(id) } label: { content.foregroundStyle(Tok.fg).hoverWash(16, fill: Tok.surface2) }
        .buttonStyle(.plain)
        .help("Open the thread")
    } else {
      content.foregroundStyle(Tok.fg3)
    }
  }

  private var content: some View {
    HStack(spacing: 10) {
      GlyphView(glyph: Glyph(run.dotStatus), size: 7)
      Text(run.label).lineLimit(1).truncationMode(.tail)
      Spacer(minLength: 8)
      if run.isManual {
        Text("manual").font(.system(size: 10.5)).foregroundStyle(Tok.fg4)
      }
      TimelineView(.everyMinute) { context in
        Text(RelTime.label(run.createdAt, now: context.date))
          .font(.system(size: 11).monospacedDigit())
          .foregroundStyle(Tok.fg4)
          .frame(width: 96, alignment: .trailing)
      }
      .help(run.createdAt.formatted(date: .complete, time: .standard))
    }
    .font(.system(size: 12.5))
    .padding(.horizontal, 8)
    .frame(height: 32)
  }
}

/// RUN_TONE in the Web UI's Automations page.
private func runColor(_ status: ThreadStatus?) -> Color {
  switch status {
  case .done?: Tok.done
  case .failed?: Tok.needs
  case .stopped?: Tok.fg4
  case .running?: Tok.live
  case .queued?: Tok.fg4
  default: Tok.lineStrong
  }
}

private extension View {
  func chip() -> some View {
    padding(.horizontal, 10)
      .frame(height: 24)
      .background(Tok.bg, in: Capsule())
  }
}

/// Lays its views out in rows, wrapping when the next one does not fit.
private struct FlowRow: Layout {
  var spacing: CGFloat
  var lineSpacing: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let frames = arrange(width: proposal.width ?? .infinity, subviews)
    let width = frames.map(\.maxX).max() ?? 0
    let height = frames.map(\.maxY).max() ?? 0
    return CGSize(width: width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    for (frame, view) in zip(arrange(width: bounds.width, subviews), subviews) {
      view.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), proposal: ProposedViewSize(frame.size))
    }
  }

  private func arrange(width: CGFloat, _ subviews: Subviews) -> [CGRect] {
    var frames: [CGRect] = []
    var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x > 0, x + size.width > width {
        x = 0
        y += line + lineSpacing
        line = 0
      }
      frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
      x += size.width + spacing
      line = max(line, size.height)
    }
    return frames
  }
}
