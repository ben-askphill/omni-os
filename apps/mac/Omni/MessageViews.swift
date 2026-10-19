import OmniKit
import QuickLook
import SwiftUI

/// A message from Ben or the conductor, as UserBubble in Transcript.tsx: who and how above it, attachments,
/// commands as pills that spell themselves out when clicked, and Show all for a long one.
struct UserBubbleView: View {
  let eventID: Int
  let at: Date
  let message: UserMessage
  let threadID: String
  let client: OmniClient
  let ui: TranscriptUI

  private static let pillScheme = "omni-pill"

  var body: some View {
    let long = message.isLong
    let more = ui.isOpen(moreKey)
    let pieces = message.pieces(cut: !more)
    let about = pieces.compactMap(\.hit).first { ui.isOpen(aboutKey($0.start)) }
    VStack(alignment: .trailing, spacing: z(5)) {
      header
      if let files = message.attachments, !files.isEmpty {
        AttachmentsView(threadID: threadID, items: files, client: client)
      }
      VStack(alignment: .leading, spacing: z(4)) {
        Text(Self.text(pieces, cut: long && !more))
          .font(.omni(size: ThreadStyle.prose + 0.5))
          .lineSpacing(5)
          .foregroundStyle(Tok.fg)
          .tint(Tok.fg)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
          .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == Self.pillScheme, let start = Int(url.host() ?? "") else { return .discarded }
            for hit in pieces.compactMap(\.hit) where hit.start != start { if ui.isOpen(aboutKey(hit.start)) { ui.toggle(aboutKey(hit.start)) } }
            ui.toggle(aboutKey(start))
            return .handled
          })
        if let about {
          Hairline().padding(.top, z(2))
          Text("\(about.description.isEmpty ? "No description" : about.description)\(Text(" · \(about.sourceTag)").foregroundStyle(Tok.fg4))")
            .font(.omni(size: ThreadStyle.small))
            .foregroundStyle(Tok.fg3)
            .fixedSize(horizontal: false, vertical: true)
        }
        if long {
          Button(more ? "Show less" : "Show all") { ui.toggle(moreKey) }
            .buttonStyle(.link)
            .font(.omni(size: 12, weight: .medium))
            .foregroundStyle(Tok.fg3)
            .underline()
        }
      }
      .padding(.horizontal, z(16))
      .padding(.vertical, z(10))
      .background(background)
      .frame(maxWidth: z(600), alignment: .trailing)
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
    .opacity(message.dropped == true ? 0.6 : 1)
  }

  private var moreKey: String { "b\(eventID)" }
  private func aboutKey(_ start: Int) -> String { "p\(eventID):\(start)" }

  private var header: some View {
    HStack(spacing: z(8)) {
      if let label = message.sourceLabel {
        Text(label)
          .fontWeight(.medium)
          .foregroundStyle(message.source == "conductor" ? Tok.live : Tok.fg3)
      }
      if let how = message.sendLabel {
        IconLabel(how, icon: message.mode == .interrupt ? "stop" : "send")
          .fontWeight(.medium)
          .foregroundStyle(message.mode == .interrupt ? Tok.fg2 : Tok.fg3)
      }
      if message.dropped == true {
        IconLabel("Not sent", icon: "x")
          .fontWeight(.medium)
          .foregroundStyle(Tok.fg3)
          .help("The run ended before the agent read this message")
      }
      Text(Format.clock(at))
        .font(.omni(size: 11))
        .monospacedDigit()
        .foregroundStyle(Tok.fg4)
    }
    .font(.omni(size: 11.5))
    .foregroundStyle(Tok.fg3)
  }

  @ViewBuilder private var background: some View {
    let shape = UnevenRoundedRectangle(
      topLeadingRadius: 22, bottomLeadingRadius: 22, bottomTrailingRadius: 22, topTrailingRadius: 8, style: .continuous)
    if message.dropped == true {
      shape.strokeBorder(Tok.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
    } else {
      shape.fill(ThreadStyle.bubble)
    }
  }

  private static func text(_ pieces: [SlashPiece], cut: Bool) -> AttributedString {
    var out = AttributedString()
    for piece in pieces {
      var run = AttributedString(piece.text)
      if let hit = piece.hit {
        run.font = .omni(size: ThreadStyle.prose - 1, weight: .medium, design: .monospaced)
        run.backgroundColor = Tok.surface3
        run.foregroundColor = Tok.fg
        run.link = URL(string: "\(pillScheme)://\(hit.start)")
      }
      out.append(run)
    }
    if cut { out.append(AttributedString("...")) }
    return out
  }
}

