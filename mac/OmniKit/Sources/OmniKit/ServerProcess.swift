import Darwin
import Foundation

/// A server process the app started.
public struct SpawnedServer: Hashable, Sendable {
  public let pid: Int32
  /// Its process group, which is its pid.
  public let pgid: Int32
  /// Where this run's output starts in the log.
  public let logOffset: UInt64
}

/// Starts, watches and stops server processes.
public enum ServerProcess {
  /// Past this the log is moved to `server.log.1` before a start.
  static let logLimit: UInt64 = 10 << 20

  /// Starts the server in a process group of its own, stdin from /dev/null, stdout and stderr appended
  /// to `log`. Nothing ties it to the app: it keeps running when the app quits.
  public static func spawn(_ launch: ServerLaunch, log: URL) throws(ServerStartError) -> SpawnedServer {
    let fm = FileManager.default
    do {
      try fm.createDirectory(at: log.deletingLastPathComponent(), withIntermediateDirectories: true)
    } catch {
      throw .spawnFailed("cannot make the log folder \(log.deletingLastPathComponent().path)")
    }
    if let size = try? fm.attributesOfItem(atPath: log.path)[.size] as? UInt64, size > logLimit {
      let old = log.appendingPathExtension("1")
      try? fm.removeItem(at: old)
      try? fm.moveItem(at: log, to: old)
    }
    let command = ([launch.executable.path] + launch.arguments).joined(separator: " ")
    let header = "[omni-app] \(Date().formatted(.iso8601)) starting \(command) in \(launch.directory.path)\n"
    let offset = append(header, to: log)
    do {
      let pid = try Spawn.run(
        launch.executable.path, launch.arguments, environment: launch.environment, directory: launch.directory.path,
        stdout: .append(log.path), stderr: .stdout
      )
      return SpawnedServer(pid: pid, pgid: pid, logOffset: offset)
    } catch {
      throw .spawnFailed(error.message)
    }
  }

  /// The last lines of the log after `offset`, blank lines left out.
  public static func logTail(_ log: URL, from offset: UInt64 = 0, lines: Int = 40) -> [String] {
    guard let file = try? FileHandle(forReadingFrom: log) else { return [] }
    defer { try? file.close() }
    let end = (try? file.seekToEnd()) ?? 0
    // The last 64KB is plenty for 40 lines.
    let start = max(offset, end > 64 << 10 ? end - (64 << 10) : 0)
    guard start < end, (try? file.seek(toOffset: start)) != nil, let data = try? file.readToEnd() else { return [] }
    var all = String(decoding: data, as: UTF8.self).split(whereSeparator: \.isNewline).map(String.init)
    if start > offset, !all.isEmpty { all.removeFirst() }
    return Array(all.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.suffix(lines))
  }

  /// True while `pid` runs. A child of ours that exited is reaped.
  public static func isAlive(_ pid: Int32) -> Bool {
    guard pid > 0 else { return false }
    var status: Int32 = 0
    switch waitpid(pid, &status, WNOHANG) {
    case pid: return false
    case 0: return true
    default: return kill(pid, 0) == 0 || errno == EPERM
    }
  }

  /// When `pid` started, nil when there is no such process.
  public static func startTime(_ pid: Int32) -> Date? {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard pid > 0, proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
    return Date(timeIntervalSince1970: Double(info.pbi_start_tvsec) + Double(info.pbi_start_tvusec) / 1_000_000)
  }

  /// The process's name, like `node`.
  public static func name(_ pid: Int32) -> String? {
    var buffer = [UInt8](repeating: 0, count: 256)
    guard pid > 0, proc_name(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
    return String(decoding: buffer.prefix { $0 != 0 }, as: UTF8.self)
  }

  /// Polls until `pid` is gone. False at the timeout.
  public static func waitForExit(_ pid: Int32, within timeout: Duration) async -> Bool {
    let end = ContinuousClock.now + timeout
    while isAlive(pid) {
      guard ContinuousClock.now < end else { return false }
      try? await Task.sleep(for: .milliseconds(50))
    }
    return true
  }

  /// SIGTERM to the group, then SIGKILL to what is left of it after `grace`. True when the leader went on
  /// SIGTERM.
  @discardableResult
  public static func stop(pid: Int32, pgid: Int32, grace: Duration) async -> Bool {
    guard pgid > 1 else { return false }
    kill(-pgid, SIGTERM)
    let clean = await waitForExit(pid, within: grace)
    // Leftovers keep the group's id reserved, so this reaches no other program.
    kill(-pgid, SIGKILL)
    if !clean { _ = await waitForExit(pid, within: .seconds(2)) }
    return clean
  }

  /// Appends and returns the file's size after, creating the file when missing.
  private static func append(_ text: String, to url: URL) -> UInt64 {
    if !FileManager.default.fileExists(atPath: url.path) {
      FileManager.default.createFile(atPath: url.path, contents: nil)
    }
    guard let file = try? FileHandle(forWritingTo: url) else { return 0 }
    defer { try? file.close() }
    _ = try? file.seekToEnd()
    try? file.write(contentsOf: Data(text.utf8))
    return (try? file.offset()) ?? 0
  }
}
