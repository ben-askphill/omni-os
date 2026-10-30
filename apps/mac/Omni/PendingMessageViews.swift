import OmniKit
import SwiftUI

/// Messages and crew reports the agent has not read yet, under the live output, as QueuedMessages in
/// Transcript.tsx. Ben's own queued and held ones can be edited, moved and removed until the runner sends them,
/// and a held one steered into the running turn (`PendingEditsModel`).
struct QueuedMessagesView: View {
  let store: ThreadStore
  let client: OmniClient
  let items: [PendingMsg]
  let starting: Bool
  /// The thread's worktree is not ready: what waits sends once it is (SetupCard).
  var setup: ThreadSetup? = nil
  /// The harness takes messages mid-turn, so a held one offers Steer now.
  var canSteer = false

  var body: some View {
    let lead = PendingMsg.lead(in: items, starting: starting)
    VStack(alignment: .trailing, spacing: z(12)) {
      ForEach(Array(items.enumerated()), id: \.element.id) { i, m in
        if m.kind == "crew_report" {
          IconLabel(m.label(lead: i == lead), icon: m.state == .sent ? "send" : "clock", size: 12)
            .font(.omni(size: 12))
            .foregroundStyle(Tok.fg3)
            .frame(maxWidth: .infinity, alignment: .leading)
        } else if m.isEditable {
          PendingRow(store: store, client: client, m: m, label: m.label(lead: false, setup: setup), icon: "clock", canSteer: canSteer) { EmptyView() }
        } else {
          PendingBubble(m: m, label: m.label(lead: i == lead, setup: setup), icon: m.state == .sent ? "send" : "clock", threadID: store.id, client: client)
        }
      }
      if let error = store.edits.error {
        ErrorNote(text: error)
      }
    }
    .padding(.top, z(4))
  }
}

/// Ben's replies still on their way to the server, with the files he picked, until it lists them (`SendingModel`).
struct SendingMessagesView: View {
  let store: ThreadStore
  let client: OmniClient

  var body: some View {
    let items = store.sending.shown(besides: store.pending)
    if !items.isEmpty {
      VStack(alignment: .trailing, spacing: z(12)) {
        ForEach(items) { m in
          PendingBubble(text: m.text, attachments: m.attachments, context: nil, label: "Sending", icon: "send", threadID: store.id, client: client, local: true)
        }
      }
      .padding(.top, z(4))
    }
  }
}

/// A message the agent has not read: the line over it, its files and its dashed bubble.
struct PendingBubble: View {
  let text: String
  let attachments: [Attachment]
  let context: MessageContextList?
  let label: String
  let icon: String
  let threadID: String
  let client: OmniClient
  /// The files are still on this Mac (`SendingModel`).
  var local = false

  init(m: PendingMsg, label: String, icon: String, threadID: String, client: OmniClient) {
    self.init(text: m.text, attachments: m.attachments ?? [], context: m.context, label: label, icon: icon, threadID: threadID, client: client)
  }

  init(text: String, attachments: [Attachment], context: MessageContextList?, label: String, icon: String, threadID: String, client: OmniClient, local: Bool = false) {
    self.text = text
    self.attachments = attachments
    self.context = context
    self.label = label
    self.icon = icon
    self.threadID = threadID
    self.client = client
    self.local = local
  }

  var body: some View {
    VStack(alignment: .trailing, spacing: z(4)) {
      IconLabel(label, icon: icon, size: 12)
        .font(.omni(size: 11.5, weight: .medium))
        .foregroundStyle(Tok.fg3)
      if !attachments.isEmpty {
        AttachmentsView(threadID: threadID, items: attachments, client: client, local: local)
      }
      if let context, !context.isEmpty {
        MessageContextChips(readings: ContextReading.read(context, kinds: contextKinds))
      }
      if !text.isEmpty || context?.isEmpty != false {
        Text(text)
          .font(.omni(size: ThreadStyle.prose))
          .lineSpacing(5)
          .foregroundStyle(Tok.fg)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, z(16))
          .padding(.vertical, z(10))
          .background(
            UnevenRoundedRectangle(
              topLeadingRadius: 22, bottomLeadingRadius: 22, bottomTrailingRadius: 22, topTrailingRadius: 8, style: .continuous)
              .strokeBorder(Tok.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
          )
          .frame(maxWidth: z(600), alignment: .trailing)
      }
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
    .opacity(0.7)
  }
}

/// One of Ben's unsent messages: its bubble with up, down, Edit and Remove under it (and Steer now under a held
/// one), or the edit box while he edits it. `extra` goes before the actions (Send again on an uncertain one).
struct PendingRow<Extra: View>: View {
  let store: ThreadStore
  let client: OmniClient
  let m: PendingMsg
  let label: String
  let icon: String
  var canSteer = false
  @ViewBuilder let extra: Extra

