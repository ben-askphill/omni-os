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
/// Transcript.tsx.
struct QueuedMessagesView: View {
  let items: [PendingMsg]
  let starting: Bool

  var body: some View {
    let lead = PendingMsg.lead(in: items, starting: starting)
    VStack(alignment: .trailing, spacing: z(12)) {
      ForEach(Array(items.enumerated()), id: \.element.id) { i, m in
        if m.kind == "crew_report" {
          IconLabel(m.label(lead: i == lead), icon: m.state == .sent ? "send" : "clock", size: 12)
            .font(.omni(size: 12))
            .foregroundStyle(Tok.fg3)
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
          VStack(alignment: .trailing, spacing: z(4)) {
            HStack(spacing: z(4)) {
              IconLabel(m.label(lead: i == lead), icon: m.state == .sent ? "send" : "clock", size: 12)
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
    }
    .padding(.top, z(4))
  }
}
