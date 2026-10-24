import Foundation

extension OmniClient: ToolOutputAPI {
  /// One chunk of a tool_result's saved text, from `offset`: 0, then each chunk's `next`.
  public func toolOutputChunk(threadID: String, eventID: Int, offset: Int) async throws(OmniAPIError) -> OutputChunk {
    try await send("GET", "/api/threads/\(uriComponent(threadID))/events/\(eventID)/output", query: ToolOutput.query(offset: offset))
  }

  public func toolTail(threadID: String, toolUseID: String) -> AsyncStream<TailMessage> {
    toolTail(threadID: threadID, toolUseID: toolUseID, transport: URLSessionSSETransport.shared)
  }

  /// A running call's tail. It reconnects as the thread stream does, and each connection starts with a `reset`. The
  /// stream finishes after `end`; ending the iteration closes the connection.
  public func toolTail(
    threadID: String, toolUseID: String, transport: any SSETransport, clock: any Clock<Duration> = ContinuousClock()
  ) -> AsyncStream<TailMessage> {
    let address = url("/api/threads/\(uriComponent(threadID))/tools/\(uriComponent(toolUseID))/tail")
    let sse = SSEClient(transport: transport, clock: clock, request: { [self] _ in authorized(address) }, decode: Self.json(TailMessage.self))
    let (messages, out) = AsyncStream<TailMessage>.makeStream()
    let reader = Task {
      for await case .message(let m) in sse.events {
        out.yield(m)
        if case .end = m { break }
      }
      sse.close()
      out.finish()
    }
    out.onTermination = { _ in reader.cancel() }
    sse.start()
    return messages
  }
}