  var body: some View {
    let edits = store.edits
    if let d = edits.draft(for: m.uuid) {
      PendingEditBox(store: store, client: client, m: m, draft: d, label: label)
    } else {
      VStack(alignment: .trailing, spacing: z(6)) {
        PendingBubble(m: m, label: label, icon: icon, threadID: store.id, client: client)
        HStack(spacing: z(4)) {
          extra
          let off = edits.busy != nil
          Button { move(-1) } label: { OmniIcon(name: "arrowUp", size: 14) }
            .buttonStyle(.icon(size: 28))
            .help("Move up")
            .accessibilityLabel("Move up")
            .disabled(off || !PendingOrder.canMove(store.pending, uuid: m.uuid, step: -1))
          Button { move(1) } label: { OmniIcon(name: "arrowDown", size: 14) }
            .buttonStyle(.icon(size: 28))
            .help("Move down")
            .accessibilityLabel("Move down")
            .disabled(off || !PendingOrder.canMove(store.pending, uuid: m.uuid, step: 1))
          Button { edits.open(m) } label: { PendingLabel(text: "Edit", icon: "pencil", busy: false) }
            .buttonStyle(.pill(.ghost, height: 28))
            .help("Edit this message before it is sent")
            .disabled(off)
          Button {
            Task { if let a = await edits.remove(m, using: client) { store.apply(recovery: a) } }
          } label: {
            PendingLabel(text: "Remove", icon: "trash", busy: edits.busy == "remove:\(m.uuid)")
          }
          .buttonStyle(.pill(.ghost, height: 28))
          .help("Take it out of the queue. It is never sent.")
          .disabled(off)
          if canSteer && m.canSteerNow {
            Button {
              Task { if let a = await edits.steer(m, using: client) { store.apply(recovery: a) } }
            } label: {
              PendingLabel(text: "Steer now", icon: "send", busy: edits.busy == "steer:\(m.uuid)")
            }
            .buttonStyle(.pill(.ghost, height: 28))
            .help("Send it into this turn now. The agent reads it at its next step.")
            .disabled(off)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .trailing)
    }
  }

  private func move(_ step: Int) {
    let items = store.pending
    Task { if let a = await store.edits.move(m, step: step, in: items, using: client) { store.apply(recovery: a) } }
  }
}

/// An icon and a word, or a spinner in place of the icon while it runs.
struct PendingLabel: View {
  let text: String
  let icon: String
  let busy: Bool

  var body: some View {
    HStack(spacing: z(6)) {
      if busy { Loader(size: 12) } else { OmniIcon(name: icon, size: 13) }
      Text(text)
    }
  }
}

/// One unsent message being edited, in place of its bubble. The reply box's draft is untouched.
struct PendingEditBox: View {
  let store: ThreadStore
  let client: OmniClient
  let m: PendingMsg
  let draft: PendingEditDraft
  let label: String
  @State private var text = ""
  @State private var picking = false

  var body: some View {
    let saving = draft.status == .saving
    let kept = (m.attachments ?? []).filter { draft.keep.contains($0.name) }
    VStack(alignment: .trailing, spacing: z(6)) {
      IconLabel("Editing · \(label)", icon: "pencil", size: 12)
        .font(.omni(size: 11.5, weight: .medium))
        .foregroundStyle(Tok.fg3)
      VStack(alignment: .leading, spacing: z(8)) {
        OmniTextEditor(text: $text, minHeight: 64)
          .disabled(saving)
          .accessibilityLabel("Edit queued message")
          .onAppear { text = draft.prompt }
          .onChange(of: text) { _, t in store.edits.update(m.uuid) { $0.prompt = t } }
        // An edit changes the text and files only: the records show as they will be sent.
        if let context = m.context, !context.isEmpty {
          MessageContextChips(readings: ContextReading.read(context, kinds: contextKinds), alignment: .leading)
        }
        if !kept.isEmpty || !draft.added.isEmpty {
          HStack(spacing: z(6)) {
            ForEach(kept, id: \.name) { f in
              chip(f.name, size: f.size) { store.edits.update(m.uuid) { $0.keep.removeAll { $0 == f.name } } }
            }
            ForEach(draft.added) { f in
              chip(f.name, size: f.size) { store.edits.update(m.uuid) { $0.added.removeAll { $0 == f } } }
            }
          }
        }
        HStack(spacing: z(6)) {
          Button { picking = true } label: { OmniIcon(name: "paperclip", size: 15) }
            .buttonStyle(.icon(size: 28))
            .help("Attach files")
            .accessibilityLabel("Attach files")
            .disabled(saving)
          Spacer(minLength: 0)
          Button("Cancel") { store.edits.close(m.uuid) }
            .buttonStyle(.pill(.ghost, height: 28))
            .keyboardShortcut(.cancelAction)
            .disabled(saving)
          Button {
            Task { if let a = await store.edits.save(m.uuid, using: client) { store.apply(edit: a) } }
          } label: {
            PendingLabel(text: "Save", icon: "check", busy: saving)
          }
          .buttonStyle(.pill(.primary, height: 28))
          .keyboardShortcut(.return, modifiers: .command)
          .disabled(saving || !draft.canSave)
        }
      }
      .padding(z(10))
      .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(18), style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: z(18), style: .continuous).strokeBorder(Tok.lineStrong))
      .frame(maxWidth: z(600))
      if let error = draft.error {
        Text(error).font(.omni(size: 12)).foregroundStyle(Tok.needs)
      }
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
    .fileImporter(isPresented: $picking, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
      if case .success(let urls) = result { store.edits.addFiles(m.uuid, urls.compactMap(StagedFile.at)) }
    }
  }

  private func chip(_ name: String, size: Int, remove: @escaping () -> Void) -> some View {
    HStack(spacing: z(6)) {
      OmniIcon(name: "file", size: 13).foregroundStyle(Tok.fg3)
      Text(name).font(.omni(size: 12, weight: .medium)).foregroundStyle(Tok.fg2).lineLimit(1).truncationMode(.middle)
      Text(Format.bytes(size)).font(.omni(size: 10.5)).foregroundStyle(Tok.fg4).monospacedDigit()
      Button(action: remove) { OmniIcon(name: "x", size: 12) }
        .buttonStyle(.icon(size: 22))
        .help("Remove \(name)")
        .accessibilityLabel("Remove \(name)")
    }
    .padding(.leading, z(10))
    .padding(.trailing, z(2))
    .frame(height: z(30))
    .background(Tok.surface2, in: Capsule())
  }
}

/// Edits whose message was sent before they were saved, with Ben's text: Copy, Send as new or Dismiss.
struct StaleEditsView: View {
  let store: ThreadStore
  let client: OmniClient

