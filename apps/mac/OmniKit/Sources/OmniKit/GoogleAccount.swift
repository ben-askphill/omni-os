import Foundation
import Observation

/// GET /api/auth/account: the Google account that owns this Omni (apps/server/google-auth.ts), and how the app got in.
public struct AuthAccount: Decodable, Hashable, Sendable {
  public struct Owner: Decodable, Hashable, Sendable {
    public let email: String?
    public let name: String?
    public let linkedAt: Date
  }
  /// The server's config names a Clerk OAuth app, so Google sign-in can work.
  public let available: Bool
  public let issuer: String?
  public let owner: Owner?
  /// "token" for the app, which reads data/api-token; "session" for a device that signed in with Google.
  public let via: String
}

/// A device that signed in, with Google as the owner or as an app paired with a code: GET /api/auth/devices.
public struct SignedInDevice: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let name: String
  /// "browser" or "app".
  public let kind: String
  /// "google" or "pairing": how it got in. Nil from an older server, which only had Google.
  public let method: String?
  public let createdAt: Date
  public let lastSeenAt: Date
  public let current: Bool
}

/// POST /api/auth/google/link and POST /api/sync/setup: the code to show and the Clerk page to approve it on.
public struct GoogleFlowStart: Decodable, Hashable, Sendable {
  public let flow: String
  public let secret: String
  public let userCode: String
  public let verificationUri: String
  public let verificationUriComplete: String?
  public let interval: Int

  /// The page to open: with the code filled in when Clerk offers that.
  public var pageURL: URL? { URL(string: verificationUriComplete ?? verificationUri) }
}

/// POST /api/auth/google/poll.
public struct GooglePoll: Decodable, Hashable, Sendable {
  /// pending, linked, signed_in, refused, denied or expired.
  public let state: String
  public let error: String?
}

private struct DevicesReply: Decodable {
  let devices: [SignedInDevice]
}

private struct PollBody: Encodable, Sendable {
  let flow: String
  let secret: String
}

private struct EmptyBody: Encodable, Sendable {}
private struct OkReply: Decodable {}

extension OmniClient {
  public func authAccount() async throws(OmniAPIError) -> AuthAccount {
    try await send("GET", "/api/auth/account")
  }

  public func signedInDevices() async throws(OmniAPIError) -> [SignedInDevice] {
    let reply: DevicesReply = try await send("GET", "/api/auth/devices")
    return reply.devices
  }

  /// Starts linking the Google account that approves on Clerk's page. Takes the token, which the app always sends.
  public func startGoogleLink() async throws(OmniAPIError) -> GoogleFlowStart {
    try await send("POST", "/api/auth/google/link", body: EmptyBody())
  }

  public func pollGoogle(_ start: GoogleFlowStart) async throws(OmniAPIError) -> GooglePoll {
    try await send("POST", "/api/auth/google/poll", body: PollBody(flow: start.flow, secret: start.secret))
  }

  public func revokeSignedInDevice(_ id: String) async throws(OmniAPIError) {
    let _: OkReply = try await send("DELETE", "/api/auth/devices/\(uriComponent(id))")
  }

  /// Unlinks the owner: every device that signed in with Google loses access.
  public func unlinkGoogle() async throws(OmniAPIError) {
    let _: OkReply = try await send("DELETE", "/api/auth/google")
  }
}

/// The Google account card of the Sharing & access section, like the Web UI's Settings, Sharing & access, Google account: the linked
/// account, linking one through Clerk's device-code page, the signed-in devices, revoking one, and unlinking.
@MainActor @Observable
public final class GoogleAccountModel {
  public private(set) var account: AuthAccount?
  public private(set) var devices: [SignedInDevice] = []
  public private(set) var loadError: String?
  /// A link in progress: the code to compare on Clerk's page.
  public private(set) var linking: GoogleFlowStart?
  public private(set) var isStarting = false
  public private(set) var actionError: String?

  @ObservationIgnored private let client: OmniClient
  @ObservationIgnored private var pollTask: Task<Void, Never>?

  public init(client: OmniClient) {
    self.client = client
  }

  public func load() async {
    do throws(OmniAPIError) {
      let a = try await client.authAccount()
      account = a
      // Asked whether or not a Google account is linked: an app paired with a code is a signed-in device with no owner
      // behind it. With no owner, a server that cannot list them leaves the list empty rather than failing the card.
      if a.owner == nil {
        devices = (try? await client.signedInDevices()) ?? []
      } else {
        devices = try await client.signedInDevices()
      }
      loadError = nil
    } catch {
      guard error != .cancelled else { return }
      if account == nil { loadError = error.message }
    }
  }

  /// Asks the server for a code, and polls until Clerk answers. Returns the code so the view can open its page.
  @discardableResult
  public func startLink() async -> GoogleFlowStart? {
    guard linking == nil, !isStarting else { return nil }
    isStarting = true
    actionError = nil
    defer { isStarting = false }
    do throws(OmniAPIError) {
      let start = try await client.startGoogleLink()
      linking = start
      pollTask = Task { [weak self] in await self?.poll(start) }
      return start
    } catch {
      if error != .cancelled { actionError = error.message }
      return nil
    }
  }

  public func cancelLink() {
    pollTask?.cancel()
    pollTask = nil
    linking = nil
  }

  private func poll(_ start: GoogleFlowStart) async {
    while !Task.isCancelled {
      try? await Task.sleep(for: .seconds(max(1, start.interval)))
      guard !Task.isCancelled, linking == start else { return }
      do throws(OmniAPIError) {
        let r = try await client.pollGoogle(start)
        if r.state == "pending" { continue }
        linking = nil
        switch r.state {
        case "linked": await load()
        case "denied": actionError = "Sign-in was declined on the Clerk page."
        case "expired": actionError = "The code expired before it was approved. Start again."
        default: actionError = r.error ?? "Sign-in did not finish."
        }
        return
      } catch {
        guard error != .cancelled else { return }
        linking = nil
        actionError = error.message
        return
      }
    }
  }

  public func revoke(_ device: SignedInDevice) async {
    await act { c throws(OmniAPIError) in try await c.revokeSignedInDevice(device.id) }
  }

  public func unlink() async {
    await act { c throws(OmniAPIError) in try await c.unlinkGoogle() }
  }

  private func act(_ run: (OmniClient) async throws(OmniAPIError) -> Void) async {
    actionError = nil
    do throws(OmniAPIError) {
      try await run(client)
    } catch {
      if error != .cancelled { actionError = error.message }
    }
    await load()
  }
}
