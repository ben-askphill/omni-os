import Foundation
import Testing
import OmniKit

@Suite struct SecretStoreTests {
  private func decode(_ json: String) throws -> SecretStore? {
    try JSONDecoder().decode([String: SecretStore?].self, from: Data(json.utf8))["store"] ?? nil
  }

  @Test func decodesEachStoreAndReadsAnUnknownOneAsTheKeychain() throws {
    #expect(try decode(#"{"store":"file"}"#) == .file)
    #expect(try decode(#"{"store":"libsecret"}"#) == .libsecret)
    #expect(try decode(#"{"store":"vault"}"#) == .keychain)
  }

  @Test func namesEachStoreTheWayTheWebDoes() {
    #expect(SecretStore.keychain.label == "the server Mac's Keychain")
    #expect(SecretStore.libsecret.label == "the server's system keyring")
    #expect(SecretStore.file.label == "a private file on the server (data/secrets.json)")
  }
}