/// An OmniIcon and a word, tight, as the web's `<Icon size={11}/> Label` spans.
struct IconLabel: View {
  let title: String
  let icon: String
  var size: CGFloat = 11

  init(_ title: String, icon: String, size: CGFloat = 11) {
    self.title = title
    self.icon = icon
    self.size = size
  }

  var body: some View {
    HStack(spacing: z(4)) {
      OmniIcon(name: icon, size: size)
      Text(title)
    }
  }
}

/// Images as thumbnails, other files as chips. Either opens in Quick Look.
struct AttachmentsView: View {
  let threadID: String
  let items: [Attachment]
  let client: OmniClient
  @State private var preview: URL?
  @State private var loading: String?

  var body: some View {
    FlowLayout(spacing: 6) {
      ForEach(items, id: \.name) { a in
        Button { open(a) } label: {
          if a.image { thumbnail(a) } else { chip(a) }
        }
        .buttonStyle(.plain)
        .help("\(a.name) · \(Format.bytes(a.size))")
        .overlay { if loading == a.name { ProgressView().controlSize(.small) } }
      }
    }
    .quickLookPreview($preview)
  }

  private func thumbnail(_ a: Attachment) -> some View {
    AsyncImage(url: client.uploadURL(threadID: threadID, name: a.name)) { phase in
      switch phase {
      case .success(let image):
        image.resizable().scaledToFit()
      case .failure:
        OmniIcon(name: "image", size: 16).foregroundStyle(Tok.fg4).frame(width: z(80), height: z(60))
      default:
        ProgressView().controlSize(.small).frame(width: z(80), height: z(60))
      }
    }
    .frame(maxWidth: z(224), maxHeight: z(176))
    .clipShape(RoundedRectangle(cornerRadius: z(12), style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: z(12), style: .continuous).strokeBorder(Tok.line))
    .padding(z(4))
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
    .accessibilityLabel(a.name)
  }

  private func chip(_ a: Attachment) -> some View {
    HStack(spacing: z(8)) {
      OmniIcon(name: "file", size: 15)
        .foregroundStyle(Tok.fg3)
        .frame(width: z(32), height: z(32))
        .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(8), style: .continuous))
      VStack(alignment: .leading, spacing: 1) {
        Text(a.name).font(.omni(size: ThreadStyle.small, weight: .medium)).foregroundStyle(Tok.fg2)
          .lineLimit(1).truncationMode(.middle)
        Text(Format.bytes(a.size)).font(.omni(size: 10.5)).monospacedDigit().foregroundStyle(Tok.fg4)
      }
      .frame(maxWidth: z(190), alignment: .leading)
      OmniIcon(name: "download", size: 14).foregroundStyle(Tok.fg3)
    }
    .padding(.horizontal, z(8))
    .frame(height: z(44))
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
  }

  /// Quick Look needs a file, so the upload is fetched into a temporary folder first.
  private func open(_ a: Attachment) {
    guard loading == nil else { return }
    loading = a.name
    Task {
      defer { loading = nil }
      let folder = FileManager.default.temporaryDirectory.appending(path: "Omni Quick Look/\(threadID)", directoryHint: .isDirectory)
      let file = folder.appending(path: (a.name as NSString).lastPathComponent)
      do {
        let data = try await client.file(client.uploadURL(threadID: threadID, name: a.name))
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try data.write(to: file, options: .atomic)
        preview = file
      } catch {
        NSSound.beep()
      }
    }
  }
}

/// Lays its children out in rows, right-aligned like the Web UI's attachment strip, wrapping when full.
struct FlowLayout: Layout {
  var spacing: CGFloat = 6

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = rows(width: proposal.width ?? .infinity, subviews)
    let width = rows.map(\.width).max() ?? 0
    let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
    return CGSize(width: width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in rows(width: bounds.width, subviews) {
      var x = bounds.maxX - row.width
      for i in row.items {
        let size = subviews[i].sizeThatFits(.unspecified)
        subviews[i].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(size))
        x += size.width + spacing
      }
      y += row.height + spacing
    }
  }

  private struct Row {
    var items: [Int] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  private func rows(width: CGFloat, _ subviews: Subviews) -> [Row] {
    var rows: [Row] = []
    var row = Row()
    for (i, view) in subviews.enumerated() {
      let size = view.sizeThatFits(.unspecified)
      if !row.items.isEmpty, row.width + spacing + size.width > width {
        rows.append(row)
        row = Row()
      }
      row.width += (row.items.isEmpty ? 0 : spacing) + size.width
      row.height = max(row.height, size.height)
      row.items.append(i)
    }
    if !row.items.isEmpty { rows.append(row) }
    return rows
  }
}

