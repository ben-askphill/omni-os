import OmniKit
import SwiftUI

/// The transcript's names in the Web UI's icon set (OmniIcon).
enum TranscriptIcon {
  /// toolIcon in Transcript.tsx: terminal, file, globe, layers or tool.
  static func tool(_ name: String) -> String {
    switch name {
    case "Bash", "BashOutput": "terminal"
    case "Read", "Edit", "Write", "MultiEdit", "Glob", "Grep": "file"
    case "WebFetch", "WebSearch": "globe"
    case _ where name.contains("browser"): "globe"
    case "Task", "Agent": "layers"
    default: "tool"
    }
  }

  /// kindIcon in ArtifactViewer.tsx.
  static func artifact(_ kind: String) -> String {
    switch kind {
    case "image", "screenshot": "image"
    case "html", "svg": "globe"
    default: "file"
    }
  }
}

/// The chevron a tool row or group turns open with, as in Transcript.tsx.
struct Chevron: View {
  let open: Bool
  var color = Tok.fg4

  var body: some View {
    OmniIcon(name: "chevronRight", size: 12)
      .foregroundStyle(color)
      .rotationEffect(.degrees(open ? 90 : 0))
      .animation(Motion.settle, value: open)
      .frame(width: z(12))
  }
}
