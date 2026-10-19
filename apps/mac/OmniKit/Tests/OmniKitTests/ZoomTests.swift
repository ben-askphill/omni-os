import Foundation
import Testing
import OmniKit

@MainActor
@Suite struct ZoomTests {
  private func suite() -> UserDefaults { UserDefaults(suiteName: "zoom-\(UUID().uuidString)")! }

  @Test func startsAtActualSize() {
    let zoom = ZoomSettings(defaults: suite(), arguments: [:])
    #expect(zoom.scale == 1)
    #expect(zoom.isActualSize)
    #expect(zoom.label == "100%")
    #expect(!zoom.isVolatile)
  }

  @Test func stepsThroughTheLevelsAndStopsAtTheEnds() {
    let zoom = ZoomSettings(defaults: suite(), arguments: [:])
    var seen: [Double] = []
    while zoom.canZoomIn { zoom.zoomIn(); seen.append(zoom.scale) }
    #expect(seen == [1.1, 1.25, 1.4, 1.6])
    zoom.zoomIn()
    #expect(zoom.scale == 1.6)
    seen = []
    while zoom.canZoomOut { zoom.zoomOut(); seen.append(zoom.scale) }
    #expect(seen == [1.4, 1.25, 1.1, 1, 0.9, 0.8])
    zoom.zoomOut()
    #expect(zoom.scale == 0.8)
    zoom.actualSize()
    #expect(zoom.scale == 1)
  }

  @Test func keepsTheLevel() {
    let defaults = suite()
    let zoom = ZoomSettings(defaults: defaults, arguments: [:])
    zoom.zoomIn()
    zoom.zoomIn()
    #expect(defaults.double(forKey: ZoomSettings.Key.zoom) == 1.25)
    #expect(ZoomSettings(defaults: defaults, arguments: [:]).scale == 1.25)
  }

  @Test func snapsAValueBetweenLevels() {
    let defaults = suite()
    defaults.set(1.3, forKey: ZoomSettings.Key.zoom)
    #expect(ZoomSettings(defaults: defaults, arguments: [:]).scale == 1.25)
    defaults.set(9.0, forKey: ZoomSettings.Key.zoom)
    #expect(ZoomSettings(defaults: defaults, arguments: [:]).scale == 1.6)
    defaults.set("big", forKey: ZoomSettings.Key.zoom)
    #expect(ZoomSettings(defaults: defaults, arguments: [:]).scale == 1)
    let zoom = ZoomSettings(defaults: suite(), arguments: [:])
    zoom.scale = 0.85
    #expect(zoom.scale == 0.8 || zoom.scale == 0.9)
    zoom.scale = .nan
    #expect(zoom.scale == 1)
  }

  @Test func takesTheLaunchArgumentForTheRunAndSavesNothing() {
    let defaults = suite()
    defaults.set(0.9, forKey: ZoomSettings.Key.zoom)
    let zoom = ZoomSettings(defaults: defaults, arguments: ["zoom": "1.4"])
    #expect(zoom.scale == 1.4)
    #expect(zoom.isVolatile)
    zoom.zoomIn()
    #expect(defaults.double(forKey: ZoomSettings.Key.zoom) == 0.9)
  }

  @Test func labelsAsAPercentage() {
    #expect(ZoomSettings.levels.map(ZoomSettings.label) == ["80%", "90%", "100%", "110%", "125%", "140%", "160%"])
  }
}
