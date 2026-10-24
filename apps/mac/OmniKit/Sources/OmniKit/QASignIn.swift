#if DEBUG
import Foundation

/// Debug only. A QA run can't click through the system's sign-in sheet, so with `-OmniQASignInHint <email>` the app
/// asks Google's URL with `login_hint` instead (the QA stack's fake Google answers it with a redirect at once) and
/// follows the redirects by hand until the server sends it to `omni://signin?attempt=`.
public enum QASignIn {
  /// `transport` must hand back redirects, not follow them. nil asks the network that way.
  public static func follow(_ url: URL, hint: String, transport: (any HTTPTransport)? = nil) async throws -> URL {
    let transport = transport ?? NoRedirectTransport()
    let email = hint.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "@.-_"))) ?? hint
    guard var next = URL(string: url.absoluteString + "&login_hint=" + email) else { throw QAScriptError("not a URL: \(url)") }
    for _ in 0..<8 {
      if next.scheme == "omni" { return next }
      let (_, response) = try await transport.send(URLRequest(url: next))
      guard (300..<400).contains(response.statusCode), let location = response.value(forHTTPHeaderField: "Location"),
        let to = URL(string: location, relativeTo: next)?.absoluteURL
      else { throw QAScriptError("sign-in stopped at \(next.host() ?? next.absoluteString) with \(response.statusCode)") }
      next = to
    }
    throw QAScriptError("sign-in redirected more than 8 times")
  }
}

private struct NoRedirectTransport: HTTPTransport {
  private final class Refuse: NSObject, URLSessionTaskDelegate {
    func urlSession(
      _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest
    ) async -> URLRequest? { nil }
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await URLSession(configuration: .ephemeral).data(for: request, delegate: Refuse())
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    return (data, http)
  }
}
#endif
