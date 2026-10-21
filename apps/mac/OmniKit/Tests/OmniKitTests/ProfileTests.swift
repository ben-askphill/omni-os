import Foundation
import Testing
@testable import OmniKit

@Suite struct GreetingTests {
  @Test func followsTheHourAndTakesTheName() {
    #expect(Greeting.text(hour: 3, name: "Tijs") == "Late one, Tijs")
    #expect(Greeting.text(hour: 9, name: "Tijs") == "Morning, Tijs")
    #expect(Greeting.text(hour: 14, name: "Tijs") == "Afternoon, Tijs")
    #expect(Greeting.text(hour: 21, name: "Tijs") == "Evening, Tijs")
  }

  @Test func standsAloneUntilANameIsSet() {
    #expect(Greeting.text(hour: 9, name: "") == "Morning")
    #expect(Greeting.text(hour: 21, name: nil) == "Evening")
  }
}

@Suite struct ProfileClientTests {
  @Test func readsTheProfile() async throws {
    let t = StubTransport(body: #"{"name":"Tijs"}"#)
    let p = try await OmniClient(port: 4799, transport: t).profile()
    #expect(p == Profile(name: "Tijs"))
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "GET")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/profile")
  }

  @Test func savesTheNameWithAPut() async throws {
    let t = StubTransport(body: #"{"name":"Tijs"}"#)
    let p = try await OmniClient(port: 4799, transport: t).setProfile(name: "Tijs")
    #expect(p.name == "Tijs")
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "PUT")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/profile")
    #expect(req.value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(try bodyJSON(req) == .object(["name": .string("Tijs")]))
  }

  @Test func aRefusedNameIsTheServersError() async {
    let t = StubTransport(status: 400, body: #"{"error":"Enter a name."}"#)
    await #expect(throws: OmniAPIError.self) {
      try await OmniClient(port: 4799, transport: t).setProfile(name: " ")
    }
  }
}
