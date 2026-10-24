import OmniKit
import SwiftUI

/// Continue with another harness: a new thread on a local harness whose first session reads a Carryover of this one
/// ahead of Ben's first message. Pick the run, read what it will be given, write the message, Start.
struct ContinueSheet: View {
  let model: AppModel
  let thread: OmniThread
  @Environment(\.dismiss) private var dismiss
  @State private var m: ContinueModel
  @State private var fetched: [HarnessInfo]?

  init(model: AppModel, thread: OmniThread) {
    self.model = model
    self.thread = thread
    _m = State(initialValue: ContinueModel(api: model.client, sourceID: thread.id))
  }

  private var harnesses: [HarnessInfo] { fetched ?? model.store.harnesses }

  var body: some View {
    VStack(alignment: .leading, spacing: z(14)) {
      header
      runPickers
      if let block = m.blocked { blockNote(block) }
      preview
        .frame(maxHeight: .infinity, alignment: .top)
      VStack(alignment: .leading, spacing: 0) {
        FieldLabel(text: "First message", hint: "Sent after the carryover, never cut.")
        OmniTextEditor(text: $m.text, minHeight: 72)
          .accessibilityLabel("First message")
        if let hint = ContinueRules.slashHint(m.text) {
          Text(hint).font(.omni(size: 12)).foregroundStyle(Tok.fg3).padding(.top, z(6))
        }
      }
      if let error = m.error { ErrorNote(text: error) }
      footer
    }
    .padding(z(24))
    .frame(width: z(620), height: z(700))
    .background(Tok.bg)
    .onChange(of: harnesses, initial: true) {
      if m.run == nil { m.run = ContinueTargets(harnesses, source: thread.harness).initial }
    }
    .task(id: m.ask) { await m.loadPreview() }
    .task { refresh() }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: z(4)) {
      Text("Continue with another harness").font(.omni(size: 17, weight: .medium)).foregroundStyle(Tok.fg)
      Text(workspaceLine)
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg3)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  private var workspaceLine: String {
    let start = "A new thread picks up from \(thread.title) in a session of its own"
    switch m.preview?.workspace {
    case .worktree?: return start + ", on a new branch and worktree made from a snapshot of this checkout."
    case .folder?: return start + ", in the channel's folder."
    default: return start + "."
    }
  }

  /// Why Start waits. A shell open in the Terminal tab is the one block Ben can clear from here; any other is checked
  /// again with Retry.
  @ViewBuilder private func blockNote(_ block: ContinueBlock) -> some View {
    if block.code == .terminal {
      HStack(spacing: z(10)) {
        ErrorNote(text: block.message)
        Button {
          Task { await m.closeTerminal() }
        } label: {
          HStack(spacing: z(6)) {
            if m.closingTerminal { Loader(size: 12) } else { OmniIcon(name: "terminal", size: 13) }
            Text("Close terminal")
          }
        }
        .buttonStyle(.pill(.secondary, height: 28))
        .disabled(m.closingTerminal || m.posting)
        .help("Close the shell in this thread's Terminal tab, then check again")
      }
    } else {
      ErrorNote(text: block.message) { Task { await m.loadPreview() } }
    }
  }

  /// Local harnesses only, without Auto. Hermes and Cursor Cloud are named under the pickers with the reason.
  private var runPickers: some View {
    let targets = ContinueTargets(harnesses, source: thread.harness)
    let run = m.run ?? Run(harness: thread.harness, model: "", effort: "")
    let disabled = m.posting ? "Starting" : nil
    return VStack(alignment: .leading, spacing: 0) {
      FieldLabel(text: "Continue on")
      HStack(spacing: z(6)) {
        ModelPickerButton(
          harnesses: targets.offered, harness: run.harness, model: m.run == nil ? "" : RunSwitch.shownModel(run, harnesses: harnesses),
          pick: { h, model in
            if let next = RunSwitch.picking(harness: h, model: model, from: run, harnesses: harnesses) { m.run = next }
          },
          refresh: refresh, offersAuto: false, disabledHelp: disabled)
        EffortMenu(
          options: EffortRules.options(for: EffortRules.model(harness: run.harness, model: run.model, in: harnesses)),
          value: run.effort, disabledHelp: disabled
        ) { e in
          if let next = RunSwitch.picking(effort: e, from: run) { m.run = next }
        }
      }
      ForEach(targets.refused) { r in
        HStack(alignment: .firstTextBaseline, spacing: z(6)) {
          OmniIcon(name: "info", size: 11)
            .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
          Text(r.reason)
        }
        .font(.omni(size: 11.5))
        .foregroundStyle(Tok.fg4)
        .padding(.top, z(6))
      }
    }
  }

