import Foundation

/// Sends one HTTP request. Swap it in tests; the app uses `URLSessionTransport`.
public protocol HTTPTransport: Sendable {
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionTransport: HTTPTransport {
  public let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    return (data, http)
  }
}

public enum OmniAPIError: Error, Hashable, Sendable, LocalizedError {
  /// No answer at all: the server is down or the connection failed.
  case unreachable(String)
  /// A non-2xx answer. `message` is the server's `{error}`, or its text.
  case http(status: Int, message: String)
  /// A 2xx answer that is not JSON, like the Web UI's index.html for a path the server does not route.
  case notJSON(status: Int, contentType: String?)
  /// JSON that does not fit the type asked for.
  case decoding(String)
  case cancelled

  /// Short, plain text to show.
  public var message: String {
    switch self {
    case .unreachable: "Cannot reach the Omni server. Is it running?"
    case .http(_, let message): message
    case .notJSON(let status, let type): "The server answered \(status) with \(type ?? "no content type"), not JSON."
    case .decoding(let detail): "The server sent data this app can't read: \(detail)"
    case .cancelled: "Cancelled."
    }
  }

  public var errorDescription: String? { message }
}

/// POST /api/threads.
public struct NewThread: Encodable, Hashable, Sendable {
  public var channel: String
  public var prompt: String
  public var role: String?
  public var model: String?
  public var harness: HarnessID?
  /// nil for the model's default.
  public var effort: String?
  /// nil to let the server title it.
  public var title: String?
  public var parentID: String?
  public var taskID: String?
  public var source: ThreadSource?
  /// A sidebar folder of the channel to file it in, by id.
  public var folder: String?

  public init(
    channel: String, prompt: String, role: String? = nil, model: String? = nil, harness: HarnessID? = nil,
    effort: String? = nil, title: String? = nil, parentID: String? = nil, taskID: String? = nil, source: ThreadSource? = nil,
    folder: String? = nil
  ) {
    self.channel = channel
    self.prompt = prompt
    self.role = role
    self.model = model
    self.harness = harness
    self.effort = effort
    self.title = title
    self.parentID = parentID
    self.taskID = taskID
    self.source = source
    self.folder = folder
  }

  enum CodingKeys: String, CodingKey {
    case channel, prompt, role, model, harness, effort, title, source, folder
    case parentID = "parent_id"
    case taskID = "task_id"
  }
}

private struct MessageBody: Encodable, Sendable {
  let prompt: String
  let mode: SendMode
}

private struct TitleBody: Encodable, Sendable {
  let title: String
}

private struct ArchivedBody: Encodable, Sendable {
  let archived: Bool
}

private struct ErrorBody: Decodable {
  let error: String
}

/// The Omni server's HTTP API, one method per endpoint. Every method throws `OmniAPIError`.
public struct OmniClient: Sendable {
  public let baseURL: URL
  private let transport: any HTTPTransport

  public init(baseURL: URL, transport: any HTTPTransport = URLSessionTransport()) {
    self.baseURL = baseURL
    self.transport = transport
  }

  public init(host: String = "127.0.0.1", port: Int = 4747, transport: any HTTPTransport = URLSessionTransport()) {
    let h = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
    guard let url = URL(string: "http://\(h):\(port)") else { preconditionFailure("Not a host: \(host)") }
    self.init(baseURL: url, transport: transport)
  }

  // MARK: Endpoints

  public func status() async throws(OmniAPIError) -> Status {
    try await send("GET", "/api/status")
  }

  public func channels(archived: Bool = false) async throws(OmniAPIError) -> [ChannelWithRunning] {
    try await send("GET", "/api/channels", query: archived ? [("archived", "1")] : [])
  }

  public func channel(_ id: String) async throws(OmniAPIError) -> ChannelWithRunning {
    try await send("GET", "/api/channels/\(uriComponent(id))")
  }

  /// A channel's threads, most recently updated first.
  public func channelThreads(_ id: String) async throws(OmniAPIError) -> [OmniThread] {
    try await send("GET", "/api/channels/\(uriComponent(id))/threads")
  }

  public func threads(channel: String? = nil, status: ThreadStatus? = nil, limit: Int? = nil) async throws(OmniAPIError) -> [OmniThread] {
    var query: [(String, String)] = []
    if let channel { query.append(("channel", channel)) }
    if let status { query.append(("status", status.rawValue)) }
    if let limit { query.append(("limit", String(limit))) }
    return try await send("GET", "/api/threads", query: query)
  }

  /// Threads across every channel, most recently updated first.
  public func recent(limit: Int? = nil) async throws(OmniAPIError) -> [OmniThread] {
    try await send("GET", "/api/recent", query: limit.map { [("limit", String($0))] } ?? [])
  }

  /// Full-text search over every thread: prefix matches, at most 40, best first.
  public func search(_ query: String) async throws(OmniAPIError) -> [SearchHit] {
    try await send("GET", "/api/search", query: [("q", query)])
  }

  /// A thread with its transcript, artifacts, children, parent and pending messages.
  public func thread(_ id: String) async throws(OmniAPIError) -> ThreadDetail {
    try await send("GET", "/api/threads/\(uriComponent(id))")
  }

  public func crew() async throws(OmniAPIError) -> [CrewRole] {
    try await send("GET", "/api/crew")
  }

  public func harnesses() async throws(OmniAPIError) -> [HarnessInfo] {
    try await send("GET", "/api/harnesses")
  }

