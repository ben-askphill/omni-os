import OmniKit
import SwiftUI

/// The Automations page, like the Web UI's. There is no create or edit: automations are YAML files, read
/// again when they change. A new model per client and per visit.
struct AutomationsView: View {
  let model: AppModel
  @State private var automations: AutomationsModel?

  var body: some View {
    Group {
      if let automations {
        AutomationsList(model: model, automations: automations)
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .task(id: model.client.baseURL) {
      automations?.stop()
      let automations = AutomationsModel(client: model.client)
      automations.recentChanged(model.store.recent)
      self.automations = automations
      await automations.load()
    }
    .onChange(of: model.store.recent) { _, recent in automations?.recentChanged(recent) }
    .onChange(of: model.store.connection) { _, connection in
      if connection == .open { automations?.scheduleReload() }
    }
    .onDisappear { automations?.stop() }
  }
}

struct AutomationsList: View {
  let model: AppModel
  let automations: AutomationsModel

  var body: some View {
    Form {
      Section {
        Label {
          Text("Scheduled prompts. Each run becomes a thread in its channel. Definitions live in \(Text("automations/*.yaml").monospaced()) and reload on save.")
        } icon: {
          Image(systemName: "bolt")
        }
        .foregroundStyle(.secondary)
      }
      content
    }
    .formStyle(.grouped)
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        if automations.isRefreshing && automations.loadState == .loaded {
          ProgressView().controlSize(.small)
        } else {
          Button("Refresh", systemImage: "arrow.clockwise") { Task { await automations.load() } }
            .help("Refresh")
        }
      }
    }
  }

  @ViewBuilder private var content: some View {
    switch automations.loadState {
    case .loading:
      Section {
        HStack {
          ProgressView().controlSize(.small)
          Text("Loading").foregroundStyle(.secondary)
        }
      }
    case .failed(let message):
      Section {
        HStack(alignment: .firstTextBaseline) {
          Label(message, systemImage: "exclamationmark.triangle")
            .foregroundStyle(.red)
          Spacer()
          Button("Retry") { Task { await automations.load() } }
        }
      }
    case .loaded where automations.automations.isEmpty:
      Section {
        ContentUnavailableView {
          Label("No automations yet", systemImage: "clock")
        } description: {
          Text("Add a YAML file to \(Text("automations/").monospaced()) with name, cron, channel and prompt. It shows up here right away.")
        }
        .frame(maxWidth: .infinity)
      }
    case .loaded:
      ForEach(automations.automations) { a in
        AutomationSection(model: model, automations: automations, automation: a)
      }
    }
  }
}

struct AutomationSection: View {
  let model: AppModel
  let automations: AutomationsModel
  let automation: Automation

  private var enabled: Bool { automations.isEnabled(automation) }

  var body: some View {
    Section {
      header
      if let note = automation.errorNote {
        Label(note, systemImage: "exclamationmark.triangle")
          .foregroundStyle(.red)
          .textSelection(.enabled)
      }
      if let error = automations.errors[automation.id] {
        Label(error, systemImage: "exclamationmark.triangle")
          .foregroundStyle(.red)
      }
      DisclosureGroup("Prompt") {
        Text(automation.prompt.isEmpty ? "(empty)" : automation.prompt)
          .font(.callout.monospaced())
          .foregroundStyle(.secondary)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      runs
    }
  }

  private var header: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: "bolt.fill")
        .font(.callout)
        .foregroundStyle(enabled && automation.error == nil ? .primary : .tertiary)
        .frame(width: 30, height: 30)
        .background(.quaternary.opacity(0.6), in: Circle())
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 8) {
          Text(automation.name).font(.headline)
          if let badge = automation.badge(enabled: enabled) { Badge(badge: badge) }
        }
        details
        if automation.nextRun(enabled: enabled) != nil {
          TimelineView(.everyMinute) { context in
            if let next = automation.nextRun(enabled: enabled, now: context.date) {
              Text("Next run \(Text(next.when).foregroundStyle(.primary).fontWeight(.medium))\(next.zone.map { " (\($0))" } ?? "")")
                .font(.callout)
                .foregroundStyle(.secondary)
            }
          }
        }
      }
      Spacer(minLength: 8)
      HStack(spacing: 10) {
        Button {
          Task {
            if let id = await automations.runNow(automation) { model.route = .thread(id: id) }
          }
        } label: {
          if automations.starting.contains(automation.id) {
            HStack(spacing: 6) {
              ProgressView().controlSize(.mini)
              Text("Run now")
            }
          } else {
            Label("Run now", systemImage: "play.fill")
          }
        }
        .disabled(!automations.canRun(automation))
        Toggle(enabled ? "Pause automation" : "Enable automation", isOn: Binding {
          enabled
        } set: { on in
          Task { await automations.setEnabled(on, for: automation) }
        })
        .toggleStyle(.switch)
        .labelsHidden()
        .disabled(!automations.canToggle(automation))
        .help(enabled ? "Pause automation" : "Enable automation")
      }
    }
    .padding(.vertical, 2)
  }

  private var details: some View {
    FlowRow(spacing: 6, lineSpacing: 6) {
      Label(automation.schedule, systemImage: "clock")
        .chip()
        .help(automation.scheduleHelp)
      Text(automation.cron)
        .font(.caption.monospaced())
        .foregroundStyle(.tertiary)
        .padding(.horizontal, 7)
        .frame(height: 20)
        .overlay(Capsule().strokeBorder(.separator))
      Button("#\(model.store.channel(automation.channel)?.name ?? automation.channel)") {
        model.route = .channel(id: automation.channel)
      }
      .buttonStyle(.plain)
      .chip()
      .help("Open the channel")
      if let role = automation.role { Text(role).chip() }
      if let m = automation.model { Text(m).monospacedDigit().chip() }
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }

  @ViewBuilder private var runs: some View {
    HStack(spacing: 10) {
      Text("Last runs").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
      RunStrip(automation: automation)
    }
    if automation.runs.isEmpty {
      Text("Never run.").foregroundStyle(.tertiary)
    } else {
      ForEach(Array(automation.runs.enumerated()), id: \.offset) { _, run in
        RunRow(run: run) { id in model.route = .thread(id: id) }
      }
    }
  }
}

private struct Badge: View {
  let badge: AutomationBadge

  var body: some View {
    switch badge {
    case .paused:
      Text(badge.title)
        .font(.caption.weight(.medium))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 7)
        .frame(height: 18)
        .overlay(Capsule().strokeBorder(.separator))
    case .invalid:
      Text(badge.title)
        .font(.caption.weight(.medium))
        .foregroundStyle(.red)
        .padding(.horizontal, 7)
        .frame(height: 18)
        .background(.red.opacity(0.14), in: Capsule())
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
      Button { open(id) } label: { content.contentShape(Rectangle()) }
        .buttonStyle(.plain)
        .help("Open the thread")
    } else {
      content.foregroundStyle(.secondary)
    }
  }

  private var content: some View {
    HStack(spacing: 10) {
      Group {
        if run.dotIsHollow {
          Circle().strokeBorder(runColor(run.dotStatus), lineWidth: 1.5)
        } else {
          Circle().fill(runColor(run.dotStatus))
        }
      }
      .frame(width: 7, height: 7)
      Text(run.label).lineLimit(1).truncationMode(.tail)
      Spacer(minLength: 8)
      if run.isManual {
        Text("manual").font(.caption).foregroundStyle(.tertiary)
      }
      TimelineView(.everyMinute) { context in
        Text(RelTime.label(run.createdAt, now: context.date))
          .font(.callout.monospacedDigit())
          .foregroundStyle(.secondary)
      }
      .help(run.createdAt.formatted(date: .complete, time: .standard))
    }
  }
}

/// RUN_TONE in the Web UI's Automations page.
private func runColor(_ status: ThreadStatus?) -> Color {
  switch status {
  case .done?: .green
  case .failed?: .red
  case .stopped?: .orange
  case .running?: .blue
  case .queued?: .secondary
  default: Color(nsColor: .quaternaryLabelColor)
  }
}

private extension View {
  func chip() -> some View {
    padding(.horizontal, 8)
      .frame(height: 20)
      .background(.quaternary.opacity(0.6), in: Capsule())
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
