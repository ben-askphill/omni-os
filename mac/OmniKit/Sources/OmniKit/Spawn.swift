import Darwin
import Foundation

/// posix_spawn with the child in a session of its own, so it has no controlling terminal and its pgid is its
/// pid. Also stdin from /dev/null, default signal handling, and none of this process's descriptors but the
/// ones set here. With only a group of its own, a child that claims the app's terminal (zsh -i does) would be
/// stopped by SIGTTOU when the app runs from one.
enum Spawn {
  enum Output {
    case null
    /// Appends to the file, created if missing.
    case append(String)
    case descriptor(Int32)
    /// stderr only: wherever stdout goes.
    case stdout
  }

  struct Failure: Error {
    let code: Int32
    var message: String { String(cString: strerror(code)) }
  }

  static func run(
    _ executable: String, _ arguments: [String], environment: [String: String], directory: String? = nil,
    stdout: Output, stderr: Output
  ) throws(Failure) -> pid_t {
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)
    defer { posix_spawnattr_destroy(&attr) }
    posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETSID | POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK))
    var all = sigset_t()
    sigfillset(&all)
    sigdelset(&all, SIGKILL)
    sigdelset(&all, SIGSTOP)
    posix_spawnattr_setsigdefault(&attr, &all)
    var none = sigset_t()
    sigemptyset(&none)
    posix_spawnattr_setsigmask(&attr, &none)

    var actions: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&actions)
    defer { posix_spawn_file_actions_destroy(&actions) }
    posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0)
    for (fd, output) in [(Int32(1), stdout), (2, stderr)] {
      switch output {
      case .null: posix_spawn_file_actions_addopen(&actions, fd, "/dev/null", O_WRONLY, 0)
      case .append(let path): posix_spawn_file_actions_addopen(&actions, fd, path, O_WRONLY | O_CREAT | O_APPEND, 0o644)
      case .descriptor(let source): posix_spawn_file_actions_adddup2(&actions, source, fd)
      case .stdout: posix_spawn_file_actions_adddup2(&actions, 1, fd)
      }
    }
    if let directory { posix_spawn_file_actions_addchdir(&actions, directory) }

    let argv = ([executable] + arguments).map { strdup($0) } + [nil]
    let envp = environment.sorted { $0.key < $1.key }.map { strdup("\($0.key)=\($0.value)") } + [nil]
    defer { (argv + envp).forEach { free($0) } }
    var pid: pid_t = 0
    let rc = posix_spawn(&pid, executable, &actions, &attr, argv, envp)
    guard rc == 0 else { throw Failure(code: rc) }
    return pid
  }

  struct Captured: Sendable {
    let output: Data
    /// The exit code. nil when it was killed, by a signal or at the timeout.
    let status: Int32?
  }

  /// Runs a program to its end and collects its stdout, stderr dropped. At the timeout the whole group is
  /// killed, so a helper it started that holds stdout can't keep this waiting. nil when it can't start.
  static func capture(_ executable: String, _ arguments: [String], environment: [String: String], timeout: Duration) async -> Captured? {
    await withCheckedContinuation { c in
      DispatchQueue.global().async {
        c.resume(returning: captureNow(executable, arguments, environment: environment, timeout: timeout))
      }
    }
  }

  private static func captureNow(_ executable: String, _ arguments: [String], environment: [String: String], timeout: Duration) -> Captured? {
    var fds: [Int32] = [0, 0]
    guard pipe(&fds) == 0 else { return nil }
    let (reader, writer) = (fds[0], fds[1])
    defer { close(reader) }
    let pid: pid_t
    do {
      pid = try run(executable, arguments, environment: environment, stdout: .descriptor(writer), stderr: .null)
    } catch {
      close(writer)
      return nil
    }
    close(writer)

    let deadline = ContinuousClock.now + timeout
    func left() -> Int32 {
      let d = deadline - ContinuousClock.now
      return d <= .zero ? 0 : Int32(clamping: d.components.seconds * 1000 + d.components.attoseconds / 1_000_000_000_000_000 + 1)
    }
    // Until EOF, or until it exits: a helper it started may hold stdout open long after.
    var output = Data()
    var buffer = [UInt8](repeating: 0, count: 16 * 1024)
    var exited = false
    while left() > 0 {
      var p = pollfd(fd: reader, events: Int16(POLLIN), revents: 0)
      let ready = poll(&p, 1, exited ? 0 : min(left(), 50))
      if ready < 0 && errno != EINTR { break }
      if ready > 0 {
        let n = read(reader, &buffer, buffer.count)
        if n > 0 {
          output.append(buffer, count: n)
          continue
        }
        if n == 0 || (errno != EINTR && errno != EAGAIN) { break }
      } else if exited {
        break
      }
      if !exited { exited = hasExited(pid) }
    }
    while !exited, left() > 0 {
      usleep(5_000)
      exited = hasExited(pid)
    }

    // Leftovers of the group go too. Before the leader is reaped its pid can't be reused, so the group
    // signalled is ours.
    kill(-pid, SIGKILL)
    let status = reap(pid)
    return Captured(output: output, status: exited ? status : nil)
  }

  /// True once `pid`, a child of ours, has exited. It is not reaped. Darwin's waitid also reports a child that
  /// is only stopped, so the code is checked: a stopped one has not exited, and reaping it would block.
  static func hasExited(_ pid: pid_t) -> Bool {
    var info = siginfo_t()
    return waitid(P_PID, id_t(pid), &info, WEXITED | WNOHANG | WNOWAIT) == 0 && info.si_pid == pid
      && [CLD_EXITED, CLD_KILLED, CLD_DUMPED].contains(info.si_code)
  }

  /// Waits for a child of ours and returns its exit code, nil when a signal ended it. It blocks, so call it only
  /// once `hasExited` says so or after a SIGKILL.
  @discardableResult
  static func reap(_ pid: pid_t) -> Int32? {
    var status: Int32 = 0
    while waitpid(pid, &status, 0) < 0 {
      guard errno == EINTR else { return nil }
    }
    return status & 0x7f == 0 ? (status >> 8) & 0xff : nil
  }
}
