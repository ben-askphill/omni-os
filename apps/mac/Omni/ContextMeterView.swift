import OmniKit
import SwiftUI

/// The context meter in the thread header, as ContextMeter.tsx: a ring that fills as the thread's window
/// does, with used, window and percent on hover. A click opens what fills the window and a Compact action.
struct ContextMeterButton: View {
  let model: AppModel
  let store: ThreadStore
  let thread: OmniThread
  @State private var meter: ContextModel
  @State private var open = false

  init(model: AppModel, store: ThreadStore, thread: OmniThread) {
    self.model = model
    self.store = store
    self.thread = thread
    _meter = State(initialValue: ContextModel(threadID: thread.id, api: model.client))
  }

  private var busy: Bool { thread.status.isActive }

  var body: some View {
    let context = meter.context(pushed: store.context)
    let percent = context?.percent
    let tip = context.map { "Context: \($0.summary). Click for details." } ?? "Context: no reading yet. Click for details."
    Button {
      open.toggle()
      if open { Task { await meter.load(refresh: true) } }
    } label: {
      HStack(spacing: z(6)) {
        ContextRing(percent: percent)
        if let percent {
          Text("\(Int(percent.rounded()))%")
            .font(.omni(size: 11.5))
            .monospacedDigit()
            .foregroundStyle(ContextRing.text(ContextMeter.level(percent)))
        }
      }
      .padding(.horizontal, z(6))
      .frame(height: z(28))
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .help(tip)
    .accessibilityLabel(tip)
    .accessibilityValue(percent.map { "\(Int($0.rounded())) percent" } ?? "unknown")
    .popover(isPresented: $open, arrowEdge: .bottom) {
      ContextPanel(meter: meter, store: store, thread: thread, context: meter.context(pushed: store.context))
    }
    #if DEBUG
    .onAppear { QAProbe.openMeter = { open = true; Task { await meter.load(refresh: true) } } }
    .onDisappear { QAProbe.openMeter = nil }
    #endif
    // On open, and whenever a turn ends: the compact state and the biggest results move with it.
    .task(id: busy) {
      guard !busy else { return }
      if meter.compacting { await meter.turnEnded() } else { await meter.load() }
    }
  }
}

/// A donut that fills with the thread's context. `percent` nil draws a dashed, unknown ring.
struct ContextRing: View {
  let percent: Double?
  var size: CGFloat = 18

  static func stroke(_ level: ContextMeter.Level) -> Color {
    switch level {
    case .ok: Tok.fg3
    case .warn: Tok.warn
    case .critical: Tok.needs
    }
  }

  static func text(_ level: ContextMeter.Level) -> Color {
    level == .ok ? Tok.fg3 : stroke(level)
  }

