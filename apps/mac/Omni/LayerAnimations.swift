import SwiftUI

// Animations that run as long as something works: the Loader, the running dot's ping, the active plan step's pulse.
// A repeating SwiftUI animation (`TimelineView(.animation)`, `repeatForever`) updates the window's whole view graph
// every frame, so one on screen kept the app near half a core while threads ran. These draw their shapes once into
// layers and leave the motion to Core Animation, which runs it outside the app.

/// A `LayerAnimationView` in SwiftUI, filled with `color`. Still when Reduce Motion is on.
struct LayerAnimation<Layers: LayerAnimationView>: NSViewRepresentable {
  let color: Color

  func makeNSView(context: Context) -> Layers { Layers() }

  func updateNSView(_ view: Layers, context: Context) {
    view.update(color: color.resolve(in: context.environment).cgColor, moving: !context.environment.accessibilityReduceMotion)
  }
}

/// Subclasses add their layers in `init`, place them in `lay(out:)`, color them in `paint(_:)` and start their
/// animations in `animate()`.
class LayerAnimationView: NSView {
  private var moving = false

  required init() {
    super.init(frame: .zero)
    wantsLayer = true
    layer?.masksToBounds = false
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  final func update(color: CGColor, moving: Bool) {
    still { paint(color) }
    guard moving != self.moving else { return }
    self.moving = moving
    restart()
  }

  override func layout() {
    super.layout()
    still { lay(out: bounds) }
    restart()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    restart()
  }

  func lay(out bounds: CGRect) {}
  func paint(_ color: CGColor) {}
  /// The animated layers, so a restart can take their animations off.
  var animated: [CALayer] { [] }
  func animate() {}

  private func restart() {
    for l in animated { l.removeAllAnimations() }
    if moving, window != nil { animate() }
  }

  /// Changes without the layers' implicit animations.
  private func still(_ change: () -> Void) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    change()
    CATransaction.commit()
  }
}

/// Loader in brand.tsx: the ring, and the bead turning around it once every 1.6s.
final class LoaderLayers: LayerAnimationView {
  private let turn = CALayer()
  private let ring = CAShapeLayer()
  private let bead = CAShapeLayer()

  required init() {
    super.init()
    ring.fillColor = nil
    turn.addSublayer(ring)
    turn.addSublayer(bead)
    layer?.addSublayer(turn)
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  override func lay(out b: CGRect) {
    let s = b.width / 128
    for l in [turn, ring, bead] { l.frame = b }
    ring.lineWidth = 20 * s
    ring.path = CGPath(ellipseIn: CGRect(x: b.midX - 40 * s, y: b.midY - 40 * s, width: 80 * s, height: 80 * s), transform: nil)
    // Layers are y-up: the bead starts at the top.
    bead.path = CGPath(ellipseIn: CGRect(x: b.midX - 13 * s, y: b.midY + 41 * s, width: 26 * s, height: 26 * s), transform: nil)
  }

  override func paint(_ color: CGColor) {
    ring.strokeColor = color
    bead.fillColor = color
  }

  override var animated: [CALayer] { [turn] }

  override func animate() {
    let a = CABasicAnimation(keyPath: "transform.rotation.z")
    a.fromValue = 0
    a.toValue = -2 * Double.pi  // clockwise
    a.duration = 1.6
    a.repeatCount = .infinity
    turn.add(a, forKey: "turn")
  }
}

/// The running dot: a dot, and a copy of it that grows to 2.6x and fades, every 1.6s.
final class PingLayers: LayerAnimationView {
  private let ping = CAShapeLayer()
  private let dot = CAShapeLayer()

  required init() {
    super.init()
    ping.opacity = 0
    layer?.addSublayer(ping)
    layer?.addSublayer(dot)
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  override func lay(out b: CGRect) {
    for l in [ping, dot] {
      l.frame = b
      l.path = CGPath(ellipseIn: CGRect(origin: .zero, size: b.size), transform: nil)
    }
  }

  override func paint(_ color: CGColor) {
    ping.fillColor = color
    dot.fillColor = color
  }

  override var animated: [CALayer] { [ping] }

  override func animate() {
    let grow = CABasicAnimation(keyPath: "transform.scale")
    grow.fromValue = 1
    grow.toValue = 2.6
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 0.55
    fade.toValue = 0
    let g = CAAnimationGroup()
    g.animations = [grow, fade]
    g.duration = 1.6
    g.timingFunction = CAMediaTimingFunction(controlPoints: 0.22, 1, 0.36, 1)
    g.repeatCount = .infinity
    ping.add(g, forKey: "ping")
  }
}

/// The active plan step's dot: down to 45% and 0.82x and back, 0.7s each way.
final class PulseLayers: LayerAnimationView {
  private let dot = CAShapeLayer()

  required init() {
    super.init()
    layer?.addSublayer(dot)
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  override func lay(out b: CGRect) {
    dot.frame = b
    dot.path = CGPath(ellipseIn: CGRect(origin: .zero, size: b.size), transform: nil)
  }

  override func paint(_ color: CGColor) { dot.fillColor = color }

  override var animated: [CALayer] { [dot] }

  override func animate() {
    let shrink = CABasicAnimation(keyPath: "transform.scale")
    shrink.toValue = 0.82
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.toValue = 0.45
    let g = CAAnimationGroup()
    g.animations = [shrink, fade]
    g.duration = 0.7
    g.autoreverses = true
    g.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    g.repeatCount = .infinity
    dot.add(g, forKey: "pulse")
  }
}
