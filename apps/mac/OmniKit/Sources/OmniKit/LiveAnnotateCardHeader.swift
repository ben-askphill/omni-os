import CoreGraphics

/// The top of live Annotate's card on the Mac (`BrowserLiveAnnotateLayer`), from three views: the capture's crop, what was
/// marked and Close. In a row, the middle one takes what the other two leave. Narrower than `stackBelow`, the crop and
/// Close sit above it and it gets the whole width, as `@max-[22rem]` stacks the web card. Either way the middle is offered
/// the card's width, never asked how wide it would like to be, so a long selector or style truncates inside it.
public enum LiveAnnotateCardHeader {
  /// The crop's, the middle's and Close's frames, in that order, from the top left. `middle(w)` is its size when offered
  /// `w` points across, or its own size for nil. A nil or infinite `width` asks for the header's own size: one row.
  public static func layout(
    width proposed: CGFloat?, spacing: CGFloat, stackBelow: CGFloat, crop: CGSize, close: CGSize, middle: (CGFloat?) -> CGSize
  ) -> (size: CGSize, frames: [CGRect]) {
    let width = proposed.flatMap { $0.isFinite ? $0 : nil }
    if let width, width < stackBelow {
      let top = max(crop.height, close.height)
      let mid = middle(width)
      return (
        CGSize(width: width, height: top + spacing + mid.height),
        [
          CGRect(origin: .zero, size: crop),
          CGRect(x: 0, y: top + spacing, width: width, height: mid.height),
          CGRect(origin: CGPoint(x: width - close.width, y: 0), size: close),
        ])
    }
    let room = width.map { max(0, $0 - crop.width - close.width - 2 * spacing) }
    let mid = middle(room)
    let whole = width ?? crop.width + mid.width + close.width + 2 * spacing
    return (
      CGSize(width: whole, height: max(crop.height, mid.height, close.height)),
      [
        CGRect(origin: .zero, size: crop),
        CGRect(x: crop.width + spacing, y: 0, width: room ?? mid.width, height: mid.height),
        CGRect(origin: CGPoint(x: whole - close.width, y: 0), size: close),
      ])
  }
}
