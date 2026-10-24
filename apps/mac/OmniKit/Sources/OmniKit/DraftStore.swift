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

  /// A draft saved as JSON, or nil when there is none or it does not decode.
  public func value<T: Decodable>(_ type: T.Type, for key: String) -> T? {
    let text = text(for: key)
    guard !text.isEmpty else { return nil }
    return try? OmniJSON.decoder().decode(T.self, from: Data(text.utf8))
  }

  /// Saves the value as JSON; nil removes the draft.
  public func save(json value: (some Encodable)?, for key: String) {
    let data = value.flatMap { try? OmniJSON.encoder().encode($0) }
    save(data.map { String(decoding: $0, as: UTF8.self) } ?? "", for: key)
  }

  private func file(_ key: String) -> URL {
    let safe = key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "draft"
    return directory.appending(path: safe + ".txt")
  }
}
