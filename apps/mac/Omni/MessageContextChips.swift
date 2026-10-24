import OmniKit
import SwiftUI

/// A message's context as chips, as ContextChips.tsx: in the reply box, where each can be removed, and over sent and
/// queued messages. Names no kind: a kind's icon and detail come from `contextViews`. A record this build can't read
/// shows its stored label and says why it can't show more. A click opens the chip's inspector in a popover, so the reply
/// box keeps its height.
struct MessageContextChips: View {
  let readings: [ContextReading]
  /// Makes the chips removable.
  var remove: ((String) -> Void)?
  /// `.trailing` over a message, wrapping like its attachments; `.leading` in the reply box, a row that scrolls.
  var alignment: HorizontalAlignment = .trailing
  @State private var open: String?

  static let newerLabel = "Context from a newer Omni"

  var body: some View {
    Group {
      if alignment == .leading {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: z(6)) { chips }
        }
      } else {
        FlowLayout(spacing: 6) { chips }
      }
    }
    #if DEBUG
    .onChange(of: readings.map(\.record.id), initial: true) { _, ids in
      guard remove != nil else { return }
      let open = $open
      ContextChipsProbe.toggle = { i in
        guard ids.indices.contains(i) else { return false }
        open.wrappedValue = open.wrappedValue == ids[i] ? nil : ids[i]
        return true
      }
    }
    .onDisappear { if remove != nil { ContextChipsProbe.toggle = nil } }
    #endif
  }

  private var chips: some View {
    ForEach(Array(readings.enumerated()), id: \.offset) { _, r in
      ContextChip(reading: r, open: r.record.id == open, remove: remove.map { remove in { remove(r.record.id) } }) {
        open = open == r.record.id ? nil : r.record.id
      }
      .popover(
        isPresented: Binding(get: { open == r.record.id }, set: { if !$0, open == r.record.id { open = nil } }),
        // From the chip's end: centered on a chip at the window's edge, half of it would hang outside the window.
        attachmentAnchor: .point(.topTrailing), arrowEdge: .top
      ) {
        ContextInspector(reading: r)
      }
    }
  }

  /// The chip's line: the stored label, else the kind's own for a record this build reads.
  static func label(_ r: ContextReading) -> String {
    if !r.record.label.isEmpty { return r.record.label }
    if case .known(let record, let value) = r, let label = contextView(for: record.kind)?.label(value) { return label }
    return newerLabel
  }

  static func cantShow(_ record: MessageContext) -> String {
    "This Omni can't show \(record.kind.isEmpty ? "this item" : "\(record.kind) v\(record.v)"). Update Omni to see it."
  }
}

/// The records waiting in a reply box, removable, in the strip above its text like `AttachmentStrip`.
struct DraftContextStrip: View {
  let draft: DraftContextModel

  var body: some View {
    if !draft.records.isEmpty {
      MessageContextChips(readings: ContextReading.read(draft.records, kinds: contextKinds), remove: draft.remove(id:), alignment: .leading)
        .padding(.horizontal, z(12))
        .padding(.top, z(12))
        .padding(.bottom, z(2))
    }
  }
}

private struct ContextChip: View {
  let reading: ContextReading
  let open: Bool
  let remove: (() -> Void)?
  let toggle: () -> Void

  var body: some View {
    let label = MessageContextChips.label(reading)
    let note = reading.record.note.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "\n").first.map(String.init)
    let icon: String = if case .known(let record, _) = reading { contextView(for: record.kind)?.icon ?? "info" } else { "info" }
    HStack(spacing: z(4)) {
      Button(action: toggle) {
        HStack(spacing: z(8)) {
          OmniIcon(name: icon, size: 15)
            .foregroundStyle(Tok.fg3)
            .frame(width: z(36), height: z(36))
            .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(8), style: .continuous))
          VStack(alignment: .leading, spacing: 1) {
            Text(label)
              .font(.omni(size: 12, weight: .medium, design: .monospaced))
              .foregroundStyle(Tok.fg2)
              .lineLimit(1)
              .truncationMode(.head)
            if let note, !note.isEmpty {
              Text(note).font(.omni(size: 11)).foregroundStyle(Tok.fg4).lineLimit(1)
            }
          }
          .frame(maxWidth: z(190), alignment: .leading)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .help(label)
      .accessibilityLabel(label)
      .accessibilityValue(open ? "Expanded" : "Collapsed")
      if let remove {
        Button(action: remove) {
          OmniIcon(name: "x", size: 13)
        }
        .buttonStyle(.icon(size: 24))
        .help("Remove \(label)")
        .accessibilityLabel("Remove \(label)")
      }
    }
    .padding(.leading, z(4))
    .padding(.trailing, z(remove == nil ? 10 : 4))
    .frame(height: z(44))
    .background(Tok.surface2, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: z(16), style: .continuous).strokeBorder(open ? Tok.lineStrong : .clear))
  }
}

/// What a chip opens to: the kind's own view and Ben's note, or for a record this build can't read, its label and why.
private struct ContextInspector: View {
  let reading: ContextReading

  var body: some View {
    VStack(alignment: .leading, spacing: z(10)) {
      if case .known(let record, let value) = reading, let detail = contextView(for: record.kind)?.detailView(value, record: record) {
        detail
      } else {
        Text(reading.record.label.isEmpty ? MessageContextChips.newerLabel : reading.record.label)
          .font(.omni(size: 12, design: .monospaced))
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
          .truncationMode(.head)
        HStack(alignment: .firstTextBaseline, spacing: z(6)) {
          OmniIcon(name: "info", size: 13)
          Text(MessageContextChips.cantShow(reading.record)).fixedSize(horizontal: false, vertical: true)
        }
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg3)
      }
      if !reading.record.note.isEmpty {
        Text(reading.record.note)
          .font(.omni(size: 12.5))
          .foregroundStyle(Tok.fg2)
          .lineSpacing(3)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.leading, z(10))
          .overlay(alignment: .leading) { Rectangle().fill(Tok.lineStrong).frame(width: 2) }
      }
    }
    .padding(z(14))
    .frame(width: z(440), alignment: .leading)
  }
}

#if DEBUG
/// The QA harness's way to the reply box's chips (`{"openContext": 0}`).
@MainActor
enum ContextChipsProbe {
  /// Opens or closes the inspector of the chip at this index. false when there is none.
  static var toggle: ((Int) -> Bool)?
}
#endif
