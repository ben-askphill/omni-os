import Foundation
import Security

/// The API token of a remote Omni, in this Mac's login Keychain. A remote server's `data/api-token` is on
/// another machine, so Ben pastes it once in Settings > Connection. One item per origin, so switching between
/// servers keeps each token.
public struct RemoteTokenStore: Sendable {
  public static let defaultService = "com.omni-os.remote-token"

  public let service: String

  public init(service: String = Self.defaultService) {
    self.service = service
  }

  /// `host` or `host:port`: the item's account.
  public static func account(_ origin: URL) -> String {
    let host = origin.host() ?? ""
    return origin.port.map { "\(host):\($0)" } ?? host
  }

  public func read(_ origin: URL) -> String? {
    var query = base(origin)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    let token = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    return token.isEmpty ? nil : token
  }

  public func has(_ origin: URL) -> Bool { read(origin) != nil }

  /// Replaces the token. An empty one deletes it.
  @discardableResult
  public func save(_ token: String, for origin: URL) -> Bool {
    let token = token.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !token.isEmpty else { return delete(origin) }
    let data = Data(token.utf8)
    let update = SecItemUpdate(base(origin) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if update == errSecSuccess { return true }
    guard update == errSecItemNotFound else { return false }
    var add = base(origin)
    add[kSecValueData as String] = data
    add[kSecAttrLabel as String] = "Omni server token (\(Self.account(origin)))"
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
  }

  @discardableResult
  public func delete(_ origin: URL) -> Bool {
    let status = SecItemDelete(base(origin) as CFDictionary)
    return status == errSecSuccess || status == errSecItemNotFound
  }

  private func base(_ origin: URL) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: Self.account(origin),
    ]
  }
}
