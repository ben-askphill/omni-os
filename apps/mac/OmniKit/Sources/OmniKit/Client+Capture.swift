import Foundation

private struct CaptureRequest: Encodable, Sendable {
  let thread: String
}

private struct PickRequest: Encodable, Sendable {
  let thread: String
  let x: Int
  let y: Int
}

private struct InspectRequest: Encodable, Sendable {
  let x: Int
  let y: Int
}

private struct ScriptReply: Decodable {
  let script: String
}

private struct RemovedReply: Decodable {
  let removed: Bool
}

extension OmniClient {
  private func capturePath(_ channel: String, _ rest: String = "") -> String {
    "/api/channels/\(uriComponent(channel))/browser/capture\(rest)"
  }

  /// A screenshot of the channel browser's active page for the thread, with the page's address, title, viewport and
  /// scroll (apps/server/browser-capture.ts). It changes nothing on the page. A page that moved while it was taken, a
  /// browser that is off and a tab that is not a web page come back as a `BrowserCaptureError` with the server's words.
  public func captureBrowser(channel: String, thread: String) async throws(BrowserCaptureError) -> BrowserAnnotationContext.Capture {
    var req = authorized(url(capturePath(channel)))
    req.httpMethod = "POST"
    req.cachePolicy = .reloadIgnoringLocalCacheData
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    do {
      req.httpBody = try OmniJSON.encoder().encode(CaptureRequest(thread: thread))
    } catch {
      throw BrowserCaptureError(message: "The request could not be made.", retryable: false)
    }
    let data: Data
    let response: HTTPURLResponse
    do {
      (data, response) = try await transport.send(req)
    } catch {
      throw BrowserCaptureError(message: OmniAPIError.unreachable(error.localizedDescription).message, retryable: true)
    }
    guard (200..<300).contains(response.statusCode) else {
      if let body = try? JSONDecoder().decode(BrowserCaptureFailureBody.self, from: data) {
        throw BrowserCaptureError(message: body.error, retryable: body.retryable, stale: body.stale)
      }
      let type = response.value(forHTTPHeaderField: "Content-Type")
      throw BrowserCaptureError(message: Self.errorMessage(data, contentType: type, status: response.statusCode), retryable: false)
    }
    do {
      return try OmniJSON.decoder().decode(BrowserCaptureReply.self, from: data).capture
    } catch {
      throw BrowserCaptureError(message: OmniAPIError.decoding(Self.describe(error)).message, retryable: false)
    }
  }

  /// Saves a screenshot the Mac took of its own web view as the thread's capture (apps/server/browser-capture.ts
  /// `saveNativeCapture`): the same record numbers a server capture gives, so Annotate goes on as it does for the agent's
  /// browser. A page whose size does not fit the image comes back retryable. The server takes images up to `BrowserNativeCapture.maxBytes`.
  public func captureNative(channel: String, thread: String, page: NativeBrowserPage, image: Data, mime: String) async throws(BrowserCaptureError) -> BrowserAnnotationContext.Capture {
    let query: [(String, String)] = [
      ("thread", thread), ("url", page.url), ("title", page.title),
      ("vw", String(page.viewportWidth)), ("vh", String(page.viewportHeight)),
      ("sx", String(page.scrollX)), ("sy", String(page.scrollY)),
    ]
    do {
      let reply: BrowserCaptureReply = try await send("POST", capturePath(channel, "/native"), query: query, raw: (image, mime))
      return reply.capture
    } catch {
      if case .http(let status, let message) = error { throw BrowserCaptureError(message: message, retryable: status == 409, stale: status == 409 ? "viewport" : nil) }
      throw BrowserCaptureError(message: error.message, retryable: true)
    }
  }

  /// The script that reads the element at (`x`, `y`) out of a page (apps/server/browser-pick-script.ts), to run in the web view.
  public func pickScript(channel: String, x: Int, y: Int) async throws(OmniAPIError) -> String {
    let reply: ScriptReply = try await send("GET", "/api/channels/\(uriComponent(channel))/browser/pick-script", query: [("x", String(x)), ("y", String(y))])
    return reply.script
  }

