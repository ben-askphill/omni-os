import Darwin
import Foundation
import Testing
import OmniKit

/// What a GUI app gets from launchd, plus keys a stale shell or app could leak.
private let appEnvironment = [
  "HOME": NSHomeDirectory(), "USER": NSUserName(), "LOGNAME": NSUserName(), "SHELL": "/bin/zsh",
  "TMPDIR": NSTemporaryDirectory(), "LANG": "en_GB.UTF-8",
  "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "ANTHROPIC_API_KEY": "sk-ant-from-the-app", "XPC_SERVICE_NAME": "application.com.omni-os.mac",
]

struct LoginShellTests {
  @Test func readsPathPastTheJunk() async {
    let dir = TempDir("login-shell")
    defer { dir.remove() }
    let shell = LoginShell(executable: fakeLoginShell(in: dir, path: "/login/bin:/usr/bin:/bin"))
    #expect(await shell.path() == "/login/bin:/usr/bin:/bin")
  }

  @Test func isNotFooledByAShellThatEchoesTheCommand() async {
    let dir = TempDir("login-shell")
    defer { dir.remove() }
    let exe = dir.script("echo-zsh", """
      export PATH='/login/bin:/bin'
      echo "+ $2"
      eval "$2"
      """)
    #expect(await LoginShell(executable: exe).path() == "/login/bin:/bin")
  }

  @Test func givesNothingWhenTheShellPrintsNoPath() async {
    let dir = TempDir("login-shell")
    defer { dir.remove() }
    let exe = dir.script("broken-zsh", "echo 'zsh: command not found: nvm'\nexit 1\n")
    #expect(await LoginShell(executable: exe).path() == nil)
  }

  @Test func givesUpAtTheTimeoutAndKillsTheShell() async throws {
    let dir = TempDir("login-shell")
    defer { dir.remove() }
    // A zshrc that hangs, with a helper holding stdout open.
    let exe = dir.script("slow-zsh", """
      sleep 30 &
      echo $! > '\(dir.path("helper.pid").path)'
      echo $$ > '\(dir.path("shell.pid").path)'
      wait
      """)
    let start = ContinuousClock.now
    #expect(await LoginShell(executable: exe, timeout: .milliseconds(500)).path() == nil)
    #expect(ContinuousClock.now - start < .seconds(3))
    for file in ["shell.pid", "helper.pid"] {
      let pid = try #require(Int32(dir.read(file).trimmingCharacters(in: .whitespacesAndNewlines)))
      try await eventually("\(file) gone") { !processAlive(pid) }
    }
  }

  @Test func runsTheShellWithoutATerminal() async {
    let dir = TempDir("login-shell")
    defer { dir.remove() }
    // zsh -i claims the app's terminal from a background group, and SIGTTOU stops it before any rc file runs.
    let exe = dir.script("tty-zsh", """
      if (exec 3</dev/tty) 2>/dev/null; then echo 'has a terminal'; exit 1; fi
      export PATH='/login/bin:/bin'
      eval "$2"
      """)
    #expect(await LoginShell(executable: exe).path() == "/login/bin:/bin")
  }

  @Test func startsTheShellWithTheMinimalEnvironment() async {
    let dir = TempDir("login-shell")
    defer { dir.remove() }
    let exe = dir.script("env-zsh", "env > '\(dir.path("env.txt").path)'\neval \"$2\"\n")
    _ = await LoginShell(executable: exe, environment: appEnvironment).path()
    let seen = dir.read("env.txt")
    #expect(seen.contains("HOME=\(NSHomeDirectory())"))
    #expect(!seen.contains("ANTHROPIC_API_KEY"))
    #expect(!seen.contains("XPC_SERVICE_NAME"))
  }
}

struct NodeResolverTests {
  let dir = TempDir("node")

  private func resolver(override: URL? = nil) -> NodeResolver {
    NodeResolver(override: override, nvmVersions: dir.path("nvm/versions/node"))
  }

  private func nvm(_ version: String, reports: String? = nil) {
    _ = fakeNode(in: dir, "nvm/versions/node/\(version)/bin/node", version: reports ?? version)
  }