  @ViewBuilder private var preview: some View {
    if let e = m.loadError {
      ErrorNote(text: e.message) { Task { await m.loadPreview() } }
    } else if let p = m.preview {
      ScrollView {
        VStack(alignment: .leading, spacing: z(14)) {
          if !p.carryover.attachments.isEmpty {
            AttachmentPicker(files: p.carryover.attachments, disabled: m.posting) { m.toggle($0) }
          }
          CarryoverSections(preview: p)
        }
        .padding(.bottom, z(4))
      }
      .opacity(m.loading ? 0.45 : 1)
      .overlay { if m.loading { Loader(size: 16, color: Tok.fg3) } }
      .animation(.easeOut(duration: 0.16), value: m.loading)
    } else if m.run == nil && !harnesses.isEmpty {
      NeedsNote(text: "No local harness is available. Install or log in to Claude Code, Codex or Cursor Agent.")
    } else {
      LoadingNote(label: "Loading the preview")
    }
  }

  private var footer: some View {
    HStack(alignment: .center, spacing: z(10)) {
      if m.changed {
        HStack(alignment: .firstTextBaseline, spacing: z(6)) {
          OmniIcon(name: "info", size: 12)
            .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
          Text("The thread changed since that preview. This is the new one.")
        }
        .font(.omni(size: 12))
        .foregroundStyle(Tok.fg3)
      }
      Spacer()
      Button("Cancel") { dismiss() }
        .buttonStyle(.pill(.ghost, height: 34))
        .keyboardShortcut(.cancelAction)
        .disabled(m.posting)
      Button {
        Task {
          guard let t = await m.start() else { return }
          dismiss()
          model.route = .thread(id: t.id)
        }
      } label: {
        HStack(spacing: z(8)) {
          if m.posting { Loader(size: 14) }
          Text("Start")
        }
      }
      .buttonStyle(.pill(.primary, height: 34))
      .keyboardShortcut(.return, modifiers: .command)
      .disabled(m.startBlocker != nil)
      .help(m.startBlocker ?? "Start the new thread")
    }
  }

  private func refresh() {
    Task {
      if let list = try? await model.client.harnesses() { fetched = list }
    }
  }
}

/// The preview of a Carryover, section by section, as the new session will read it.
private struct CarryoverSections: View {
  let preview: ContinuePreview
  @State private var showText = false

