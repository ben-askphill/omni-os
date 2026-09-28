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
    VStack(alignment: .trailing, spacing: 5) {
      header
      if let files = message.attachments, !files.isEmpty {
        AttachmentsView(threadID: threadID, items: files, client: client)
      }
      VStack(alignment: .leading, spacing: 4) {
        Text(Self.text(pieces, cut: long && !more))
          .font(.system(size: ThreadStyle.prose + 0.5))
          .lineSpacing(3)
          .tint(.primary)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
          .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == Self.pillScheme, let start = Int(url.host() ?? "") else { return .discarded }
            for hit in pieces.compactMap(\.hit) where hit.start != start { if ui.isOpen(aboutKey(hit.start)) { ui.toggle(aboutKey(hit.start)) } }
            ui.toggle(aboutKey(start))
            return .handled
          })
        if let about {
          Divider()
          Text("\(about.description.isEmpty ? "No description" : about.description)\(Text(" · \(about.sourceTag)").foregroundStyle(.tertiary))")
            .font(.system(size: ThreadStyle.small))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        if long {
          Button(more ? "Show less" : "Show all") { ui.toggle(moreKey) }
            .buttonStyle(.link)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(.secondary)
            .underline()
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 10)
      .background(background)
      .frame(maxWidth: 600, alignment: .trailing)
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
    .opacity(message.dropped == true ? 0.6 : 1)
  }

  private var moreKey: String { "b\(eventID)" }
  private func aboutKey(_ start: Int) -> String { "p\(eventID):\(start)" }

  private var header: some View {
    HStack(spacing: 8) {
      if let label = message.sourceLabel {
        Text(label)
          .fontWeight(.medium)
          .foregroundStyle(message.source == "conductor" ? AnyShapeStyle(ThreadStyle.info) : AnyShapeStyle(.secondary))
      }
      if let how = message.sendLabel {
        Label(how, systemImage: message.mode == .interrupt ? "stop.fill" : "paperplane")
          .labelStyle(TightLabel())
          .fontWeight(.medium)
          .foregroundStyle(message.mode == .interrupt ? AnyShapeStyle(ThreadStyle.warn) : AnyShapeStyle(.secondary))
      }
      if message.dropped == true {
        Label("Not sent", systemImage: "xmark")
          .labelStyle(TightLabel())
          .fontWeight(.medium)
          .foregroundStyle(.secondary)
          .help("The run ended before the agent read this message")
      }
      Text(Format.clock(at))
        .font(.system(size: 11))
        .monospacedDigit()
        .foregroundStyle(.tertiary)
    }
    .font(.system(size: 11.5))
  }

  @ViewBuilder private var background: some View {
    let shape = UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 20, bottomTrailingRadius: 20, topTrailingRadius: 7)
    if message.dropped == true {
      shape.strokeBorder(ThreadStyle.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
    } else if message.source == "conductor" {
      shape.fill(ThreadStyle.infoBackground)
    } else {
      shape.fill(ThreadStyle.bubble)
    }
  }

  private static func text(_ pieces: [SlashPiece], cut: Bool) -> AttributedString {
    var out = AttributedString()
    for piece in pieces {
      var run = AttributedString(piece.text)
      if let hit = piece.hit {
        run.font = .system(size: ThreadStyle.prose - 1, weight: .medium, design: .monospaced)
        run.backgroundColor = ThreadStyle.surface2
        run.link = URL(string: "\(pillScheme)://\(hit.start)")
      }
      out.append(run)
    }
    if cut { out.append(AttributedString("...")) }
    return out
  }
}

