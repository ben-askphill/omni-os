import Foundation

/// Where a server keeps secret values, as GET /api/status reports it in `server.secretStore`. Mirrors
/// packages/shared/secret-store.ts. An unknown kind decodes as `.keychain`, like a server that leaves it out.
public enum SecretStore: String, Decodable, Hashable, Sendable {
  case keychain, libsecret, file

  public init(from decoder: any Decoder) throws {
    self = SecretStore(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .keychain
  }

  /// The store as a sentence names it: "Values live in \(label)."
  public var label: String {
    switch self {
    case .keychain: "the server Mac's Keychain"
    case .libsecret: "the server's system keyring"
    case .file: "a private file on the server (data/secrets.json)"
    }
  }
}

extension Status {
  /// The label for this server's secret store, the Keychain when the server does not say.
  public var secretStoreLabel: String { (server?.secretStore ?? .keychain).label }
}
