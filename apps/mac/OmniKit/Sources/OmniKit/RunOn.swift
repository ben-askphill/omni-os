import Foundation
import Observation

// Where a new thread runs: this Mac, or another synced machine (apps/server/run-on.ts). The composer picks per thread;
// Settings > Machines saves the default (user config `runOn.device`). A pick is a device id from GET /api/devices, or ""
// for this Mac.

public enum RunOnRules {
  /// What POST /api/threads takes for this Mac.
  public static let here = "here"

  /// The machine the composer starts on, and what Settings shows as the default (`runOnDefault` and `settingPick`):
  /// the saved default while it is listed, even when offline, else this Mac, where the server runs a stale default.
  public static func resolved(_ saved: String, devices: [Device]) -> String {
    devices.contains { $0.id == saved } ? saved : ""
  }

  /// Whether a pick still stands: this Mac, or a machine still listed, even when offline.
  public static func holds(_ pick: String, devices: [Device]) -> Bool {
    pick.isEmpty || devices.contains(where: { $0.id == pick })
  }

  /// The composer's pick while it holds, else the default (`runOnPick`). Nil `picked`: Ben has not picked.
  public static func held(_ picked: String?, saved: String, devices: [Device]) -> String {
    if let picked, holds(picked, devices: devices) { return picked }
    return resolved(saved, devices: devices)
  }

  /// NewThread's `device`: nil while no other machine is listed (the picker is hidden and the server's default
  /// applies), "here" for this Mac, else the machine's id.
  public static func sent(_ pick: String, devices: [Device]) -> String? {
    guard !devices.isEmpty else { return nil }
    return pick.isEmpty ? here : pick
  }

  /// The pick's name: the machine's, else "This Mac", where a machine sync does not list runs.
  public static func label(_ pick: String, devices: [Device]) -> String {
    devices.first { $0.id == pick }?.name ?? "This Mac"
  }
}

/// The calls Settings > Machines makes for the default. `OmniClient` is one; tests pass a fake.
public protocol RunOnAPI: Sendable {
  func setup() async throws(OmniAPIError) -> SetupState
  func saveSetup(_ patch: SetupPatch) async throws(OmniAPIError) -> SetupState
}

extension OmniClient: RunOnAPI {}

/// The saved default machine for new threads. Follows the connection; read by the composer and Settings > Machines.
@MainActor @Observable
public final class RunOnModel {
  /// A device id, or "" for this Mac.
  public private(set) var saved = ""
  public private(set) var saving = false
  /// Why the last save failed. Cleared by the next one.
  public private(set) var error: String?

  @ObservationIgnored private var api: (any RunOnAPI)?
  @ObservationIgnored private var loads = 0

  public init() {}

  public func connect(api: any RunOnAPI) {
    self.api = api
    loads += 1
    saved = ""
    error = nil
  }

  /// Reads the default again. A failed read keeps what it had: the server applies its own default anyway.
  public func load() async {
    guard let api else { return }
    loads += 1
    let load = loads
    guard let state = try? await api.setup(), load == loads else { return }
    saved = state.config.runOn?.device ?? ""
  }

  /// Saves `device` ("" for this Mac) as the default. On failure the old one stays and `error` says why.
  public func save(_ device: String) async {
    guard let api, device != saved, !saving else { return }
    saving = true
    error = nil
    defer { saving = false }
    loads += 1
    do throws(OmniAPIError) {
      let state = try await api.saveSetup(SetupPatch(runOn: UserConfig.RunOn(device: device)))
      saved = state.config.runOn?.device ?? device
    } catch {
      self.error = error.message
    }
  }
}
