import Foundation

/// Unsent reply text, one file per key, so a draft survives a relaunch. Keys look like `reply:<thread id>`.
public struct DraftStore: Sendable {
  public let directory: URL

  public init(directory: URL) {
    self.directory = directory
  }

  /// `~/Library/Application Support/Omni/Drafts`.
  public static var standard: DraftStore {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    return DraftStore(directory: base.appending(path: "Omni/Drafts", directoryHint: .isDirectory))
  }

  public func text(for key: String) -> String {
    (try? String(contentsOf: file(key), encoding: .utf8)) ?? ""
  }

  /// Saves the text; empty text removes the draft.
  public func save(_ text: String, for key: String) {
    let url = file(key)
    guard !text.isEmpty else {
      try? FileManager.default.removeItem(at: url)
      return
    }
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try? text.write(to: url, atomically: true, encoding: .utf8)
  }

  private func file(_ key: String) -> URL {
    let safe = key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "draft"
    return directory.appending(path: safe + ".txt")
  }
}