  var body: some View {
    VStack(alignment: .trailing, spacing: z(12)) {
      ForEach(store.edits.stale) { d in
        VStack(alignment: .trailing, spacing: z(6)) {
          IconLabel(d.error ?? PendingEditDraft.staleNote, icon: "alert", size: 12)
            .font(.omni(size: 11.5, weight: .medium))
            .foregroundStyle(Tok.needs)
          Text(d.prompt)
            .font(.omni(size: ThreadStyle.prose))
            .lineSpacing(5)
            .foregroundStyle(Tok.fg)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, z(16))
            .padding(.vertical, z(10))
            .background(Tok.surface2, in: UnevenRoundedRectangle(
              topLeadingRadius: 22, bottomLeadingRadius: 22, bottomTrailingRadius: 22, topTrailingRadius: 8, style: .continuous))
            .frame(maxWidth: z(600), alignment: .trailing)
          HStack(spacing: z(6)) {
            Button {
              Pasteboard.copy(d.prompt)
            } label: {
              PendingLabel(text: "Copy", icon: "copy", busy: false)
            }
            .buttonStyle(.pill(.ghost, height: 28))
            Button {
              Task { if let t = await store.edits.sendAsNew(d.uuid, using: client) { store.merge(t, isReply: true) } }
            } label: {
              PendingLabel(text: "Send as new", icon: "send", busy: store.edits.busy == "send:\(d.uuid)")
            }
            .buttonStyle(.pill(.secondary, height: 28))
            .disabled(store.edits.busy != nil)
            Button { store.edits.close(d.uuid) } label: { PendingLabel(text: "Dismiss", icon: "x", busy: false) }
              .buttonStyle(.pill(.ghost, height: 28))
          }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Edits that were not saved")
  }
}

/// Messages Omni accepted before it restarted, and crew reports kept for a thread Ben stopped, as ParkedMessages in
/// Transcript.tsx. A recovered one never reached the agent: Resume sends them all in the saved order. An uncertain
/// one may have, so it is only sent again when Ben says so. Ben's own can be edited, moved or removed first; none of
/// that resumes anything. A crew report or a team's go is Omni's: Discard (kept in the transcript, marked not sent)
/// instead.
struct ParkedMessagesView: View {
  let store: ThreadStore
  let client: OmniClient
  let items: [PendingMsg]
  /// The thread's worktree is not ready: they send once it is, so Retry (SetupCard) stands in for Resume.
  var setup: ThreadSetup? = nil
  @State private var busy: String?
  @State private var error: String?

  var body: some View {
    let parked = ParkedMessages(items)
    let off = busy != nil || store.edits.busy != nil
    VStack(alignment: .trailing, spacing: z(12)) {
      Rectangle().fill(Tok.line).frame(height: 1)
      HStack(spacing: z(8)) {
        Text(setup != nil ? PendingMsg.setupLabel : ParkedMessages.heading(items))
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg3)
          .frame(maxWidth: .infinity, alignment: .leading)
        if !parked.recovered.isEmpty && setup == nil {
          Button { resume("resume", ids: nil) } label: {
            PendingLabel(text: parked.recovered.count > 1 ? "Resume \(parked.recovered.count)" : "Resume", icon: "play", busy: busy == "resume")
          }
          .buttonStyle(.pill(.primary, height: 28))
          .help("Send them in the order shown")
          .disabled(off)
        }
      }
      ForEach(items) { m in
        let icon = m.delivery == .uncertain ? "alert" : "clock"
        if m.isOmnis {
          VStack(alignment: .trailing, spacing: z(6)) {
            PendingBubble(m: m, label: m.label(lead: false, setup: setup), icon: icon, threadID: store.id, client: client)
            HStack(spacing: z(4)) {
              sendAgain(m, off: off)
              Button { discard(m) } label: {
                PendingLabel(text: "Discard", icon: "trash", busy: busy == "discard:\(m.uuid)")
              }
              .buttonStyle(.pill(.ghost, height: 28))
              .help("Don't send it. It stays in the transcript, marked not sent.")
              .disabled(off)
            }
          }
        } else {
          PendingRow(store: store, client: client, m: m, label: m.label(lead: false, setup: setup), icon: icon) {
            sendAgain(m, off: off)
          }
        }
      }
      if let error {
        ErrorNote(text: error)
      }
    }
    .padding(.top, z(4))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Messages waiting since a restart")
  }

  @ViewBuilder private func sendAgain(_ m: PendingMsg, off: Bool) -> some View {
    if m.delivery == .uncertain {
      Button { resume("again:\(m.uuid)", ids: [m.uuid]) } label: {
        PendingLabel(text: "Send again", icon: "send", busy: busy == "again:\(m.uuid)")
      }
      .buttonStyle(.pill(.secondary, height: 28))
      .help("It may already have reached the agent. Send it once more.")
      .disabled(off)
    }
  }

  private func resume(_ key: String, ids: [String]?) {
    run(key) { [client] id in try await client.resumeRequests(in: id, ids: ids) }
  }

  private func discard(_ m: PendingMsg) {
    run("discard:\(m.uuid)") { [client] id in try await client.discardRequests(in: id, ids: [m.uuid]) }
  }

  private func run(_ key: String, _ call: @escaping (String) async throws -> RecoveryAnswer) {
    guard busy == nil else { return }
    busy = key
    error = nil
    let id = store.id
    Task {
      defer { busy = nil }
      do {
        store.apply(recovery: try await call(id))
      } catch let e as OmniAPIError {
        error = e.message
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
