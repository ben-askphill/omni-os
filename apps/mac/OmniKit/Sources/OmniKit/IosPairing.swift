import Foundation
import Observation

// The Omni for iOS card of the Sharing & access section, like the Web UI's Settings, Sharing & access, Omni for iOS
// (apps/web/src/pair-ios.ts, which this mirrors): which address the phone is told to use, what the QR holds, and what to
// say when a code cannot be made.
//
// The QR holds {"version":1,"serverUrl":"https://<origin>","code":"<code>"} and nothing else: the code comes from
// POST /api/auth/app-pairings and is short-lived. The app holds the install token to call the server, and nothing here
// puts it, or a session, in the QR.
//
// serverUrl is an HTTPS origin a phone can reach from outside this Mac. The card offers the ones it can know of, the
// first chosen unless the person picks another:
//   page       the origin this app talks to, when it is one (loopback, unless the app is pointed at a remote server);
//   connect    the Omni Connect address, while its tunnel is connected;
//   entered    an address typed in, for a Tailscale name (`tailscale serve`) or any other HTTPS door to this server.
// Nothing here assumes a tunnel is running: Omni Connect is offered only while its tunnel says connected, and an entered
// address is taken on trust, since the app cannot ask the phone's network. The server does not tell a client its own
// Tailscale name, so there is nothing to offer for it but what is entered. The Public MCP URL is not offered: its tunnel
// forwards /mcp only, and /api refuses it.
// localhost, an IP address, a name with no dot and `.local` names never go in: a phone cannot reach them, or trust them.

/// POST /api/auth/app-pairings: the code the iOS app trades for a session, and when it stops working.
public struct AppPairingCode: Decodable, Hashable, Sendable {
  public let code: String
  public let expiresAt: Date
}

public enum PairingSource: Hashable, Sendable {
  case page, connect, entered

  public var label: String {
    switch self {
    case .page: "This app"
    case .connect: "Omni Connect"
    case .entered: "Entered"
    }
  }
}

/// An HTTPS origin the QR could name.
public struct PairingAddress: Hashable, Sendable, Identifiable {
  public let url: String
  public let source: PairingSource
  public var id: String { url }

  public init(url: String, source: PairingSource) {
    self.url = url
    self.source = source
  }

  /// The address without `https://`, as the card shows it.
  public var host: String { url.replacingOccurrences(of: "https://", with: "") }
  /// The app cannot check from here that a phone can reach it.
  public var isUnchecked: Bool { source == .entered }
}

public struct PairingOptions: Hashable, Sendable {
  /// In the order offered; the first is chosen unless the person picks another.
  public let addresses: [PairingAddress]
  /// Why there is no address, when there is none.
  public let problem: String?
}

/// An address that is an origin a phone can use, or what is wrong with it.
public enum OriginCheck: Hashable, Sendable {
  case origin(String)
  case problem(String)
}

public enum IosPairing {
  private static let unreachableSuffixes = [".local", ".localhost", ".internal", ".lan", ".home.arpa"]

  public static let noCode = "The server did not send a pairing code. If you updated Omni, restart its server and try again."

  /// Only a client holding the install token may ask for a code, so a session cannot mint itself a way past its own
  /// revoke.
  public static let installTokenOnly = "Pairing the iOS app takes the install token. Use the Omni Mac app, or a browser paired with the install token."
  /// Shown in place of the card's controls when this client is a Google session. The Mac app holds the token, so it only
  /// shows this if it is ever pointed at a server it signed in to.
  public static let needsInstallToken = "This app signed in with Google. \(installTokenOnly)"

  private static let enterHint = " Or enter an HTTPS address below, such as your Tailscale name."