struct TightLabel: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 3) {
      configuration.icon.imageScale(.small)
      configuration.title
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
        Image(systemName: "photo").foregroundStyle(.tertiary).frame(width: 80, height: 60)
      default:
        ProgressView().controlSize(.small).frame(width: 80, height: 60)
      }
    }
    .frame(maxWidth: 224, maxHeight: 176)
    .clipShape(RoundedRectangle(cornerRadius: 12))
    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(ThreadStyle.line))
    .padding(4)
    .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 16))
    .accessibilityLabel(a.name)
  }

  private func chip(_ a: Attachment) -> some View {
    HStack(spacing: 8) {
      Image(systemName: "doc")
        .font(.system(size: 14))
        .foregroundStyle(.secondary)
        .frame(width: 30, height: 30)
        .background(Color(nsColor: .windowBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
      VStack(alignment: .leading, spacing: 1) {
        Text(a.name).font(.system(size: ThreadStyle.small, weight: .medium)).lineLimit(1).truncationMode(.middle)
        Text(Format.bytes(a.size)).font(.system(size: 10.5)).monospacedDigit().foregroundStyle(.tertiary)
      }
      .frame(maxWidth: 190, alignment: .leading)
    }
    .padding(.horizontal, 8)
    .frame(height: 44)
    .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 16))
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

/// How a turn ended, as a rule across the column.
struct ResultLineView: View {
  let result: TurnResult

  var body: some View {
    HStack(spacing: 12) {
      rule
      HStack(spacing: 7) {
        Circle().fill(dot).frame(width: 4, height: 4)
        Text(result.line.uppercased())
          .font(.system(size: 10.5))
          .monospacedDigit()
          .kerning(0.6)
      }
      .foregroundStyle(result.isBad ? AnyShapeStyle(ThreadStyle.bad) : AnyShapeStyle(.tertiary))
      .fixedSize()
      rule
    }
    .padding(.vertical, 4)
  }

  private var rule: some View { Rectangle().fill(ThreadStyle.line).frame(height: 1) }

  private var dot: Color {
    result.isBad ? ThreadStyle.bad : result.ok ? ThreadStyle.ok : ThreadStyle.warn
  }
}

struct ErrorCallout: View {
  let text: String

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Label("Error", systemImage: "exclamationmark.triangle")
        .font(.system(size: ThreadStyle.small, weight: .semibold))
      let body = Text(text)
        .font(.system(size: ThreadStyle.mono, design: .monospaced))
        .lineSpacing(2)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
      if Format.isTall(text) {
        ScrollView { body }.frame(height: 288)
      } else {
        body
      }
    }
    .foregroundStyle(ThreadStyle.bad)
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
    .background(ThreadStyle.badBackground, in: RoundedRectangle(cornerRadius: ThreadStyle.card))
  }
}

/// A child thread reporting back, with a link to it, as ReportCard in Transcript.tsx.
struct ReportCard: View {
  let report: CrewReport
  let document: MarkdownDocument
  let model: AppModel

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Image(systemName: "tray")
          .font(.system(size: 12))
          .foregroundStyle(.secondary)
          .frame(width: 26, height: 26)
          .background(Color(nsColor: .windowBackgroundColor), in: Circle())
        Text("Report from \(report.role ?? "crew")").fontWeight(.medium)
        if report.dropped == true {
          Text("Not delivered")
            .font(.system(size: 11.5, weight: .medium))
            .foregroundStyle(.secondary)
            .help("The run ended before the agent read this report")
        }
        if let task = report.taskID, !task.isEmpty {
          Text(task).font(.system(size: ThreadStyle.mono, design: .monospaced)).foregroundStyle(.secondary)
        }
        if let channel = report.channel, !channel.isEmpty {
          Button("#\(channel)") { model.route = .channel(id: channel) }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
        Spacer(minLength: 8)
        if let status = report.status, !status.isEmpty {
          StatusPill(status: ThreadStatus(rawValue: status))
        }
        if let thread = report.threadID {
          Button { model.route = .thread(id: thread) } label: {
            HStack(spacing: 4) {
              Text("Open thread")
              Image(systemName: "arrow.right").imageScale(.small)
            }
            .font(.system(size: 12, weight: .medium))
            .padding(.horizontal, 11)
            .frame(height: 26)
            .background(Color(nsColor: .windowBackgroundColor), in: Capsule())
            .shadow(color: .black.opacity(0.08), radius: 1, y: 1)
          }
          .buttonStyle(.plain)
        }
      }
      .font(.system(size: ThreadStyle.small))
      .padding(.horizontal, 16)
      .padding(.top, 12)
      if let title = report.title, !title.isEmpty {
        Text(title)
          .font(.system(size: 15, weight: .medium))
          .padding(.horizontal, 16)
          .padding(.top, 12)
      }
      MarkdownView(document: document)
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 16)
    }
    .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: ThreadStyle.card + 2))
    .opacity(report.dropped == true ? 0.6 : 1)
  }
}