  var body: some View {
    let c = preview.carryover
    VStack(alignment: .leading, spacing: z(14)) {
      section("Goal") {
        Text(c.goal).lineLimit(6)
      }
      if !c.constraints.isEmpty {
        section("Constraints") {
          ForEach(Array(c.constraints.enumerated()), id: \.offset) { _, line in
            HStack(alignment: .firstTextBaseline, spacing: z(6)) {
              Text("•").foregroundStyle(Tok.fg4)
              Text(line)
            }
          }
        }
      }
      if let files = c.files {
        section("Changed files", count: files.total) {
          if files.listed.isEmpty { Text("None").foregroundStyle(Tok.fg3) }
          ForEach(files.listed, id: \.path) { f in
            HStack(spacing: z(8)) {
              Text(f.path).font(.omni(size: 12, design: .monospaced)).lineLimit(1).truncationMode(.middle)
              Spacer(minLength: z(4))
              Chip(text: f.status.label)
            }
            .help(f.oldPath.map { "\(f.path), from \($0)" } ?? f.path)
          }
          if files.more > 0 { Text("\(files.more) more").foregroundStyle(Tok.fg3) }
        }
      }
      if !c.checks.isEmpty {
        section("Checks") {
          ForEach(c.checks) { check in
            HStack(alignment: .firstTextBaseline, spacing: z(8)) {
              GlyphView(glyph: check.ok ? .done : .needs, size: 8)
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
              Text(check.command).font(.omni(size: 12, design: .monospaced)).lineLimit(1).truncationMode(.tail)
              Spacer(minLength: z(4))
              Text(check.ok ? "Passed" : "Failed").foregroundStyle(Tok.fg3)
            }
            .help(check.output)
          }
        }
      }
      section("Recent history", count: c.recent.count) {
        if c.recent.isEmpty { Text("None").foregroundStyle(Tok.fg3) }
        ForEach(c.recent) { e in
          HStack(alignment: .firstTextBaseline, spacing: z(8)) {
            Text(e.who.label)
              .font(.omni(size: 11.5, weight: .medium))
              .foregroundStyle(Tok.fg3)
              .frame(width: z(76), alignment: .leading)
            Text(ContinueRules.entryText(e))
              .foregroundStyle(e.condensed ? Tok.fg3 : Tok.fg)
              .lineLimit(e.condensed ? 1 : 4)
              .frame(maxWidth: .infinity, alignment: .leading)
            if e.condensed {
              Chip(text: "Shortened", tone: .outline)
                .help("Cut to its first line to fit the budget")
            }
          }
        }
      }
      if !c.omitted.isEmpty {
        section("Left out") {
          ForEach(Array(c.omitted.enumerated()), id: \.offset) { _, o in
            VStack(alignment: .leading, spacing: z(2)) {
              Text(o.note)
              if let ref = o.ref {
                Text(ref).font(.omni(size: 11.5, design: .monospaced)).foregroundStyle(Tok.fg3)
              }
            }
          }
        }
      }
      HStack(alignment: .firstTextBaseline) {
        DisclosureGroup("Show exact text", isExpanded: $showText) {
          Text(c.text)
            .font(.omni(size: 11.5, design: .monospaced))
            .foregroundStyle(Tok.fg2)
            .lineSpacing(2)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, z(12))
            .padding(.vertical, z(10))
            .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(12), style: .continuous))
            .padding(.top, z(6))
        }
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg2)
      }
      .overlay(alignment: .topTrailing) {
        Text(ContinueRules.sizeText(chars: c.chars, budget: c.budget))
          .font(.omni(size: 11.5))
          .monospacedDigit()
          .foregroundStyle(Tok.fg3)
      }
    }
    .font(.omni(size: 12.5))
    .foregroundStyle(Tok.fg)
    .textSelection(.enabled)
  }

  private func section<Content: View>(_ title: String, count: Int? = nil, @ViewBuilder _ content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: z(6)) {
      HStack {
        Text(title).omniCaption()
        Spacer()
        if let count { Text("\(count)").font(.omni(size: 11)).monospacedDigit().foregroundStyle(Tok.fg3) }
      }
      .padding(.horizontal, z(4))
      VStack(alignment: .leading, spacing: z(6)) { content() }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, z(12))
        .padding(.vertical, z(10))
        .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(14), style: .continuous))
    }
  }
}

/// The source's attachments, each with a switch: the ticked ones are copied into the new thread's own uploads folder.
/// One that cannot be copied says why and cannot be ticked.
private struct AttachmentPicker: View {
  let files: [CarryoverAttachment]
  let disabled: Bool
  let toggle: (String) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: z(6)) {
      HStack {
        Text("Attachments").omniCaption()
        Spacer()
        Text("\(files.count)").font(.omni(size: 11)).monospacedDigit().foregroundStyle(Tok.fg3)
      }
      .padding(.horizontal, z(4))
      VStack(alignment: .leading, spacing: z(10)) {
        ForEach(files) { a in
          let can = a.availability == .available
          HStack(alignment: .top, spacing: z(10)) {
            VStack(alignment: .leading, spacing: z(2)) {
              HStack(spacing: z(6)) {
                Text(a.name)
                  .foregroundStyle(can ? Tok.fg : Tok.fg3)
                  .lineLimit(1)
                  .truncationMode(.middle)
                if let tag = ContinueRules.attachmentTag(a) { Chip(text: tag, tone: .outline) }
              }
              Text(ContinueRules.attachmentMeta(a)).font(.omni(size: 11.5)).monospacedDigit().foregroundStyle(Tok.fg3)
              Text(ContinueRules.attachmentNote(a))
                .font(.omni(size: 11.5))
                .foregroundStyle(Tok.fg3)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: z(8))
            Toggle(
              "Carry \(a.name)",
              isOn: Binding(get: { a.selected && can }, set: { _ in toggle(a.id) })
            )
            .toggleStyle(.omni)
            .labelsHidden()
            .disabled(disabled || !can)
            .accessibilityLabel("Carry \(a.name)")
          }
        }
        Text(ContinueRules.attachmentsSummary(files)).font(.omni(size: 11.5)).foregroundStyle(Tok.fg3)
      }
      .font(.omni(size: 12.5))
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, z(12))
      .padding(.vertical, z(10))
      .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(14), style: .continuous))
    }
  }
}
