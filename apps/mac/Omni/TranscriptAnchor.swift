import OmniKit
import SwiftUI

/// Where the shown transcript rows sit in the scroll view, kept as they move. Not observed: a scroll redraws nothing.
@MainActor
final class TopRows {
  private(set) var frames: [TranscriptItemID: CGRect] = [:]

  func set(_ id: TranscriptItemID, _ frame: CGRect?) {
    frames[id] = frame
  }

  /// The row Ben reads: the first that starts inside the view, else the one across its top edge.
  var anchor: (id: TranscriptItemID, frame: CGRect)? {
    let shown = frames.filter { $0.value.maxY > 0 }
    let pick = shown.filter { $0.value.minY >= 0 }.min { $0.value.minY < $1.value.minY }
      ?? shown.min { $0.value.minY < $1.value.minY }
    return pick.map { ($0.key, $0.value) }
  }
}

extension EnvironmentValues {
  @Entry var topRows: TopRows?
}

extension View {
  /// Reports this transcript row's frame for `holdsTopRow`.
  func tracksTopRow(_ id: TranscriptItemID) -> some View {
    modifier(TrackTopRow(id: id))
  }

  /// Where the view goes when pages of history land. A reveal (`ThreadStore.revealTarget`) centres its row and stops
  /// following the bottom (`release`). Any other page keeps the row Ben reads where it is (`ThreadStore.pagesLaidOut`):
  /// a lazy stack at the top edge keeps its offset instead, so the page would push the row down. Not while the view
  /// follows the bottom.
  func holdsTopRow(
    store: ThreadStore, position: Binding<ScrollPosition>, following: @escaping () -> Bool, viewport: @escaping () -> Double?,
    release: @escaping () -> Void
  ) -> some View {
    modifier(HoldTopRow(store: store, position: position, following: following, viewport: viewport, release: release))
  }
}

private struct TrackTopRow: ViewModifier {
  let id: TranscriptItemID
  @Environment(\.topRows) private var rows

  func body(content: Content) -> some View {
    content
      .onGeometryChange(for: CGRect.self) { $0.frame(in: .scrollView) } action: { rows?.set(id, $0) }
      .onDisappear { rows?.set(id, nil) }
  }
}

private struct HoldTopRow: ViewModifier {
  let store: ThreadStore
  @Binding var position: ScrollPosition
  let following: () -> Bool
  let viewport: () -> Double?
  let release: () -> Void
  @State private var rows = TopRows()

  /// One value, so a reveal and the page that brought it are handled together, whatever order they change in.
  private struct Landing: Equatable {
    let pages: Int
    let reveal: TranscriptItemID?
  }

  func body(content: Content) -> some View {
    content
      .environment(\.topRows, rows)
      // The rows still have their frames from before the page: the layout that moves them has not run yet.
      .onChange(of: Landing(pages: store.pagesLaidOut, reveal: store.revealTarget), initial: true) { old, new in
        if let target = new.reveal {
          release()
          position.scrollTo(id: target, anchor: .center)
          store.revealShown()
          return
        }
        guard new.pages != old.pages, !following(), let a = rows.anchor, let v = viewport() else { return }
        // A point of the row at the same fraction of the view: its top lands back at `minY`.
        let room = v - a.frame.height
        let y = abs(room) < 1 ? 0 : a.frame.minY / room
        position.scrollTo(id: a.id, anchor: UnitPoint(x: 0.5, y: y))
      }
      #if DEBUG
      .onAppear { QAProbe.rows = rows }
      #endif
  }
}

#if DEBUG
extension QAProbe {
  /// The open thread's store and row frames, for the QA runner to watch a page land.
  static weak var store: ThreadStore?
  static weak var rows: TopRows?
  /// Opens the search screen's hit at an index, nil when there is none.
  static var openSearchHit: ((Int) -> SearchHit?)?
}
#endif
