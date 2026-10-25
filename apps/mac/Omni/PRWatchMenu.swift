import OmniKit
import SwiftUI

/// The watch rows of the reply box's PR menu (`ThreadPRSlot` in ComposerView.swift), as `PRWatchRow` in
/// apps/web/src/components/thread/PRWatch.tsx: the watch's line, or a refusal, over Watch checks or Stop watching, for
/// an open PR or a running watch. A watch that ended with its PR keeps its line, without the toggle. The menu is an
/// NSMenu snapshot of its content, so the watch and the refusal live in ThreadPRSlot and arrive as bindings.
struct PRWatchSection: View {
  let client: OmniClient
  let threadID: String
  let open: Bool
  @Binding var watch: PRWatch?
  @Binding var error: String?

  var body: some View {
    let watching = watch?.isWatching == true
    if open || watching {
      let copy = PRWatch.copy(watch)
      Divider()
      Text(error ?? copy.line)
      Button(copy.action) { toggle(start: !watching) }
    } else if let watch {
      Divider()
      Text(watch.watchLine)
    }
  }

  private func toggle(start: Bool) {
    Task { @MainActor in
      do {
        watch = start ? try await client.startPRWatch(forThread: threadID) : try await client.stopPRWatch(forThread: threadID)
        error = nil
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}

/// The bell beside the PR number while the watch runs, as `PRWatchMark`.
struct PRWatchGlyph: View {
  let watch: PRWatch?

  var body: some View {
    if let watch, watch.isWatching {
      Image(systemName: "bell")
        .imageScale(.small)
        .foregroundStyle(Tok.live)
        .help(watch.watchLine)
        .accessibilityLabel(watch.watchLine)
    }
  }
}

#if DEBUG
/// Where the reply box's PR button is, for the QA harness to open its menu.
@MainActor
enum QAPRProbe {
  static var button: CGRect?
}
#endif
