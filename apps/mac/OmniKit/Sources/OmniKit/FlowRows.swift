import CoreGraphics

/// Where the app's `Flow` layout puts its views: in rows that wrap at `width`, each at its own size, except a view wider
/// than a whole row, which gets the row's width so its text truncates instead of widening every row around it (a style
/// chip holding a long font stack).
public enum FlowRows {
  /// The frames of `count` views, from the top left. `measure(i, w)` is view `i`'s size when offered `w` points across,
  /// or its own size for nil. An infinite `width` lays every view on one row.
  public static func layout(count: Int, width: CGFloat, spacing: CGFloat, measure: (Int, CGFloat?) -> CGSize) -> (size: CGSize, frames: [CGRect]) {
    var frames: [CGRect] = []
    var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
    for i in 0..<count {
      var size = measure(i, nil)
      if size.width > width { size = measure(i, width) }
      if x > 0, x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
      frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
      x += size.width + spacing
      rowHeight = max(rowHeight, size.height)
      maxX = max(maxX, x - spacing)
    }
    return (CGSize(width: maxX, height: y + rowHeight), frames)
  }
}
