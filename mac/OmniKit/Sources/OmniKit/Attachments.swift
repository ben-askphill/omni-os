import Foundation

/// A file staged for the next message: from the paperclip, a drop or a paste.
public struct StagedFile: Hashable, Sendable, Identifiable {
  public let url: URL
  public let name: String
  public let size: Int
  public let modified: Date?
  /// A pasted screenshot written to a temp folder, deleted when it goes.
  public let isTemporary: Bool
  public var id: URL { url }

  public init(url: URL, name: String? = nil, size: Int, modified: Date? = nil, isTemporary: Bool = false) {
    self.url = url
    self.name = name ?? url.lastPathComponent
    self.size = size
    self.modified = modified
    self.isTemporary = isTemporary
  }

  /// nil for a folder or a file that can't be read.
  public static func at(_ url: URL) -> StagedFile? {
    guard let v = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey]),
      v.isRegularFile == true
    else { return nil }
    return StagedFile(url: url, size: v.fileSize ?? 0, modified: v.contentModificationDate)
  }

  public var isImage: Bool {
    ["png", "jpg", "jpeg", "gif", "webp", "heic", "tiff", "bmp"].contains(url.pathExtension.lowercased())
  }
}

public enum AttachmentRules {
  public static let maxFiles = 10
  public static let defaultMaxMB = 25.0

  /// Adds `incoming` to `existing` like `useAttachments` in Composer.tsx: empty and oversize files are left
  /// out, a file already staged is not added twice, and only the first ten stay. The error is the file-count
  /// message, else the size message, else nil.
  public static func add(_ existing: [StagedFile], incoming: [StagedFile], maxMB: Double) -> (files: [StagedFile], error: String?) {
    let limit = maxMB * 1024 * 1024
    let tooBig = incoming.filter { Double($0.size) > limit }
    var files = existing
    for f in incoming where Double(f.size) <= limit && f.size > 0 {
      if !files.contains(where: { $0.name == f.name && $0.size == f.size && $0.modified == f.modified }) { files.append(f) }
    }
    if files.count > maxFiles {
      return (Array(files.prefix(maxFiles)), "At most \(maxFiles) files per message.")
    }
    guard !tooBig.isEmpty else { return (files, nil) }
    let names = tooBig.map { "\"\($0.name)\"" }.joined(separator: ", ")
    return (files, "\(names) \(tooBig.count > 1 ? "are" : "is") over the \(megabytes(maxMB)) MB limit.")
  }

  /// A number as JavaScript prints it: 25, not 25.0.
  static func megabytes(_ mb: Double) -> String {
    mb == mb.rounded() ? String(Int(mb)) : String(mb)
  }
}