  /// `https://host[:port]` for an address a phone could reach over HTTPS, or why not. The path, query and fragment are dropped.
  public static func check(_ raw: String) -> OriginCheck {
    guard let parts = URLComponents(string: raw), let scheme = parts.scheme?.lowercased() else {
      return .problem("That is not a web address.")
    }
    guard scheme == "https" else {
      return .problem(scheme == "http" ? "A phone needs an HTTPS address. This one starts with http://." : "Use an address that starts with https://.")
    }
    guard parts.user == nil, parts.password == nil else {
      return .problem("Leave the user name and password out of the address.")
    }
    guard var host = parts.host?.lowercased(), !host.isEmpty else { return .problem("That is not a web address.") }
    if host.hasSuffix(".") { host.removeLast() }
    let labels = host.split(separator: ".", omittingEmptySubsequences: false)
    let isIPv4 = labels.count == 4 && labels.allSatisfy { !$0.isEmpty && $0.allSatisfy(\.isASCIIDigit) }
    guard host.allSatisfy(\.isASCII) else { return .problem("That is not a web address.") }
    guard !host.contains(":"), !isIPv4 else {
      return .problem("Use a name, such as your Tailscale name. A phone cannot trust an HTTPS certificate for an IP address.")
    }
    guard labels.count > 1, !unreachableSuffixes.contains(where: { host.hasSuffix($0) }) else {
      return .problem("\(host) only means something on this machine or its network. Use a Tailscale or public name, with a dot in it.")
    }
    var port = ""
    if let p = parts.port, p != 443 { port = ":\(p)" }
    return .origin("https://\(host)\(port)")
  }

  public static func remoteHTTPSOrigin(_ raw: String?) -> String? {
    guard let raw, case .origin(let origin) = check(raw) else { return nil }
    return origin
  }

  /// What a person typed as the server's address: the origin, or what is wrong with it. A name with no scheme means https.
  public static func parseEnteredAddress(_ text: String) -> OriginCheck {
    let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if typed.isEmpty { return .problem("Enter an address first.") }
    return check(typed.contains("://") ? typed : "https://\(typed)")
  }

  /// The addresses the QR could name, or why there are none. `pageOrigin` is the server this app talks to; `connect` is
  /// Omni Connect's status once it has arrived; `entered` is an address the person chose with `parseEnteredAddress`.
  public static func options(pageOrigin: String, connect: ConnectStatus?, entered: String?) -> PairingOptions {
    var addresses: [PairingAddress] = []
    func add(_ url: String?, _ source: PairingSource) {
      if let url, !addresses.contains(where: { $0.url == url }) { addresses.append(PairingAddress(url: url, source: source)) }
    }
    add(remoteHTTPSOrigin(pageOrigin), .page)
    if let connect, connect.enabled, connect.tunnel.state == .connected { add(remoteHTTPSOrigin(connect.url), .connect) }
    add(entered, .entered)
    return PairingOptions(addresses: addresses, problem: addresses.isEmpty ? noAddress(pageOrigin: pageOrigin, connect: connect) : nil)
  }

  private static func noAddress(pageOrigin: String, connect: ConnectStatus?) -> String {
    guard let connect else { return "Omni Connect's status is not available." + enterHint }
    guard connect.enabled else {
      let parts = URLComponents(string: pageOrigin)
      var at = parts?.host ?? pageOrigin
      if let port = parts?.port { at += ":\(port)" }
      return "Omni answers at \(at) on this Mac, which a phone cannot reach. Turn on Omni Connect, above, to give this Omni an HTTPS address." + enterHint
    }
    guard connect.tunnel.state == .connected else { return tunnelProblem(connect.tunnel.state) + enterHint }
    return "Omni Connect has no HTTPS address yet. Wait for the relay, then try again." + enterHint
  }

  private static func tunnelProblem(_ state: TunnelState) -> String {
    switch state {
    case .starting: "The Omni Connect tunnel is still starting. This card updates when it is up."
    case .restarting: "The Omni Connect tunnel is restarting. This card updates when it is back."
    case .missing: "The Omni Connect tunnel cannot start because cloudflared is not installed. Omni Connect, above, says how to install it."
    default: "The Omni Connect tunnel is off. Turn Omni Connect off and on again, above."
    }
  }

  /// The exact text of the QR.
  public static func payload(serverURL: String, code: String) -> String {
    #"{"version":1,"serverUrl":\#(quoted(serverURL)),"code":\#(quoted(code))}"#
  }

  private static func quoted(_ text: String) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .withoutEscapingSlashes
    return (try? encoder.encode(text)).map { String(decoding: $0, as: UTF8.self) } ?? "\"\""
  }

  /// Why a code could not be made, in words for the person at this screen.
  public static func errorText(_ error: OmniAPIError) -> String {
    switch error {
    case .http(let status, _) where status == 404 || status == 405: oldServer
    case .notJSON: oldServer
    case .http(let status, _) where status == 429: "Too many pairing codes in a short time. Wait a minute and try again."
    case .http(let status, let message) where status == 403:
      "\(message.trimmingCharacters(in: CharacterSet(charactersIn: ". \n"))). \(installTokenOnly)"
    case .decoding: noCode
    default: error.message
    }
  }

  private static let oldServer = "This Omni server cannot pair the iOS app yet. Update it, restart it and try again."

  /// Whole seconds until `expiresAt`, never below 0.
  public static func secondsLeft(_ expiresAt: Date, now: Date) -> Int {
    max(0, Int(expiresAt.timeIntervalSince(now).rounded(.up)))
  }

  /// `4:07`.
  public static func clock(_ seconds: Int) -> String {
    "\(seconds / 60):" + String(format: "%02d", seconds % 60)
  }
}

