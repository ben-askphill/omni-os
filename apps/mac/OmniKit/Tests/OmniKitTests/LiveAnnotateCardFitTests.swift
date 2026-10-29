import CoreGraphics
import Testing
import OmniKit

// The live Annotate card on the Mac fits its panel: a long font stack in a style chip (FlowRows) or a long selector
// (LiveAnnotateCardHeader) truncates inside the card instead of widening it.

/// A line of text `ideal` points wide: as wide as offered and no wider, never under an ellipsis.
private func text(_ ideal: CGFloat, height: CGFloat = 16) -> (CGFloat?) -> CGSize {
  { w in CGSize(width: max(12, min(ideal, w ?? ideal)), height: height) }
}

@Suite struct LiveAnnotateCardFitTests {
  @Test func aChipWiderThanTheRowGetsTheRowsWidthAndTheOthersKeepTheirOwn() {
    let chips = [text(80), text(2000), text(90), text(100)]
    let laid = FlowRows.layout(count: chips.count, width: 300, spacing: 4) { chips[$0]($1) }
    #expect(laid.size.width <= 300)
    #expect(laid.frames.allSatisfy { $0.maxX <= 300 })
    #expect(laid.frames.map(\.width) == [80, 300, 90, 100])
    // The font stack has a row of its own; the next two share one.
    #expect(laid.frames.map(\.minY) == [0, 20, 40, 40])
  }

  @Test func withNoWidthEveryChipSitsOnOneRowAtItsOwnSize() {
    let chips = [text(80), text(2000)]
    let laid = FlowRows.layout(count: chips.count, width: .infinity, spacing: 4) { chips[$0]($1) }
    #expect(laid.size == CGSize(width: 2084, height: 16))
    #expect(laid.frames.map(\.minY) == [0, 0])
  }

  @Test func inARowTheDetailsTakeWhatTheCropAndCloseLeave() {
    let crop = CGSize(width: 96, height: 54), close = CGSize(width: 24, height: 24)
    let laid = LiveAnnotateCardHeader.layout(width: 500, spacing: 10, stackBelow: 352, crop: crop, close: close, middle: text(2000, height: 120))
    #expect(laid.size == CGSize(width: 500, height: 120))
    #expect(laid.frames[1] == CGRect(x: 106, y: 0, width: 360, height: 120))
    #expect(laid.frames[2].maxX == 500)
  }

  @Test func narrowerThanTheThresholdTheCropAndCloseGoAboveTheDetails() {
    let crop = CGSize(width: 96, height: 54), close = CGSize(width: 24, height: 24)
    let laid = LiveAnnotateCardHeader.layout(width: 300, spacing: 10, stackBelow: 352, crop: crop, close: close, middle: text(2000, height: 120))
    #expect(laid.size == CGSize(width: 300, height: 54 + 10 + 120))
    #expect(laid.frames[0].origin == .zero)
    #expect(laid.frames[1] == CGRect(x: 0, y: 64, width: 300, height: 120))
    #expect(laid.frames[2] == CGRect(x: 276, y: 0, width: 24, height: 24))
  }

  @Test func askedForItsOwnSizeTheHeaderIsOneRow() {
    let crop = CGSize(width: 96, height: 54), close = CGSize(width: 24, height: 24)
    let laid = LiveAnnotateCardHeader.layout(width: nil, spacing: 10, stackBelow: 352, crop: crop, close: close, middle: text(200))
    #expect(laid.size == CGSize(width: 96 + 10 + 200 + 10 + 24, height: 54))
  }
}