  /// What the web view's page answered to `pickScript`, as JSON: the server bounds and checks it as it does for its own browser.
  public func pickElementNative(channel: String, thread: String, name: String, x: Int, y: Int, viewport: (width: Int, height: Int), raw: Data) async throws(OmniAPIError) -> ElementPickReply {
    let head = "{\"thread\":\(Self.jsonString(thread)),\"x\":\(x),\"y\":\(y),\"viewport\":{\"width\":\(viewport.width),\"height\":\(viewport.height)},\"raw\":"
    var body = Data(head.utf8)
    body.append(raw)
    body.append(Data("}".utf8))
    return try await send("POST", capturePath(channel, "/\(uriComponent(name))/element/native"), raw: (body, "application/json"))
  }

  private static func jsonString(_ s: String) -> String {
    (try? String(data: JSONEncoder().encode(s), encoding: .utf8)) ?? "\"\""
  }

  /// Deletes a capture nothing was made of. Best effort: a capture left behind is only a file in the uploads folder.
  public func discardCapture(channel: String, thread: String, name: String) async {
    let _: RemovedReply? = try? await send("DELETE", capturePath(channel, "/\(uriComponent(name))"), query: [("thread", thread)])
  }

  /// What is at (`x`, `y`), in CSS pixels from the viewport's top left, on the page `name` was captured of
  /// (apps/server/browser-pick.ts). A page that moved on, a frame from another site and a screenshot the server no longer
  /// holds answer `.unavailable` with its words: the screenshot and the marked area still go with the message.
  public func pickElement(channel: String, thread: String, name: String, x: Int, y: Int) async throws(OmniAPIError) -> ElementPickReply {
    try await send("POST", capturePath(channel, "/\(uriComponent(name))/element"), body: PickRequest(thread: thread, x: x, y: y))
  }

  /// The element under the pointer at (`x`, `y`), whole CSS pixels in the live page's viewport (apps/server/browser-pick.ts
  /// `inspectApi`), for the live Annotate overlay's hover. It reads the page and changes nothing; nothing is saved.
  public func inspectElement(channel: String, x: Int, y: Int) async throws(OmniAPIError) -> ElementInspectReply {
    try await send("POST", "/api/channels/\(uriComponent(channel))/browser/inspect", body: InspectRequest(x: max(0, x), y: max(0, y)))
  }

  /// Saves the screenshot `name` with Ben's marks rendered on it by this client (apps/server/browser-capture.ts), and gives
  /// the record's `marked` image. The server checks it is a PNG or JPEG of the capture's own size.
  public func uploadMarked(channel: String, thread: String, name: String, image: Data, mime: String) async throws(OmniAPIError) -> BrowserAnnotationContext.Image {
    let reply: MarkedReply = try await send("POST", capturePath(channel, "/\(uriComponent(name))/marked"), query: [("thread", thread)], raw: (image, mime))
    return reply.marked
  }

  /// Renders Ben's marks onto the screenshot the server took, and saves the result beside it as the record's `marked` image.
  /// The screenshot comes from the thread's uploads, so what is drawn on is the very image the record names.
  public func uploadMarkedScreenshot(channel: String, capture: BrowserAnnotationContext.Capture, marks: [BrowserMarks.Mark]) async throws(OmniAPIError) -> BrowserAnnotationContext.Image {
    var req = authorized(uploadURL(threadID: capture.thread, name: capture.image.name))
    req.cachePolicy = .reloadIgnoringLocalCacheData
    let data: Data
    do {
      let (body, response) = try await transport.send(req)
      guard (200..<300).contains(response.statusCode) else { throw OmniAPIError.http(status: response.statusCode, message: "The screenshot could not be loaded to mark it.") }
      data = body
    } catch let e as OmniAPIError {
      throw e
    } catch {
      throw OmniAPIError.unreachable(error.localizedDescription)
    }
    guard let drawn = BrowserMarks.render(image: data, marks: marks, viewportWidth: capture.viewport.width) else {
      throw OmniAPIError.http(status: 0, message: "Could not render the marks onto the screenshot.")
    }
    return try await uploadMarked(channel: channel, thread: capture.thread, name: capture.image.name, image: drawn.data, mime: drawn.mime)
  }
}
