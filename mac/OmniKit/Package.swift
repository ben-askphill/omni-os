// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "OmniKit",
  platforms: [.macOS("27.0")],
  products: [.library(name: "OmniKit", targets: ["OmniKit"])],
  targets: [
    .target(name: "OmniKit"),
    .testTarget(name: "OmniKitTests", dependencies: ["OmniKit"], resources: [.copy("Fixtures")]),
  ]
)
