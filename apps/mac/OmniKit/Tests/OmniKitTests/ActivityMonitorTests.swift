import Foundation
import Testing

@testable import OmniKit

@MainActor
struct ActivityMonitorTests {
  /// A checkout with only the monitor's script, written by the test.
  private func checkout(script: String) throws -> URL {
    let repo = FileManager.default.temporaryDirectory.appending(path: "monitor-\(UUID().uuidString)")
    let dir = repo.appending(path: "prototypes/activity-monitor")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try script.write(to: dir.appending(path: "sampler.mjs"), atomically: true, encoding: .utf8)
    return repo
  }

  private func monitor(repo: URL, port: Int) -> ActivityMonitor {
    let log = FileManager.default.temporaryDirectory.appending(path: "monitor-\(UUID().uuidString).log")
    return ActivityMonitor(
      port: port, config: { ServerConfig(port: 4747, repo: repo) },
      options: .init(logURL: log, probeTimeout: .milliseconds(500), startTimeout: .seconds(8), stopTimeout: .seconds(2))
    )
  }

  @Test func missingScriptFailsWithTheScriptName() async throws {
    let repo = FileManager.default.temporaryDirectory.appending(path: "empty-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)
    let m = monitor(repo: repo, port: 47911)
    m.start()
    for _ in 0..<100 where m.state == .starting { try await Task.sleep(for: .milliseconds(50)) }
    guard case .failed(let message) = m.state else { Issue.record("state \(m.state)"); return }
    #expect(message.contains("prototypes/activity-monitor/sampler.mjs"))
  }

  @Test func startsTheScriptAndStopsIt() async throws {
    let port = 47912
    let script = """
      import { createServer } from 'node:http';
      createServer((req, res) => res.end('<title>Omni Activity</title>')).listen(Number(process.env.MONITOR_PORT), '127.0.0.1');
      """
    let m = monitor(repo: try checkout(script: script), port: port)
    m.start()
    for _ in 0..<200 where m.state == .starting { try await Task.sleep(for: .milliseconds(50)) }
    #expect(m.state == .running(startedByApp: true))
    await m.stop()
    #expect(m.state == .off)
    let gone = try? await URLSession.shared.data(from: m.url)
    #expect(gone == nil)
  }

  @Test func aScriptThatExitsFailsWithItsLastLogLine() async throws {
    let m = monitor(repo: try checkout(script: "console.error('boom'); process.exit(3)"), port: 47913)
    m.start()
    for _ in 0..<200 where m.state == .starting { try await Task.sleep(for: .milliseconds(50)) }
    guard case .failed(let message) = m.state else { Issue.record("state \(m.state)"); return }
    #expect(message.contains("boom"))
  }
}
