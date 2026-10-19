// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "OmniKit",
  platforms: [.macOS("27.0")],
  products: [.library(name: "OmniKit", targets: ["OmniKit"])],
  dependencies: [
    .package(url: "https://github.com/swiftlang/swift-markdown", from: "0.6.0"),
  ],
  targets: [
    .target(
      name: "OmniKit", dependencies: [.product(name: "Markdown", package: "swift-markdown")],
      resources: [.copy("Resources/slash-engine.js")]),
    .testTarget(name: "OmniKitTests", dependencies: ["OmniKit"], resources: [.copy("Fixtures")]),
  ]
)
