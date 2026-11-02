import Foundation
import Testing
import OmniKit

// Which address the iOS pairing QR names, what it holds, and what is said when there is no code. The cases match
// apps/web/tests/pair-ios.test.ts.

private func connect(enabled: Bool = true, state: String = "connected", url: String? = "https://bens-mac-a1b2c3.omni-os.app") throws -> ConnectStatus {
  let u = url.map { "\"\($0)\"" } ?? "null"
  let json = #"{"enabled":\#(enabled),"relayReady":true,"signedIn":true,"hostname":null,"url":\#(u),"connectPage":null,"tunnel":{"state":"\#(state)","error":null,"cloudflared":null},"error":null}"#
  return try OmniJSON.decoder().decode(ConnectStatus.self, from: Data(json.utf8))
}

private let local = "http://127.0.0.1:4747"

@Suite struct IosPairingAddressTests {
  @Test func keepsTheOriginOfAnHTTPSNameAPhoneCanReach() {
    #expect(IosPairing.remoteHTTPSOrigin("https://bens-mac-a1b2c3.omni-os.app/#/connect?x=1") == "https://bens-mac-a1b2c3.omni-os.app")
    #expect(IosPairing.remoteHTTPSOrigin("https://mac.tail1234.ts.net:8443/path") == "https://mac.tail1234.ts.net:8443")
    #expect(IosPairing.remoteHTTPSOrigin("https://mac.tail1234.ts.net:443") == "https://mac.tail1234.ts.net")
  }

  @Test(arguments: [
    "http://bens-mac.omni-os.app", "http://localhost:4747", "https://localhost:4747", "https://127.0.0.1", "https://192.168.1.20",
    "https://[::1]:4747", "https://bens-mac.local", "https://app.localhost", "https://intranet", "https://user:pass@bens-mac.omni-os.app",
    "omni://pair", "not a url", "",
  ])
  func refuses(_ raw: String) {
    #expect(IosPairing.remoteHTTPSOrigin(raw) == nil)
    #expect(IosPairing.remoteHTTPSOrigin(nil) == nil)
  }

  @Test func offersTheAddressTheAppTalksToFirst() throws {
    let both = IosPairing.options(pageOrigin: "https://mac.tail1234.ts.net", connect: try connect(), entered: nil)
    #expect(both.addresses.map(\.url) == ["https://mac.tail1234.ts.net", "https://bens-mac-a1b2c3.omni-os.app"])
    #expect(both.addresses.map(\.source) == [.page, .connect])
    #expect(IosPairing.options(pageOrigin: "https://mac.tail1234.ts.net", connect: nil, entered: nil).addresses.map(\.source) == [.page])
  }

  @Test func offersTheOmniConnectAddressOnceTheTunnelIsUp() throws {
    let o = IosPairing.options(pageOrigin: local, connect: try connect(), entered: nil)
    #expect(o.addresses == [PairingAddress(url: "https://bens-mac-a1b2c3.omni-os.app", source: .connect)])
    #expect(o.problem == nil)
  }

  @Test func offersAnEnteredTailscaleAddressWithOmniConnectOffAndNoTunnel() throws {
    let o = IosPairing.options(pageOrigin: local, connect: try connect(enabled: false, state: "off", url: nil), entered: "https://mac.tail1234.ts.net")
    #expect(o.addresses == [PairingAddress(url: "https://mac.tail1234.ts.net", source: .entered)])
    #expect(o.problem == nil)
    #expect(o.addresses.first?.isUnchecked == true)
  }

  @Test func listsAnEnteredAddressAfterTheOthersAndOnce() throws {
    let o = IosPairing.options(pageOrigin: local, connect: try connect(), entered: "https://mac.tail1234.ts.net")
    #expect(o.addresses.map(\.source) == [.connect, .entered])
    #expect(IosPairing.options(pageOrigin: local, connect: try connect(), entered: "https://bens-mac-a1b2c3.omni-os.app").addresses.count == 1)
  }

  @Test func worksBeforeOrWithoutTheStatus() {
    #expect(IosPairing.options(pageOrigin: local, connect: nil, entered: "https://mac.tail1234.ts.net").addresses.count == 1)
    let none = IosPairing.options(pageOrigin: local, connect: nil, entered: nil)
    #expect(none.addresses.isEmpty && none.problem?.contains("enter an HTTPS address") == true)
  }

  @Test func saysWhatToDoWhenOmniConnectIsOff() throws {
    let problem = try #require(IosPairing.options(pageOrigin: local, connect: try connect(enabled: false, state: "off", url: nil), entered: nil).problem)
    #expect(problem.contains("127.0.0.1:4747") && problem.contains("Turn on Omni Connect") && problem.contains("Tailscale name"))
  }