/// The latest TodoWrite as a checklist, as PlanCard in Transcript.tsx.
struct PlanCard: View {
  let plan: Plan

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 12) {
        Text("PLAN")
          .font(.system(size: 10.5, weight: .medium, design: .monospaced))
          .kerning(0.8)
          .foregroundStyle(.secondary)
        TicksView(ticks: plan.ticks)
          .frame(maxWidth: 160, maxHeight: 6)
          .accessibilityLabel("Plan progress")
        Spacer(minLength: 0)
        Text("\(plan.done)/\(plan.todos.count)")
          .font(.system(size: 11))
          .monospacedDigit()
          .foregroundStyle(.secondary)
      }
      .padding(.bottom, 9)
      ForEach(Array(plan.todos.enumerated()), id: \.offset) { _, todo in
        CheckItem(state: todo.status ?? "pending", text: todo.label ?? "")
      }
      if plan.active == nil && plan.allDone {
        Text("All done").font(.system(size: 12)).foregroundStyle(.tertiary).padding(.top, 6)
      }
    }
    .padding(.horizontal, 16)
    .padding(.top, 14)
    .padding(.bottom, 12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: ThreadStyle.card + 2))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Plan")
  }
}

struct TicksView: View {
  let ticks: Ticks

  var body: some View {
    HStack(spacing: 2) {
      ForEach(0..<ticks.count, id: \.self) { i in
        RoundedRectangle(cornerRadius: 1)
          .fill(i < ticks.on ? Color.primary : Color.primary.opacity(0.12))
      }
    }
    .animation(.snappy, value: ticks.on)
  }
}

/// The agent's latest status while it works.
struct WorkingLine: View {
  let text: String

  var body: some View {
    HStack(spacing: 8) {
      Spinner()
      Text(text).lineLimit(1).truncationMode(.tail)
    }
    .font(.system(size: ThreadStyle.small))
    .foregroundStyle(.secondary)
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
    VStack(alignment: .trailing, spacing: 12) {
      ForEach(Array(items.enumerated()), id: \.element.id) { i, m in
        if m.kind == "crew_report" {
          Label(m.label(lead: i == lead), systemImage: m.state == .sent ? "paperplane" : "clock")
            .labelStyle(TightLabel())
            .font(.system(size: 12))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
          VStack(alignment: .trailing, spacing: 4) {
            HStack(spacing: 4) {
              Label(m.label(lead: i == lead), systemImage: m.state == .sent ? "paperplane" : "clock")
                .labelStyle(TightLabel())
              if let files = m.attachments, !files.isEmpty {
                Text("· \(Format.plural(files.count, "file"))").foregroundStyle(.tertiary)
              }
            }
            .font(.system(size: 11.5, weight: .medium))
            .foregroundStyle(.secondary)
            Text(m.text)
              .font(.system(size: ThreadStyle.prose))
              .lineSpacing(3)
              .textSelection(.enabled)
              .fixedSize(horizontal: false, vertical: true)
              .padding(.horizontal, 16)
              .padding(.vertical, 10)
              .background(
                UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 20, bottomTrailingRadius: 20, topTrailingRadius: 7)
                  .strokeBorder(Color.primary.opacity(0.2), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
              )
              .frame(maxWidth: 600, alignment: .trailing)
          }
          .frame(maxWidth: .infinity, alignment: .trailing)
          .opacity(0.7)
        }
      }
    }
    .padding(.top, 4)
  }
}