  var body: some View {
    let width = z(size) * 2.5 / 18
    ZStack {
      Circle()
        .inset(by: width / 2)
        .stroke(Tok.lineStrong, style: StrokeStyle(lineWidth: width, dash: percent == nil ? [2, 2.5] : []))
      if let percent {
        // A sliver always shows once anything is in use, so a fresh thread still reads as a meter.
        Circle()
          .inset(by: width / 2)
          .trim(from: 0, to: max(percent, 2) / 100)
          .stroke(Self.stroke(ContextMeter.level(percent)), style: StrokeStyle(lineWidth: width, lineCap: .round))
          .rotationEffect(.degrees(-90))
          .animation(.easeOut(duration: 0.5), value: percent)
      }
    }
    .frame(width: z(size), height: z(size))
    .accessibilityHidden(true)
  }
}

private struct ContextPanel: View {
  let meter: ContextModel
  let store: ThreadStore
  let thread: OmniThread
  let context: ContextUsage?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          headline
          details
        }
        .padding(.horizontal, z(14))
        .padding(.top, z(12))
        .padding(.bottom, z(8))
      }
      .frame(maxHeight: z(520))
      .fixedSize(horizontal: false, vertical: true)
      Rectangle().fill(Tok.line).frame(height: 1)
      CompactAction(meter: meter, busy: thread.status.isActive) { store.merge($0, isReply: true) }
    }
    .frame(width: z(380))
    .background(Tok.elev)
  }

  private var headline: some View {
    let percent = context?.percent
    let level = ContextMeter.level(percent)
    return HStack(alignment: .top, spacing: z(12)) {
      ContextRing(percent: percent, size: 40)
      VStack(alignment: .leading, spacing: z(3)) {
        HStack(alignment: .firstTextBaseline, spacing: z(8)) {
          Text(percent.map { "\(Int($0.rounded()))%" } ?? "?")
            .font(.omni(size: 20))
            .monospacedDigit()
            .foregroundStyle(level == .ok ? Tok.fg : ContextRing.stroke(level))
          Text("of the context window")
            .font(.omni(size: 12))
            .foregroundStyle(Tok.fg3)
        }
        Text(amount)
          .font(.omni(size: 12))
          .monospacedDigit()
          .foregroundStyle(Tok.fg3)
        if let model = context?.model {
          Text(model)
            .font(.omni(size: 11.5))
            .foregroundStyle(Tok.fg4)
            .lineLimit(1)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      Button {
        Task { await meter.load(refresh: true) }
      } label: {
        OmniIcon(name: "refresh", size: 14)
          .rotationEffect(.degrees(meter.refreshing ? 360 : 0))
          .animation(meter.refreshing ? .linear(duration: 0.8).repeatForever(autoreverses: false) : .default, value: meter.refreshing)
      }
      .buttonStyle(.icon(size: 28))
      .disabled(meter.refreshing)
      .help("Refresh")
      .accessibilityLabel("Refresh")
    }
  }

  private var amount: String {
    guard let context else { return "No reading yet" }
    guard let max = context.max else { return "\(ContextMeter.formatTokens(context.used)) tokens, window unknown" }
    return "\(ContextMeter.formatTokens(context.used)) of \(ContextMeter.formatTokens(max)) tokens"
  }

  @ViewBuilder private var details: some View {
    let scale = context?.max ?? context?.used ?? 1
    if let context, let at = context.autoCompactAt, let max = context.max {
      Text("Autocompact starts at \(ContextMeter.formatTokens(at)) (\(Int((at / max * 100).rounded()))%)."
        + (context.modelWindow.map { " The model allows \(ContextMeter.formatTokens($0))." } ?? ""))
        .font(.omni(size: 11.5))
        .foregroundStyle(Tok.fg3)
        .padding(.top, z(8))
    }
    if context == nil {
      Text("The meter fills once the agent has run a turn in this thread.")
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg3)
        .padding(.top, z(12))
    }
    if let context, !context.usedCategories.isEmpty {
      PanelSection(title: "What fills it", note: "approximate") {
        ForEach(context.usedCategories, id: \.name) { TokenBar(label: $0.name, tokens: $0.tokens, of: scale) }
        ForEach(context.roomCategories, id: \.name) { TokenBar(label: $0.name, tokens: $0.tokens, of: scale, faint: true) }
      }
    }
    if let context, !context.topTools.isEmpty {
      PanelSection(title: "Tool calls and results, by tool", note: "approximate") {
        ForEach(context.topTools, id: \.name) { TokenBar(label: ContextMeter.shortTool($0.name), help: $0.name, tokens: $0.tokens, of: scale) }
      }
    }
    if let largest = meter.view?.largest, !largest.isEmpty {
      PanelSection(title: "Largest tool results", note: "approximate") {
        ForEach(Array(largest.enumerated()), id: \.offset) { _, r in
          HStack(alignment: .firstTextBaseline, spacing: z(8)) {
            Text(ContextMeter.shortTool(r.tool)).foregroundStyle(Tok.fg2).fixedSize()
            PathText(text: ContextMeter.shortPath(r.label, cwd: store.cwd), full: r.label, color: Tok.fg4)
            Text(ContextMeter.formatTokens(r.tokens)).monospacedDigit().foregroundStyle(Tok.fg3).fixedSize()
          }
          .font(.omni(size: 12))
          .padding(.vertical, z(3))
        }
      }
    }
    if let files = context?.memoryFiles, !files.isEmpty {
      PanelSection(title: "Memory files") {
        ForEach(files, id: \.path) { m in
          HStack(alignment: .firstTextBaseline, spacing: z(8)) {
            PathText(text: ContextMeter.shortPath(m.path, cwd: store.cwd), full: m.path, color: Tok.fg3)
            Text(ContextMeter.formatTokens(m.tokens)).monospacedDigit().foregroundStyle(Tok.fg3).fixedSize()
          }
          .font(.omni(size: 12))
          .padding(.vertical, z(3))
        }
      }
    }
    if let context {
      Text("\(context.sourceNote) Updated \(Format.relTime(context.updatedAt)).")
        .font(.omni(size: 11))
        .foregroundStyle(Tok.fg4)
        .padding(.top, z(12))
    }
  }
}

/// A path that loses its start, not its end, when it does not fit: its file name is the useful part.
private struct PathText: View {
  let text: String
  let full: String
  let color: Color