  @Test func theOverrideWins() async throws {
    defer { dir.remove() }
    nvm("v26.0.0")
    let node = fakeNode(in: dir, "custom/node", version: "v25.0.1")
    let found = try await resolver(override: node).resolve(path: "/usr/bin:/bin")
    #expect(found.binary == node)
    #expect(found.version.description == "v25.0.1")
  }

  @Test func anOverrideThatDoesNotRunIsAnError() async {
    defer { dir.remove() }
    nvm("v26.0.0")
    let missing = dir.path("nope/node")
    await #expect(throws: ServerStartError.nodeUnusable(path: missing.path)) {
      try await resolver(override: missing).resolve(path: "/usr/bin:/bin")
    }
  }

  @Test func anOverrideOlderThan24IsAnError() async {
    defer { dir.remove() }
    let old = fakeNode(in: dir, "old/node", version: "v22.3.0")
    await #expect(throws: ServerStartError.nodeTooOld(path: old.path, version: "v22.3.0")) {
      try await resolver(override: old).resolve(path: "/usr/bin:/bin")
    }
  }

  @Test func picksTheHighestNvmNode() async throws {
    defer { dir.remove() }
    for v in ["v22.9.0", "v24.14.1", "v25.1.0", "v25.0.9"] { nvm(v) }
    dir.write("nvm/versions/node/.DS_Store")
    let found = try await resolver().resolve(path: "/usr/bin:/bin")
    #expect(found.binary == dir.path("nvm/versions/node/v25.1.0/bin/node"))
    #expect(found.version == NodeVersion("v25.1.0"))
  }

  @Test func fallsBackToNodeOnThePath() async throws {
    defer { dir.remove() }
    nvm("v22.9.0")
    let node = fakeNode(in: dir, "brew/bin/node", version: "v24.0.1")
    let found = try await resolver().resolve(path: "/nowhere:\(dir.path("brew/bin").path):/usr/bin")
    #expect(found.binary == node)
  }

  @Test func goesByTheVersionTheBinaryReports() async throws {
    defer { dir.remove() }
    nvm("v25.0.0", reports: "v20.1.0")
    let node = fakeNode(in: dir, "brew/bin/node", version: "v24.0.1")
    let found = try await resolver().resolve(path: dir.path("brew/bin").path)
    #expect(found.binary == node)
  }

  @Test func saysWhenOnlyAnOlderNodeIsThere() async {
    defer { dir.remove() }
    nvm("v22.9.0")
    await #expect(throws: ServerStartError.nodeTooOld(path: dir.path("nvm/versions/node/v22.9.0/bin/node").path, version: "v22.9.0")) {
      try await resolver().resolve(path: "/nowhere")
    }
  }

  @Test func saysWhenThereIsNoNode() async {
    defer { dir.remove() }
    await #expect(throws: ServerStartError.nodeNotFound) {
      try await resolver().resolve(path: "/nowhere")
    }
  }

  @Test func parsesVersions() {
    #expect(NodeVersion("v24.14.1") == NodeVersion(major: 24, minor: 14, patch: 1))
    #expect(NodeVersion("v25.0.0-nightly2026")?.major == 25)
    #expect(NodeVersion("24") == nil)
    #expect(NodeVersion("v24.2.0")! < NodeVersion("v24.10.0")!)
  }
}

struct ServerStartErrorTests {
  @Test func aForeignServersDetailIsASentence() {
    let bare = ServerStartError.notOmni(port: 4758, detail: "Request failed (404)").message
    #expect(bare == "Port 4758 answers, but not as an Omni server: Request failed (404). Stop that program, or pick another port in Settings.")
    let stopped = ServerStartError.notOmni(port: 4758, detail: "It said no.").message
    #expect(stopped.contains("It said no. Stop that program"))
  }
}