extension Character {
  fileprivate var isASCIIDigit: Bool { isASCII && isNumber }
}

private struct EmptyBody: Encodable, Sendable {}

extension OmniClient {
  /// Makes a short-lived code for the iOS app. Takes the install token, which the app always sends.
  public func createAppPairing() async throws(OmniAPIError) -> AppPairingCode {
    try await send("POST", "/api/auth/app-pairings", body: EmptyBody())
  }
}

/// The Omni for iOS card: Omni Connect's status and what is entered for the address, the code the server made, and when
/// it runs out. The code lives here only, and is dropped when it expires, on Hide, and with the model.
@MainActor @Observable
public final class IosPairingModel {
  public struct Issued: Hashable, Sendable {
    /// The code on its own, for typing it in where scanning is not possible.
    public let code: String
    public let payload: String
    public let serverURL: String
    public let expiresAt: Date
  }

  public private(set) var connect: ConnectStatus?
  public private(set) var loadError: String?
  /// How this client got in (GET /api/auth/account): "token" for the app, "session" for a device that signed in with Google.
  public private(set) var via: String?
  /// An address the person typed, already checked.
  public private(set) var entered: String?
  private var picked: String?
  public private(set) var issued: Issued?
  /// The last code ran out before it was used.
  public private(set) var expired = false
  public private(set) var isBusy = false
  /// What the last request for a code failed with.
  public private(set) var actionError: String?

  @ObservationIgnored private let client: OmniClient

  public init(client: OmniClient) {
    self.client = client
  }

  /// The addresses on offer, or why there are none.
  public var options: PairingOptions {
    IosPairing.options(pageOrigin: client.baseURL.absoluteString, connect: connect, entered: entered)
  }

  /// The address the QR would name: the one picked, else the first on offer.
  public var address: PairingAddress? {
    let all = options.addresses
    return all.first { $0.url == picked } ?? all.first
  }

  /// A Google session may not ask for a code: the server refuses it, so the card says where to go instead.
  public var needsInstallToken: Bool { via == "session" }

  /// Omni Connect's status has not arrived, or failed, and nothing else gives an address yet.
  public var isLoading: Bool { connect == nil && loadError == nil }

  public func refresh() async {
    do throws(OmniAPIError) {
      connect = try await client.connectStatus()
      loadError = nil
    } catch {
      guard error != .cancelled else { return }
      if connect == nil { loadError = error.message }
    }
    if via == nil { via = (try? await client.authAccount())?.via }
    dropCodeIfAddressChanged()
  }

  /// Checks an address the person typed and picks it. Returns what is wrong with it, or nil.
  @discardableResult
  public func useAddress(_ text: String) -> String? {
    switch IosPairing.parseEnteredAddress(text) {
    case .problem(let problem):
      return problem
    case .origin(let url):
      entered = url
      picked = url
      dropCodeIfAddressChanged()
      return nil
    }
  }

  public func select(_ url: String) {
    picked = url
    dropCodeIfAddressChanged()
  }

  private func dropCodeIfAddressChanged() {
    if let issued, issued.serverURL != address?.url { self.issued = nil }
  }

  public func issue() async {
    guard !isBusy, !needsInstallToken, let url = address?.url else { return }
    isBusy = true
    actionError = nil
    expired = false
    defer { isBusy = false }
    do throws(OmniAPIError) {
      let made = try await client.createAppPairing()
      guard !made.code.isEmpty else {
        issued = nil
        actionError = IosPairing.noCode
        return
      }
      issued = Issued(code: made.code, payload: IosPairing.payload(serverURL: url, code: made.code), serverURL: url, expiresAt: made.expiresAt)
    } catch {
      issued = nil
      if error != .cancelled { actionError = IosPairing.errorText(error) }
    }
  }

  public func hide() {
    issued = nil
  }

  /// Drops the code once it has run out.
  public func expireIfNeeded(now: Date) {
    guard let issued, now >= issued.expiresAt else { return }
    self.issued = nil
    expired = true
  }
}