/// How a turn ended, as ResultLine in Transcript.tsx: a rule across the column, the line in sentence case with
/// a volt dot when done, a needs diamond when it failed.
struct ResultLineView: View {
  let result: TurnResult

  var body: some View {
    HStack(spacing: z(12)) {
      rule
      HStack(spacing: z(8)) {
        if result.isBad {
          GlyphView(glyph: .needs, size: 8)
        } else if result.ok {
          Circle().fill(Tok.done).overlay(Circle().strokeBorder(Tok.doneEdge, lineWidth: 0.5)).frame(width: z(5), height: z(5))
        } else {
          Circle().fill(Tok.fg4).frame(width: z(4), height: z(4))
        }
        Text(Self.sentence(result.line))
          .font(.omni(size: 12, weight: .medium))
          .monospacedDigit()
      }
      .foregroundStyle(result.isBad ? Tok.fg2 : Tok.fg4)
      .fixedSize()
      rule
    }
    .padding(.vertical, z(4))
  }

  private var rule: some View { Rectangle().fill(Tok.line).frame(height: 1) }

  static func sentence(_ s: String) -> String {
    guard let first = s.first else { return s }
    return first.uppercased() + s.dropFirst()
  }
}

/// ErrorCallout in Transcript.tsx: a surface card, the needs diamond and Error in ink, the text in mono fg-2.
struct ErrorCallout: View {
  let text: String

  var body: some View {
    VStack(alignment: .leading, spacing: z(6)) {
      HStack(spacing: z(6)) {
        GlyphView(glyph: .needs, size: 9)
        Text("Error")
      }
      .font(.omni(size: ThreadStyle.small, weight: .semibold))
      .foregroundStyle(Tok.fg)
      let body = Text(text)
        .font(.omni(size: ThreadStyle.mono, design: .monospaced))
        .lineSpacing(3)
        .foregroundStyle(Tok.fg2)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
      if Format.isTall(text) {
        ScrollView { body }.frame(height: z(288))
      } else {
        body
      }
    }
    .padding(.horizontal, z(16))
    .padding(.vertical, z(12))
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: ThreadStyle.card, style: .continuous))
  }
}

/// A child thread reporting back, with a link to it, as ReportCard in Transcript.tsx.
struct ReportCard: View {
  let report: CrewReport
  let document: MarkdownDocument
  let model: AppModel

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: z(8)) {
        OmniIcon(name: "inbox", size: 14)
          .foregroundStyle(Tok.fg3)
          .frame(width: z(28), height: z(28))
          .background(Tok.bg, in: Circle())
        Text("Report from \(report.role ?? "crew")").fontWeight(.medium).foregroundStyle(Tok.fg)
        if report.dropped == true {
          Text("Not delivered")
            .font(.omni(size: 11.5, weight: .medium))
            .foregroundStyle(Tok.fg3)
            .help("The run ended before the agent read this report")
        }
        if let task = report.taskID, !task.isEmpty {
          Text(task).font(.omni(size: ThreadStyle.mono, design: .monospaced)).foregroundStyle(Tok.fg3)
        }
        if let channel = report.channel, !channel.isEmpty {
          Button("#\(channel)") { model.route = .channel(id: channel) }
            .buttonStyle(.plain)
            .foregroundStyle(Tok.fg3)
        }
        Spacer(minLength: z(8))
        if let status = report.status, !status.isEmpty {
          StatusPill(status: ThreadStatus(rawValue: status))
        }
        if let thread = report.threadID {
          Button { model.route = .thread(id: thread) } label: {
            HStack(spacing: z(4)) {
              Text("Open thread")
              OmniIcon(name: "arrowRight", size: 12)
            }
            .font(.omni(size: 12.5, weight: .medium))
            .foregroundStyle(Tok.fg)
            .padding(.horizontal, z(12))
            .frame(height: z(28))
            .background(Tok.bg, in: Capsule())
            .cardShadow(14)
          }
          .buttonStyle(.plain)
        }
      }
      .font(.omni(size: ThreadStyle.small))
      .padding(.horizontal, z(16))
      .padding(.top, z(12))
      if let title = report.title, !title.isEmpty {
        Text(title)
          .font(.omni(size: 15, weight: .medium))
          .foregroundStyle(Tok.fg)
          .padding(.horizontal, z(16))
          .padding(.top, z(12))
      }
      MarkdownView(document: document)
        .padding(.horizontal, z(16))
        .padding(.top, z(8))
        .padding(.bottom, z(16))
    }
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(22), style: .continuous))
    .opacity(report.dropped == true ? 0.6 : 1)
  }
}