struct ServerEnvironmentTests {
  @Test func passesOnlyTheMinimalEnvironment() {
    let env = ServerEnvironment.child(app: appEnvironment, path: "/node/bin:/login/bin", port: 4757)
    #expect(env == [
      "HOME": NSHomeDirectory(), "USER": NSUserName(), "LOGNAME": NSUserName(), "SHELL": "/bin/zsh",
      "TMPDIR": NSTemporaryDirectory(), "LANG": "en_GB.UTF-8",
      "PATH": "/node/bin:/login/bin", "NODE_ENV": "production", "NODE_OPTIONS": "--disable-warning=ExperimentalWarning",
      "OMNI_PORT": "4757",
    ])
  }

  @Test func neverPassesAPIKeys() {
    let env = ServerEnvironment.child(
      app: appEnvironment, path: "/bin", port: 4757,
      extra: ["OMNI_DATA_DIR": "/tmp/data", "ANTHROPIC_API_KEY": "sk", "ANTHROPIC_AUTH_TOKEN": "t", "OPENAI_API_KEY": "sk", "CURSOR_API_KEY": "k"]
    )
    #expect(env["OMNI_DATA_DIR"] == "/tmp/data")
    #expect(!env.keys.contains { $0.hasPrefix("ANTHROPIC_") || $0.hasSuffix("_API_KEY") || $0.hasSuffix("_AUTH_TOKEN") })
  }

  @Test func putsNodesFolderFirstOnThePath() {
    let node = URL(filePath: "/n/bin/node")
    #expect(ServerEnvironment.path(node: node, loginPath: "/a:/n/bin:/b::/a") == "/n/bin:/a:/b")
  }
}

struct ServerLauncherTests {
  let dir = TempDir("launch")

  /// A checkout with what the launcher checks for.
  private func repo() -> URL {
    dir.write("repo/server/index.ts", "// the server")
    dir.write("repo/node_modules/tsx/package.json", "{}")
    return dir.path("repo")
  }

  @Test func theServerGetsPathFromTheLoginShellAndNothingElse() async throws {
    defer { dir.remove() }
    let shell = LoginShell(executable: fakeLoginShell(in: dir, path: "/login/bin:/usr/bin:/bin"), environment: appEnvironment)
    // Stands in for the server: dumps what it was given into the log.
    let node = fakeNode(in: dir, "node/bin/node", body: """
      echo "args: $*"
      echo "cwd: $(pwd -P)"
      echo "pid: $$ pgid: $(/bin/ps -o pgid= -p $$ | tr -d ' ')"
      if read line; then echo "stdin: $line"; else echo "stdin: eof"; fi
      /usr/bin/env
      """)
    let launcher = ServerLauncher(
      loginShell: shell, nvmVersions: dir.path("no-nvm"), appEnvironment: appEnvironment, extraEnvironment: ["OMNI_DATA_DIR": "/tmp/omni-data"]
    )
    let launch = try await launcher.prepare(ServerConfig(port: 4757, repo: repo(), node: node))
    #expect(launch.executable == node)
    #expect(launch.directory == dir.path("repo"))

    let log = dir.path("logs/server.log")
    let server = try ServerProcess.spawn(launch, log: log)
    defer { killGroup(server.pgid) }
    try await eventually("the fake server to exit", within: .seconds(5)) { !processAlive(server.pid) }

    let out = dir.read("logs/server.log")
    let lines = Set(out.split(separator: "\n").map(String.init))
    #expect(lines.contains("args: --import tsx server/index.ts"))
    #expect(lines.contains("cwd: \(realPath(dir.path("repo")))"))
    #expect(lines.contains("pid: \(server.pid) pgid: \(server.pid)"))
    #expect(server.pgid == server.pid)
    #expect(lines.contains("stdin: eof"))
    #expect(lines.contains("PATH=\(dir.path("node/bin").path):/login/bin:/usr/bin:/bin"))
    #expect(lines.contains("NODE_ENV=production"))
    #expect(lines.contains("NODE_OPTIONS=--disable-warning=ExperimentalWarning"))
    #expect(lines.contains("OMNI_PORT=4757"))
    #expect(lines.contains("OMNI_DATA_DIR=/tmp/omni-data"))
    #expect(!out.contains("API_KEY"), "no key from the login shell or the app")
    #expect(!out.contains("XPC_SERVICE_NAME"))
  }

