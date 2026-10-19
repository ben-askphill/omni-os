import Foundation
import Testing
import OmniKit

@MainActor
@Suite struct AppearanceTests {
  private func suite() -> UserDefaults { UserDefaults(suiteName: "appearance-\(UUID().uuidString)")! }

  @Test func followsTheSystemAtFirst() {
    let settings = AppearanceSettings(defaults: suite(), arguments: [:])
    #expect(settings.appearance == .system)
    #expect(!settings.isVolatile)
  }

  @Test func keepsTheChoice() {
    let defaults = suite()
    let settings = AppearanceSettings(defaults: defaults, arguments: [:])
    settings.appearance = .dark
    #expect(defaults.string(forKey: AppearanceSettings.Key.appearance) == "dark")
    #expect(AppearanceSettings(defaults: defaults, arguments: [:]).appearance == .dark)
    settings.appearance = .system
    #expect(AppearanceSettings(defaults: defaults, arguments: [:]).appearance == .system)
  }

  @Test func ignoresAValueItDoesNotKnow() {
    let defaults = suite()
    defaults.set("sepia", forKey: AppearanceSettings.Key.appearance)
    #expect(AppearanceSettings(defaults: defaults, arguments: [:]).appearance == .system)
    #expect(AppearanceSettings(defaults: suite(), arguments: ["appearance": 3]).appearance == .system)
  }

  @Test func takesTheLaunchArgumentForTheRunAndSavesNothing() {
    let defaults = suite()
    defaults.set("dark", forKey: AppearanceSettings.Key.appearance)
    let settings = AppearanceSettings(defaults: defaults, arguments: ["appearance": "light"])
    #expect(settings.appearance == .light)
    #expect(settings.isVolatile)
    settings.appearance = .system
    #expect(defaults.string(forKey: AppearanceSettings.Key.appearance) == "dark")
  }

  @Test func appliesAtOnce() {
    let settings = AppearanceSettings(defaults: suite(), arguments: [:])
    var applied: [Appearance] = []
    settings.follow { applied.append($0) }
    #expect(applied == [.system])
    settings.appearance = .dark
    #expect(applied == [.system, .dark], "in the same call, not on a later turn")
    settings.appearance = .light
    #expect(applied == [.system, .dark, .light])
  }

  @Test func namesTheChoicesLikeTheWebUI() {
    #expect(Appearance.allCases == [.system, .light, .dark])
    #expect(Appearance.allCases.map(\.label) == ["Match system", "Light", "Dark"])
    #expect(Appearance.allCases.map(\.rawValue) == ["system", "light", "dark"])
  }
}