  var body: some View {
    Text(text)
      .font(.omni(size: 11, design: .monospaced))
      .foregroundStyle(color)
      .lineLimit(1)
      .truncationMode(full.hasPrefix("/") || full.hasPrefix("~") || full.hasPrefix("…") ? .head : .tail)
      .frame(maxWidth: .infinity, alignment: .leading)
      .help(full)
  }
}

private struct PanelSection<Content: View>: View {
  let title: String
  var note: String?
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .firstTextBaseline, spacing: z(6)) {
        Text(title.uppercased())
          .font(.omni(size: 10.5, weight: .medium))
          .tracking(0.6)
          .foregroundStyle(Tok.fg3)
        if let note {
          Text(note).font(.omni(size: 10.5)).foregroundStyle(Tok.fg4)
        }
      }
      .padding(.bottom, z(4))
      content
    }
    .padding(.top, z(14))
  }
}

private struct TokenBar: View {
  let label: String
  var help: String?
  let tokens: Double
  let of: Double
  var faint = false

  var body: some View {
    let share = min(1, max(0.006, tokens / max(of, 1)))
    VStack(alignment: .leading, spacing: z(3)) {
      HStack(alignment: .firstTextBaseline, spacing: z(8)) {
        Text(label)
          .foregroundStyle(faint ? Tok.fg4 : Tok.fg2)
          .lineLimit(1)
          .frame(maxWidth: .infinity, alignment: .leading)
        Text(ContextMeter.formatTokens(tokens)).monospacedDigit().foregroundStyle(Tok.fg3)
      }
      .font(.omni(size: 12))
      Capsule()
        .fill(Tok.wash)
        .frame(height: 3)
        .overlay(alignment: .leading) {
          GeometryReader { g in
            Capsule().fill(faint ? Tok.lineStrong : Tok.fg3).frame(width: g.size.width * share)
          }
        }
    }
    .padding(.vertical, z(3))
    .help(help ?? label)
  }
}

/// Compact, with an optional focus line for Claude Code. Asks first; off with a reason while it can't run.
private struct CompactAction: View {
  let meter: ContextModel
  let busy: Bool
  /// The thread the server answered with, queued for the compaction.
  let compacted: (OmniThread) -> Void
  @State private var asking = false
  @State private var focus = ""

  var body: some View {
    let blocked = meter.compactBlocked(busy: busy)
    VStack(alignment: .leading, spacing: z(8)) {
      if meter.compacting && busy {
        HStack(spacing: z(8)) {
          GlyphView(glyph: .running, size: 6)
          Text("Compacting. The meter refreshes when it finishes.")
        }
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg2)
      } else if asking {
        Text("Compact this thread? The agent replaces the conversation so far with a summary. Files and the transcript here stay as they are.")
          .font(.omni(size: 12.5))
          .foregroundStyle(Tok.fg2)
          .fixedSize(horizontal: false, vertical: true)
        if meter.view?.compact.focus == true {
          TextField("Optional: what the summary should keep", text: $focus)
            .textFieldStyle(.omni)
            .onSubmit { Task { await run() } }
        }
        HStack(spacing: z(6)) {
          Spacer()
          Button("Cancel") { asking = false }
            .buttonStyle(.pill(.ghost, height: 28))
            .disabled(meter.sending)
          Button(meter.sending ? "Compacting" : "Compact now") { Task { await run() } }
            .buttonStyle(.pill(.primary, height: 28))
            .disabled(meter.sending)
            .keyboardShortcut(.defaultAction)
        }
      } else {
        HStack(spacing: z(8)) {
          Text(blocked ?? "Summarize the conversation to free up room.")
            .font(.omni(size: 11.5))
            .foregroundStyle(Tok.fg4)
            .frame(maxWidth: .infinity, alignment: .leading)
          Button {
            asking = true
          } label: {
            HStack(spacing: z(6)) {
              OmniIcon(name: "layers", size: 13)
              Text("Compact")
            }
          }
          .buttonStyle(.pill(.secondary, height: 28))
          .disabled(blocked != nil)
          .help(blocked ?? "Compact this thread")
        }
      }
      if let error = meter.error {
        ErrorNote(text: error.message)
      }
    }
    .padding(.horizontal, z(14))
    .padding(.top, z(10))
    .padding(.bottom, z(12))
  }

  private func run() async {
    if let t = await meter.compact(focus: focus) {
      compacted(t)
      asking = false
      focus = ""
    }
  }
}