  @Test func fallsBackToADefaultPath() async throws {
    defer { dir.remove() }
    let broken = dir.script("broken-zsh", "exit 1\n")
    let node = fakeNode(in: dir, "node/bin/node")
    let launcher = ServerLauncher(loginShell: LoginShell(executable: broken), nvmVersions: dir.path("no-nvm"), appEnvironment: appEnvironment)
    let launch = try await launcher.prepare(ServerConfig(port: 4757, repo: repo(), node: node))
    let path = try #require(launch.environment["PATH"]).split(separator: ":").map(String.init)
    #expect(path.first == dir.path("node/bin").path)
    #expect(path.contains("/opt/homebrew/bin"))
    #expect(path.contains("/usr/bin"))
  }

  @Test func needsACheckoutWithItsDependencies() async throws {
    defer { dir.remove() }
    let node = fakeNode(in: dir, "node/bin/node")
    let shell = LoginShell(executable: fakeLoginShell(in: dir, path: "/usr/bin:/bin"))
    let launcher = ServerLauncher(loginShell: shell, nvmVersions: dir.path("no-nvm"), appEnvironment: appEnvironment)

    let missing = dir.path("nowhere")
    await #expect(throws: ServerStartError.repoMissing(path: missing.path)) {
      try await launcher.prepare(ServerConfig(port: 4757, repo: missing, node: node))
    }
    dir.write("bare/server/index.ts")
    await #expect(throws: ServerStartError.dependenciesMissing(path: dir.path("bare").path)) {
      try await launcher.prepare(ServerConfig(port: 4757, repo: dir.path("bare"), node: node))
    }
  }

  @Test func runsTheServerInASessionOfItsOwn() async throws {
    defer { dir.remove() }
    let node = fakeNode(in: dir, "node/bin/node", body: "sleep 30")
    let launch = ServerLaunch(executable: node, arguments: [], directory: dir.url, environment: ["PATH": "/usr/bin:/bin"])
    let server = try ServerProcess.spawn(launch, log: dir.path("server.log"))
    defer { killGroup(server.pgid) }
    // No terminal to be stopped by, and still a group of its own to signal.
    #expect(getsid(server.pid) == server.pid)
    #expect(getpgid(server.pid) == server.pid)
  }

  @Test func appendsToTheLog() async throws {
    defer { dir.remove() }
    let log = dir.path("server.log")
    dir.write("server.log", "an earlier run\n")
    let node = fakeNode(in: dir, "node/bin/node", body: "echo 'to stdout'\necho 'to stderr' >&2\n")
    let launch = ServerLaunch(executable: node, arguments: [], directory: dir.url, environment: ["PATH": "/usr/bin:/bin"])
    let server = try ServerProcess.spawn(launch, log: log)
    try await eventually("exit", within: .seconds(5)) { !processAlive(server.pid) }
    let lines = dir.read("server.log").split(separator: "\n")
    #expect(lines.first == "an earlier run")
    #expect(lines.contains("to stdout"))
    #expect(lines.contains("to stderr"))
    #expect(ServerProcess.logTail(log, from: server.logOffset) == ["to stdout", "to stderr"])
  }
}

/// Against this Mac's real login shell and Node. Only PATH is read from the shell. Set OMNI_LIVE_LOGIN_SHELL=1.
@Suite(.enabled(if: ProcessInfo.processInfo.environment["OMNI_LIVE_LOGIN_SHELL"] != nil, "set OMNI_LIVE_LOGIN_SHELL=1"))
struct LiveLoginShellTests {
  @Test func readsThePathAndFindsNode() async throws {
    let path = try #require(await LoginShell().path())
    #expect(path.split(separator: ":").contains("/usr/bin"))
    let launch = try await ServerLauncher().prepare(ServerConfig(port: 4757, repo: URL(filePath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent(), node: nil))
    #expect(launch.environment["PATH"]?.hasPrefix(launch.executable.deletingLastPathComponent().path + ":") == true)
    #expect(launch.environment.keys.allSatisfy { !ServerEnvironment.isBlocked($0) })
  }
}