/// The latest TodoWrite as a checklist, as PlanCard in Transcript.tsx.
struct PlanCard: View {
  let plan: Plan

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: z(12)) {
        Text("Plan").omniCaption()
        TicksView(ticks: plan.ticks)
          .frame(maxWidth: z(160))
          .frame(height: z(6))
          .accessibilityLabel("Plan progress")
        Spacer(minLength: 0)
        Text("\(plan.done)/\(plan.todos.count)")
          .font(.omni(size: 11))
          .monospacedDigit()
          .foregroundStyle(Tok.fg3)
      }
      .padding(.bottom, z(10))
      ForEach(Array(plan.todos.enumerated()), id: \.offset) { _, todo in
        CheckItem(state: todo.status ?? "pending", text: todo.label ?? "")
      }
      if plan.active == nil && plan.allDone {
        Text("All done").font(.omni(size: 12)).foregroundStyle(Tok.fg4).padding(.top, z(6))
      }
    }
    .padding(.horizontal, z(16))
    .padding(.top, z(14))
    .padding(.bottom, z(12))
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(22), style: .continuous))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Plan")
  }
}

struct TicksView: View {
  let ticks: Ticks

  var body: some View {
    HStack(alignment: .bottom, spacing: z(2)) {
      ForEach(0..<ticks.count, id: \.self) { i in
        let on = i < ticks.on
        GeometryReader { g in
          VStack(spacing: 0) {
            Spacer(minLength: 0)
            RoundedRectangle(cornerRadius: z(1.5))
              .fill(on ? Tok.fg : Tok.fg.opacity(0.14))
              .frame(height: g.size.height * (on ? 1 : 0.55))
          }
        }
      }
    }
    .animation(Motion.settle, value: ticks.on)
  }
}

/// The agent's latest status while it works.
struct WorkingLine: View {
  let text: String

  var body: some View {
    HStack(spacing: z(8)) {
      Loader(size: 13).foregroundStyle(Tok.fg3)
      Text(text).lineLimit(1).truncationMode(.tail)
    }
    .font(.omni(size: ThreadStyle.small))
    .foregroundStyle(Tok.fg3)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// Messages and crew reports the agent has not read yet, under the live output, as QueuedMessages in
/// Transcript.tsx. Ben's own queued and held ones can be edited, moved and removed until the runner sends them
/// (`PendingEditsModel`).
struct QueuedMessagesView: View {
  let store: ThreadStore
  let client: OmniClient
  let items: [PendingMsg]
  let starting: Bool
  /// The thread's worktree is not ready: what waits sends once it is (SetupCard).
  var setup: ThreadSetup? = nil

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
          PendingRow(store: store, client: client, m: m, label: m.label(lead: false, setup: setup), icon: "clock") { EmptyView() }
        } else {
          PendingBubble(m: m, label: m.label(lead: i == lead, setup: setup), icon: m.state == .sent ? "send" : "clock")
        }
      }
      if let error = store.edits.error {
        ErrorNote(text: error)
      }
    }
    .padding(.top, z(4))
  }
}

/// A message the agent has not read: the line over it and its dashed bubble.
struct PendingBubble: View {
  let m: PendingMsg
  let label: String
  let icon: String

  var body: some View {
    VStack(alignment: .trailing, spacing: z(4)) {
      HStack(spacing: z(4)) {
        IconLabel(label, icon: icon, size: 12)
        if let files = m.attachments, !files.isEmpty {
          Text("· \(Format.plural(files.count, "file"))").foregroundStyle(Tok.fg4)
        }
      }
      .font(.omni(size: 11.5, weight: .medium))
      .foregroundStyle(Tok.fg3)
      Text(m.text)
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
    .frame(maxWidth: .infinity, alignment: .trailing)
    .opacity(0.7)
  }
}

/// One of Ben's unsent messages: its bubble with up, down, Edit and Remove under it, or the edit box while he
/// edits it. `extra` goes before the actions (Send again on an uncertain one).
struct PendingRow<Extra: View>: View {
  let store: ThreadStore
  let client: OmniClient
  let m: PendingMsg
  let label: String
  let icon: String
  @ViewBuilder let extra: Extra

  var body: some View {
    let edits = store.edits
    if let d = edits.draft(for: m.uuid) {
      PendingEditBox(store: store, client: client, m: m, draft: d, label: label)
    } else {
      VStack(alignment: .trailing, spacing: z(6)) {
        PendingBubble(m: m, label: label, icon: icon)
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
          .disabled(saving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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
              NSPasteboard.general.clearContents()
              NSPasteboard.general.setString(d.prompt, forType: .string)
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
            PendingBubble(m: m, label: m.label(lead: false, setup: setup), icon: icon)
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
