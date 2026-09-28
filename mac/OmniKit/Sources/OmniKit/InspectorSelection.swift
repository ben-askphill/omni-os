import Foundation

/// Which tab of the thread inspector shows and which artifact it opens, by the Web UI's rules
/// (ThreadPage in web/src/pages/Thread.tsx), with its first-artifact quirk fixed.
public struct InspectorSelection: Equatable, Sendable {
  public enum Tab: String, CaseIterable, Sendable {
    case artifacts, browser, details

    public var title: String {
      switch self {
      case .artifacts: "Artifacts"
      case .browser: "Browser"
      case .details: "Details"
      }
    }
  }

  public var tab: Tab
  public var artifactID: Int?

  public init(tab: Tab, artifactID: Int? = nil) {
    self.tab = tab
    self.artifactID = artifactID
  }

  /// When the thread opens: `?artifact` wins, else the newest HTML page, else the newest file, else Details.
  public static func initial(artifacts: [Artifact], param: Int? = nil) -> Self {
    if let param { return Self(tab: .artifacts, artifactID: param) }
    if let pick = defaultArtifact(artifacts) { return Self(tab: .artifacts, artifactID: pick.id) }
    return Self(tab: .details)
  }

  /// A new HTML artifact is selected and shown, the first one too.
  public mutating func arrived(_ a: Artifact) {
    tab = .artifacts
    artifactID = a.id
  }

  public mutating func open(artifact id: Int) {
    tab = .artifacts
    artifactID = id
  }

  /// The selected file, else the newest one when the selection is gone or was never made.
  public func shown(in artifacts: [Artifact]) -> Artifact? {
    let files = artifacts.filter { $0.kind != "screenshot" }
    return files.first { $0.id == artifactID } ?? files.last
  }

  static func defaultArtifact(_ artifacts: [Artifact]) -> Artifact? {
    let files = artifacts.filter { $0.kind != "screenshot" }
    return files.last { $0.kind == "html" } ?? files.last
  }
}