  @Test(arguments: [("starting", "still starting"), ("restarting", "restarting"), ("missing", "cloudflared is not installed"), ("off", "is off")])
  func saysWhyATunnelThatIsNotUpHasNoAddressAndStillOffersEntry(state: String, words: String) throws {
    let o = IosPairing.options(pageOrigin: local, connect: try connect(state: state), entered: nil)
    #expect(o.addresses.isEmpty)
    #expect(o.problem?.contains(words) == true && o.problem?.contains("enter an HTTPS address") == true)
  }

  @Test func neverOffersAnAddressThatIsNotHTTPS() throws {
    for url in ["http://bens-mac.omni-os.app", nil] {
      let o = IosPairing.options(pageOrigin: local, connect: try connect(url: url), entered: nil)
      #expect(o.addresses.isEmpty && o.problem?.contains("no HTTPS address") == true)
    }
  }

  @Test func takesAnEnteredOriginWithOrWithoutTheSchemeAndDropsTheRest() {
    #expect(IosPairing.parseEnteredAddress("https://Mac.Tail1234.ts.net/") == .origin("https://mac.tail1234.ts.net"))
    #expect(IosPairing.parseEnteredAddress("  mac.tail1234.ts.net  ") == .origin("https://mac.tail1234.ts.net"))
    #expect(IosPairing.parseEnteredAddress("https://mac.tail1234.ts.net:8443/#/x?y=1") == .origin("https://mac.tail1234.ts.net:8443"))
  }

  @Test(arguments: [
    ("", "Enter an address"), ("http://mac.tail1234.ts.net", "starts with http://"), ("ftp://mac.tail1234.ts.net", "starts with https://"),
    ("https://localhost:4747", "only means something on this machine"), ("localhost", "only means something on this machine"),
    ("https://100.101.102.103", "IP address"), ("http://192.168.1.20:4747", "starts with http://"), ("https://bens-mac.local", "only means something"),
    ("https://user:pw@mac.tail1234.ts.net", "user name and password"),
  ])
  func refusesAnEnteredAddressAndSaysWhy(text: String, words: String) {
    guard case .problem(let problem) = IosPairing.parseEnteredAddress(text) else {
      Issue.record("expected a problem for \(text)")
      return
    }
    #expect(problem.contains(words))
  }
}

@Suite struct IosPairingTextTests {
  @Test func theQRHoldsTheVersionTheAddressAndTheCodeInThatOrderAndNothingElse() {
    #expect(IosPairing.payload(serverURL: "https://bens-mac.omni-os.app", code: "AB12-CD34") == #"{"version":1,"serverUrl":"https://bens-mac.omni-os.app","code":"AB12-CD34"}"#)
  }

  @Test func escapesWhatJSONNeedsEscaped() {
    #expect(IosPairing.payload(serverURL: "https://a.example", code: #"a"b\c"#) == #"{"version":1,"serverUrl":"https://a.example","code":"a\"b\\c"}"#)
  }

  @Test func namesAnOldServerARateLimitAndAReplyThatIsNotACode() {
    #expect(IosPairing.errorText(.http(status: 404, message: "Not found")).contains("Update it, restart it"))
    #expect(IosPairing.errorText(.http(status: 405, message: "x")).contains("Update it, restart it"))
    #expect(IosPairing.errorText(.notJSON(status: 200, contentType: "text/html")).contains("Update it, restart it"))
    #expect(IosPairing.errorText(.http(status: 429, message: "slow")).contains("Wait a minute"))
    #expect(IosPairing.errorText(.decoding("no code")) == IosPairing.noCode)
  }

  @Test func passesOnWhatTheServerSaysAboutARefusal() {
    #expect(IosPairing.errorText(.unreachable("x")) == "Cannot reach the Omni server. Is it running?")
  }

  @Test func tellsARefusedSessionToUseTheMacAppOrABrowserPairedWithTheInstallToken() {
    let text = IosPairing.errorText(.http(status: 403, message: "Forbidden: a Google session cannot pair an app"))
    #expect(text.hasPrefix("Forbidden: a Google session cannot pair an app. "))
    #expect(text.contains("Mac app") && text.contains("install token"))
    #expect(IosPairing.needsInstallToken.contains("signed in with Google") && IosPairing.needsInstallToken.contains("Mac app"))
  }

