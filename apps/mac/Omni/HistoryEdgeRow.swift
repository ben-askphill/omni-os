import OmniKit
import SwiftUI

extension EnvironmentValues {
  /// The thread whose transcript a row is in, for the controls that load more of it. Nil outside a transcript.
  @Entry var threadStore: ThreadStore?
}

/// Where the held history has an edge, as HistoryEdgeRow.tsx: "Earlier messages" above the first page, which loads
/// by itself once it shows and again while it stays in view, or the two-way control in a gap under an island, which
/// never loads by itself.
struct HistoryEdgeRow: View {
  let store: ThreadStore
  let edge: HistoryEdge
  @State private var inView = false

  var body: some View {
    let busy = store.loadingEdges.contains(edge)
    let error = store.edgeErrors[edge]
    HStack(spacing: z(12)) {
      Hairline()
      HStack(spacing: z(6)) {
        switch edge {
        case .earlier:
          if let error {
            Failed(text: error.message) { Task { await store.loadEarlier() } }
          } else {
            EdgeButton(title: "Earlier messages", up: true, busy: busy) { Task { await store.loadEarlier() } }
          }
        case .gap(let after):
          EdgeButton(title: "Show later", up: false, busy: busy) { Task { await store.loadLater(after: after) } }
          EdgeButton(title: "Show earlier", up: true, busy: busy) { Task { await store.loadEarlier(after + 1) } }
          if let error, !busy {
            Failed(text: error.message) { Task { await store.loadLater(after: after) } }
          }
        }
      }
      .fixedSize()
      Hairline()
    }
    .padding(.vertical, z(2))
    .onScrollVisibilityChange(threshold: 0.01) { inView = $0 }
    // Again after each page: one that left the control in view loads the next.
    .task(id: AutoLoad(inView: inView, busy: busy, from: store.history.spans.first?.from)) {
      guard edge == .earlier, inView, !busy, store.edgeErrors[.earlier] == nil else { return }
      #if DEBUG
      // QA snapshots of the control itself: `-OmniQAManualHistory YES`.
      if UserDefaults.standard.bool(forKey: "OmniQAManualHistory") { return }
      #endif
      await store.loadEarlier()
    }
  }

  private struct AutoLoad: Hashable {
    let inView: Bool
    let busy: Bool
    let from: Int?
  }
}

private struct EdgeButton: View {
  let title: String
  let up: Bool
  let busy: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: z(6)) {
        if busy {
          Loader(size: 12, color: Tok.fg3)
        } else {
          OmniIcon(name: "arrowUp", size: 13).rotationEffect(.degrees(up ? 0 : 180))
        }
        Text(title)
      }
      .font(.omni(size: 12, weight: .medium))
    }
    .buttonStyle(.pill(.ghost, height: 28))
    .disabled(busy)
  }
}

/// A load that failed: the server's reason and Retry, quiet as a caption.
private struct Failed: View {
  let text: String
  let retry: () -> Void

  var body: some View {
    HStack(spacing: z(8)) {
      Text(text)
        .foregroundStyle(Tok.fg3)
        .lineLimit(2)
      Button("Retry", action: retry)
        .buttonStyle(.link)
        .fontWeight(.medium)
        .foregroundStyle(Tok.fg)
        .underline()
    }
    .font(.omni(size: 12))
    .accessibilityElement(children: .combine)
  }
}

/// Under a row a page cut down to size: what it is, and its whole copy on request, as ClippedNote in
/// HistoryEdgeRow.tsx. Nothing for a row that came whole.
struct ClippedNote: View {
  let eventID: Int
  @Environment(\.threadStore) private var store

  var body: some View {
    if let store, let clipped = store.clipped[eventID] {
      let busy = store.showingAll.contains(eventID)
      HStack(spacing: z(6)) {
        Text("Trimmed for loading")
        Text("·")
        Button {
          Task { await store.showAll(eventID) }
        } label: {
          HStack(spacing: z(4)) {
            if busy { Loader(size: 11, color: Tok.fg3) }
            Text("Show all (\(Format.bytes(clipped.bytes)))")
          }
        }
        .buttonStyle(.link)
        .fontWeight(.medium)
        .foregroundStyle(Tok.fg3)
        .underline(!busy)
        .disabled(busy)
        if let error = store.showAllErrors[eventID] {
          Text("· \(error.message)").foregroundStyle(Tok.fg3)
        }
      }
      .font(.omni(size: 11.5))
      .foregroundStyle(Tok.fg4)
    }
  }
}

extension View {
  /// A user message or reply that came clipped gets its ClippedNote under it.
  func clippedNote(_ item: TranscriptItem) -> some View {
    modifier(ClippedItemNote(item: item))
  }
}

private struct ClippedItemNote: ViewModifier {
  let item: TranscriptItem
  @Environment(\.threadStore) private var store

  func body(content: Content) -> some View {
    switch item {
    case .user(let id, _, _) where store?.clipped[id] != nil:
      VStack(alignment: .trailing, spacing: z(4)) {
        content
        ClippedNote(eventID: id)
      }
    case .text(let id, _, _) where store?.clipped[id] != nil:
      VStack(alignment: .leading, spacing: z(4)) {
        content
        ClippedNote(eventID: id)
      }
    default:
      content
    }
  }
}