  public func createThread(_ new: NewThread) async throws(OmniAPIError) -> OmniThread {
    try await send("POST", "/api/threads", body: new)
  }

  public func sendMessage(to id: String, prompt: String, mode: SendMode = .steer) async throws(OmniAPIError) -> OmniThread {
    try await send("POST", "/api/threads/\(uriComponent(id))/messages", body: MessageBody(prompt: prompt, mode: mode))
  }

  public func renameThread(_ id: String, title: String) async throws(OmniAPIError) -> OmniThread {
    try await send("PATCH", "/api/threads/\(uriComponent(id))", body: TitleBody(title: title))
  }

  public func archiveThread(_ id: String, archived: Bool = true) async throws(OmniAPIError) -> OmniThread {
    try await send("PATCH", "/api/threads/\(uriComponent(id))", body: ArchivedBody(archived: archived))
  }

  public func stopThread(_ id: String) async throws(OmniAPIError) -> OmniThread {
    try await send("POST", "/api/threads/\(uriComponent(id))/stop")
  }

  // MARK: Streams

  /// SSE of `ThreadStreamMessage`. `after` is the last event id already shown.
  public func threadStreamURL(_ id: String, after: Int) -> URL {
    url("/api/threads/\(uriComponent(id))/stream", query: [("after", String(after))])
  }

  /// SSE of `FeedEvent`.
  public var feedURL: URL { url("/api/feed") }

  // MARK: Plumbing

  func url(_ path: String, query: [(String, String)] = []) -> URL {
    let q = query.map { "\(uriComponent($0.0))=\(uriComponent($0.1))" }.joined(separator: "&")
    let text = baseURL.absoluteString + path + (q.isEmpty ? "" : "?\(q)")
    guard let url = URL(string: text) else { preconditionFailure("Not a URL: \(text)") }
    return url
  }

  func send<T: Decodable>(
    _ method: String, _ path: String, query: [(String, String)] = [], body: (any Encodable & Sendable)? = nil,
    raw: (data: Data, contentType: String)? = nil
  ) async throws(OmniAPIError) -> T {
    var req = URLRequest(url: url(path, query: query))
    req.httpMethod = method
    req.cachePolicy = .reloadIgnoringLocalCacheData
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    if let raw {
      req.setValue(raw.contentType, forHTTPHeaderField: "Content-Type")
      req.httpBody = raw.data
    } else if let body {
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      do {
        req.httpBody = try OmniJSON.encoder().encode(body)
      } catch {
        throw .decoding("could not encode the request: \(error)")
      }
    }

    let (data, response) = try await exchange(req)
    let type = response.value(forHTTPHeaderField: "Content-Type")
    guard Self.isJSON(type) else { throw .notJSON(status: response.statusCode, contentType: type) }
    do {
      return try OmniJSON.decoder().decode(T.self, from: data)
    } catch {
      throw .decoding(Self.describe(error))
    }
  }

  /// A file the server serves, such as an upload, as it is.
  public func file(_ url: URL) async throws(OmniAPIError) -> Data {
    var req = URLRequest(url: url)
    req.cachePolicy = .reloadIgnoringLocalCacheData
    return try await exchange(req).0
  }

  /// Sends the request. A status outside 2xx throws with the server's message.
  private func exchange(_ req: URLRequest) async throws(OmniAPIError) -> (Data, HTTPURLResponse) {
    let data: Data
    let response: HTTPURLResponse
    do {
      (data, response) = try await transport.send(req)
    } catch let e as URLError where e.code == .cancelled {
      throw .cancelled
    } catch is CancellationError {
      throw .cancelled
    } catch {
      throw .unreachable(error.localizedDescription)
    }
    guard (200..<300).contains(response.statusCode) else {
      let type = response.value(forHTTPHeaderField: "Content-Type")
      throw .http(status: response.statusCode, message: Self.errorMessage(data, contentType: type, status: response.statusCode))
    }
    return (data, response)
  }

  static func isJSON(_ contentType: String?) -> Bool {
    guard let media = contentType?.split(separator: ";").first?.trimmingCharacters(in: .whitespaces).lowercased() else { return false }
    return media == "application/json" || media.hasSuffix("+json")
  }

  /// Like the Web UI: the `{error}` field, else the first 300 characters of the text, else the status.
  static func errorMessage(_ data: Data, contentType: String?, status: Int) -> String {
    if let e = try? JSONDecoder().decode(ErrorBody.self, from: data), !e.error.isEmpty { return e.error }
    let isHTML = contentType?.lowercased().hasPrefix("text/html") ?? false
    let text = String(decoding: data, as: UTF8.self)
    if !isHTML, !text.isEmpty { return String(text.prefix(300)) }
    return "Request failed (\(status))"
  }

  static func describe(_ error: any Error) -> String {
    guard let e = error as? DecodingError else { return "\(error)" }
    func at(_ path: [any CodingKey]) -> String {
      path.isEmpty ? "the top level" : path.map { $0.intValue.map(String.init) ?? $0.stringValue }.joined(separator: ".")
    }
    switch e {
    case .keyNotFound(let key, let ctx): return "\(at(ctx.codingPath + [key])) is missing"
    case .valueNotFound(_, let ctx): return "\(at(ctx.codingPath)) is null"
    case .typeMismatch(_, let ctx), .dataCorrupted(let ctx): return "\(at(ctx.codingPath)): \(ctx.debugDescription)"
    @unknown default: return "\(error)"
    }
  }
}