  @Test func theCountdownCountsWholeSecondsAndStopsAtZero() {
    let at = Date(timeIntervalSince1970: 1_000_000)
    let end = at.addingTimeInterval(300)
    #expect(IosPairing.secondsLeft(end, now: at) == 300)
    #expect(IosPairing.secondsLeft(end, now: at.addingTimeInterval(299.1)) == 1)
    #expect(IosPairing.secondsLeft(end, now: at.addingTimeInterval(301)) == 0)
    #expect(IosPairing.clock(300) == "5:00")
    #expect(IosPairing.clock(61) == "1:01")
    #expect(IosPairing.clock(9) == "0:09")
  }
}

@MainActor @Suite struct IosPairingModelTests {
  private func server(pairing: StubTransport.Reply, state: String = "connected", enabled: Bool = true, via: String = "token") throws -> (OmniClient, StubTransport) {
    let status = try fixture("connect-status.json")
      .replacingOccurrences(of: #""state": "missing""#, with: #""state": "\#(state)""#)
      .replacingOccurrences(of: #""enabled": true"#, with: #""enabled": \#(enabled)"#)
    let transport = StubTransport { req in
      switch req.url!.path {
      case "/api/connect": return StubTransport.Reply(body: status)
      case "/api/auth/account": return StubTransport.Reply(body: #"{"available":true,"issuer":null,"owner":null,"via":"\#(via)"}"#)
      case "/api/auth/app-pairings": return pairing
      default: return StubTransport.Reply(status: 404, body: #"{"error":"Not found"}"#)
      }
    }
    return (OmniClient(port: 4799, transport: transport), transport)
  }

  private let code = StubTransport.Reply(body: #"{"code":"AB12","expiresAt":"2026-11-02T10:05:00.000Z"}"#)
  private func calls(_ transport: StubTransport) -> [String] {
    transport.requests.map { "\($0.httpMethod ?? "GET") \($0.url!.path)" }
  }

  @Test func askingForACodeMakesAQRThatHoldsTheConnectAddressAndTheCode() async throws {
    let (client, transport) = try server(pairing: code)
    let m = IosPairingModel(client: client)
    await m.refresh()
    await m.issue()
    #expect(calls(transport) == ["GET /api/connect", "GET /api/auth/account", "POST /api/auth/app-pairings"])
    #expect(m.issued?.payload == #"{"version":1,"serverUrl":"https://bens-mac-a1b2c3.omni-os.app","code":"AB12"}"#)
    #expect(m.issued?.code == "AB12")
    #expect(m.issued?.expiresAt == OmniJSON.parseDate("2026-11-02T10:05:00.000Z"))
    #expect(m.actionError == nil && !m.isBusy)
  }

  @Test func asksForNoCodeWhileThereIsNoAddress() async throws {
    for (state, enabled) in [("starting", true), ("off", false)] {
      let (client, transport) = try server(pairing: code, state: state, enabled: enabled)
      let m = IosPairingModel(client: client)
      await m.refresh()
      await m.issue()
      #expect(m.issued == nil)
      #expect(!calls(transport).contains("POST /api/auth/app-pairings"))
    }
  }

  @Test func theCodeIsDroppedWhenItRunsOut() async throws {
    let (client, _) = try server(pairing: code)
    let m = IosPairingModel(client: client)
    await m.refresh()
    await m.issue()
    m.expireIfNeeded(now: try #require(OmniJSON.parseDate("2026-11-02T10:04:59.000Z")))
    #expect(m.issued != nil && !m.expired)
    m.expireIfNeeded(now: try #require(OmniJSON.parseDate("2026-11-02T10:05:00.000Z")))
    #expect(m.issued == nil && m.expired)
  }

  @Test func hidingDropsTheCode() async throws {
    let (client, _) = try server(pairing: code)
    let m = IosPairingModel(client: client)
    await m.refresh()
    await m.issue()
    m.hide()
    #expect(m.issued == nil && !m.expired)
  }

  @Test func aServerThatCannotPairSaysSo() async throws {
    let (client, _) = try server(pairing: StubTransport.Reply(status: 404, body: #"{"error":"Not found"}"#))
    let m = IosPairingModel(client: client)
    await m.refresh()
    await m.issue()
    #expect(m.issued == nil)
    #expect(m.actionError?.contains("cannot pair the iOS app yet") == true)
  }

  @Test func aRefusalShowsTheServersWords() async throws {
    let (client, _) = try server(pairing: StubTransport.Reply(status: 403, body: #"{"error":"Forbidden: a paired app cannot pair another"}"#))
    let m = IosPairingModel(client: client)
    await m.refresh()
    await m.issue()
    #expect(m.actionError?.hasPrefix("Forbidden: a paired app cannot pair another. ") == true)
    #expect(m.actionError?.contains("Mac app") == true)
  }

  @Test func anEnteredTailscaleAddressGivesACodeWhileOmniConnectIsOff() async throws {
    let (client, transport) = try server(pairing: code, state: "off", enabled: false)
    let m = IosPairingModel(client: client)
    await m.refresh()
    #expect(m.address == nil)
    await m.issue()
    #expect(m.issued == nil && !calls(transport).contains("POST /api/auth/app-pairings"))
    #expect(m.useAddress("mac.tail1234.ts.net") == nil)
    #expect(m.address == PairingAddress(url: "https://mac.tail1234.ts.net", source: .entered))
    await m.issue()
    #expect(m.issued?.payload == #"{"version":1,"serverUrl":"https://mac.tail1234.ts.net","code":"AB12"}"#)
    #expect(m.issued?.code == "AB12")
  }

  @Test func aBadEnteredAddressIsRefusedAndChangesNothing() async throws {
    let (client, _) = try server(pairing: code, state: "off", enabled: false)
    let m = IosPairingModel(client: client)
    await m.refresh()
    #expect(m.useAddress("http://mac.tail1234.ts.net")?.contains("starts with http://") == true)
    #expect(m.useAddress("localhost:4747")?.contains("only means something on this machine") == true)
    #expect(m.entered == nil && m.address == nil)
  }

  @Test func pickingBetweenOmniConnectAndAnEnteredAddressChangesTheQR() async throws {
    let (client, _) = try server(pairing: code)
    let m = IosPairingModel(client: client)
    await m.refresh()
    #expect(m.useAddress("https://mac.tail1234.ts.net") == nil)
    #expect(m.options.addresses.map(\.source) == [.connect, .entered])
    #expect(m.address?.source == .entered)
    m.select("https://bens-mac-a1b2c3.omni-os.app")
    await m.issue()
    #expect(m.issued?.serverURL == "https://bens-mac-a1b2c3.omni-os.app")
  }

  @Test func switchingTheAddressDropsAShownCode() async throws {
    let (client, _) = try server(pairing: code)
    let m = IosPairingModel(client: client)
    await m.refresh()
    await m.issue()
    #expect(m.issued != nil)
    m.useAddress("https://mac.tail1234.ts.net")
    #expect(m.issued == nil)
  }

  @Test func aGoogleSessionIsToldWhereToGoAndNeverAsksForACode() async throws {
    let (client, transport) = try server(pairing: code, via: "session")
    let m = IosPairingModel(client: client)
    await m.refresh()
    #expect(m.needsInstallToken)
    await m.issue()
    #expect(m.issued == nil && !calls(transport).contains("POST /api/auth/app-pairings"))
  }

  @Test func aReplyWithNoCodeIsNotACode() async throws {
    let (client, _) = try server(pairing: StubTransport.Reply(body: #"{"token":"secret"}"#))
    let m = IosPairingModel(client: client)
    await m.refresh()
    await m.issue()
    #expect(m.issued == nil)
    #expect(m.actionError?.contains("secret") == false)
    #expect(m.actionError?.isEmpty == false)
  }
}

@MainActor @Suite struct PairedDeviceListTests {
  private func client(account: String, devices: StubTransport.Reply) -> OmniClient {
    let transport = StubTransport { req in
      switch req.url!.path {
      case "/api/auth/account": return StubTransport.Reply(body: account)
      case "/api/auth/devices": return devices
      default: return StubTransport.Reply(status: 404, body: #"{"error":"Not found"}"#)
      }
    }
    return OmniClient(port: 4799, transport: transport)
  }

  private let noOwner = #"{"available":true,"issuer":null,"owner":null,"via":"token"}"#

  @Test func anAppPairedWithACodeIsListedWithNoGoogleAccountLinked() async throws {
    let devices = StubTransport.Reply(body: #"{"devices":[{"id":"s1","name":"Ben's iPhone","kind":"app","method":"pairing","createdAt":"2026-11-02T10:00:00.000Z","lastSeenAt":"2026-11-02T10:01:00.000Z","current":false}]}"#)
    let m = GoogleAccountModel(client: client(account: noOwner, devices: devices))
    await m.load()
    #expect(m.account?.owner == nil)
    #expect(m.devices.map(\.id) == ["s1"])
    #expect(m.devices.first?.method == "pairing")
    #expect(m.loadError == nil)
  }

  @Test func aServerThatCannotListThemLeavesTheCardWorkingWithNoGoogleAccount() async {
    let m = GoogleAccountModel(client: client(account: noOwner, devices: StubTransport.Reply(status: 404, body: #"{"error":"Not found"}"#)))
    await m.load()
    #expect(m.account != nil && m.devices.isEmpty && m.loadError == nil)
  }
}
