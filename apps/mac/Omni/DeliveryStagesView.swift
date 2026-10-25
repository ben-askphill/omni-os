import OmniKit
import SwiftUI

/// A delivery's way from event to outcome, one line per stage (DeliveryStages.tsx): a tone glyph, the stage, what
/// happened, and a note under it.
struct DeliveryStagesView: View {
  let stages: [DeliveryStage]

  var body: some View {
    VStack(alignment: .leading, spacing: z(6)) {
      ForEach(stages, id: \.name) { stage in
        HStack(alignment: .top, spacing: z(10)) {
          GlyphView(glyph: stage.tone.glyph, size: 8).padding(.top, z(4))
          Text(stage.name.rawValue)
            .foregroundStyle(Tok.fg4)
            .frame(width: z(64), alignment: .leading)
          VStack(alignment: .leading, spacing: z(1)) {
            Text(stage.label).font(.omni(size: 12.5, weight: .medium)).foregroundStyle(Tok.fg)
            if let note = stage.note {
              Text(note)
                .font(.omni(size: 11.5))
                .foregroundStyle(Tok.fg3)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
      }
    }
    .font(.omni(size: 12.5))
  }
}

private extension DeliveryStage.Tone {
  /// done is a volt disc, needs a vermilion diamond, live pings, quiet is grey and plain is hollow.
  var glyph: Glyph {
    switch self {
    case .done: .done
    case .needs: .needs
    case .live: .running
    case .quiet: .settled
    case .plain: .idle
    }
  }
}
