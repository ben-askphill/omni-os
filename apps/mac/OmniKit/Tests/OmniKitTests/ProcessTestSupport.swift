import Darwin
import Foundation
import Testing
import OmniKit

/// A throwaway folder under TMPDIR, removed by `remove()`.
struct TempDir {
  let url: URL

  init(_ name: String = "omnikit") {
    url = FileManager.default.temporaryDirectory.appending(path: "\(name)-\(UUID().uuidString.prefix(8))")
    try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  }

  func path(_ sub: String) -> URL { url.appending(path: sub) }

  /// Writes an executable `#!/bin/sh` script.
  @discardableResult
  func script(_ sub: String, _ body: String) -> URL {
    let file = path(sub)
    try! FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try! ("#!/bin/sh\n" + body).write(to: file, atomically: true, encoding: .utf8)
    chmod(file.path, 0o755)
    return file
  }

  func write(_ sub: String, _ text: String = "") {
    let file = path(sub)
    try! FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try! text.write(to: file, atomically: true, encoding: .utf8)
  }

  func read(_ sub: String) -> String { (try? String(contentsOf: path(sub), encoding: .utf8)) ?? "" }

  func remove() { try? FileManager.default.removeItem(at: url) }
}

/// A login shell stand-in: prints junk, exports what a stale zshrc would, then runs the command it is given
/// the way `zsh -ilc <command>` does.
func fakeLoginShell(in dir: TempDir, path: String, name: String = "fake-zsh") -> URL {
  dir.script(name, """
    echo "Last login: yesterday"
    echo "PATH=/not/this/one"
    export ANTHROPIC_API_KEY=sk-ant-stale-from-zshrc
    export OPENAI_API_KEY=sk-openai-stale
    export PATH='\(path)'
    [ "$1" = "-ilc" ] || { echo "called without -ilc: $1"; exit 2; }
    eval "$2"
    echo "zsh: bye"
    """)
}

/// A Node stand-in: `-v` prints the version; anything else runs `body`.
func fakeNode(in dir: TempDir, _ sub: String, version: String = "v24.2.0", body: String = "exit 0") -> URL {
  dir.script(sub, """
    if [ "$1" = "-v" ]; then echo \(version); exit 0; fi
    \(body)
    """)
}

/// A port nothing listens on right now.
func freePort() -> Int {
  let fd = socket(AF_INET, SOCK_STREAM, 0)
  defer { close(fd) }
  var addr = sockaddr_in()
  addr.sin_family = sa_family_t(AF_INET)
  addr.sin_addr.s_addr = inet_addr("127.0.0.1")
  addr.sin_port = 0
  var len = socklen_t(MemoryLayout<sockaddr_in>.size)
  withUnsafeMutablePointer(to: &addr) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
      _ = bind(fd, $0, len)
      _ = getsockname(fd, $0, &len)
    }
  }
  return Int(UInt16(bigEndian: addr.sin_port))
}

/// A TCP listener that accepts connections and never answers, like a hung program on the port.
final class SilentListener {
  let port: Int
  let descriptor: Int32

  /// - Parameter port: 0 for any free port.
  init(port: Int = 0) {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    var yes: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    addr.sin_port = in_port_t(UInt16(port).bigEndian)
    var len = socklen_t(MemoryLayout<sockaddr_in>.size)
    withUnsafeMutablePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        precondition(bind(fd, $0, len) == 0)
        _ = getsockname(fd, $0, &len)
      }
    }
    precondition(listen(fd, 16) == 0)
    descriptor = fd
    self.port = Int(UInt16(bigEndian: addr.sin_port))
  }

  func close() { Darwin.close(descriptor) }
}

/// The path with every symlink resolved, like `pwd -P`. Unlike `resolvingSymlinksInPath`, keeps /private.
func realPath(_ url: URL) -> String {
  guard let p = realpath(url.path, nil) else { return url.path }
  defer { free(p) }
  return String(cString: p)
}

func processAlive(_ pid: Int32) -> Bool {
  var status: Int32 = 0
  if waitpid(pid, &status, WNOHANG) == pid { return false }
  return kill(pid, 0) == 0 || errno == EPERM
}

/// Kills a process group for good, for test cleanup.
func killGroup(_ pgid: Int32) {
  guard pgid > 1 else { return }
  kill(-pgid, SIGKILL)
  var status: Int32 = 0
  for _ in 0..<200 where waitpid(pgid, &status, WNOHANG) == 0 {
    usleep(10_000)
  }
}

/// The environment of a running process, as `ps -E` shows it.
func environmentOf(_ pid: Int32) -> String {
  let p = Process()
  p.executableURL = URL(filePath: "/bin/ps")
  p.arguments = ["-wwE", "-o", "command=", "-p", String(pid)]
  let out = Pipe()
  p.standardOutput = out
  try? p.run()
  let data = out.fileHandleForReading.readDataToEndOfFile()
  p.waitUntilExit()
  return String(decoding: data, as: UTF8.self)
}

/// A one-trick HTTP server on 127.0.0.1: every request gets the same answer.
final class HTTPResponder: Sendable {
  let port: Int
  private let fd: Int32

  init(port: Int = 0, status: Int = 200, contentType: String, body: String) {
    let listener = SilentListener(port: port)
    self.port = listener.port
    fd = listener.descriptor
    let response = "HTTP/1.1 \(status) OK\r\nContent-Type: \(contentType)\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
    let fd = self.fd
    Thread.detachNewThread {
      while true {
        let conn = accept(fd, nil, nil)
        guard conn >= 0 else { return }
        var buffer = [UInt8](repeating: 0, count: 8192)
        var request = [UInt8]()
        while !request.ends(with: Array("\r\n\r\n".utf8)) {
          let n = read(conn, &buffer, buffer.count)
          guard n > 0 else { break }
          request += buffer[0..<n]
        }
        _ = response.withCString { write(conn, $0, strlen($0)) }
        Darwin.close(conn)
      }
    }
  }

  func close() {
    shutdown(fd, SHUT_RDWR)
    Darwin.close(fd)
  }
}

extension Array where Element: Equatable {
  fileprivate func ends(with suffix: [Element]) -> Bool { count >= suffix.count && Array(self[(count - suffix.count)...]) == suffix }
}
