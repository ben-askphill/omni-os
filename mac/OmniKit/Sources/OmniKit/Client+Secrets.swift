import Foundation

/// POST /api/secrets. The value goes in the body only, and the body is dropped with the request.
private struct SecretWrite: Encodable, Sendable {
  let scope: SecretScope
  let name: String
  let value: String
}

/// DELETE /api/secrets takes the key as a JSON body, not in the path.
private struct SecretKey: Encodable, Sendable {
  let scope: SecretScope
  let name: String
}

private struct OKBody: Decodable {
  let ok: Bool
}

extension OmniClient {
  /// Names, scopes and update times. The server never sends a value.
  public func secrets() async throws(OmniAPIError) -> [SecretRow] {
    try await send("GET", "/api/secrets")
  }

  /// Adds or replaces a secret. The server writes the value to the Keychain.
  public func setSecret(scope: SecretScope, name: String, value: String) async throws(OmniAPIError) {
    let _: OKBody = try await send("POST", "/api/secrets", body: SecretWrite(scope: scope, name: name, value: value))
  }

  public func deleteSecret(scope: SecretScope, name: String) async throws(OmniAPIError) {
    let _: OKBody = try await send("DELETE", "/api/secrets", body: SecretKey(scope: scope, name: name))
  }
}
