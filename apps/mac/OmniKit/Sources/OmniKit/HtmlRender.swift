import Foundation

/// A page an agent showed inline with Omni's html_render tool: `renderedFrom` in packages/shared/html-render.ts.
/// packages/test-fixtures/html-render.json keeps the two in step.
public struct RenderedPage: Hashable, Sendable {
  /// The artifact row the page was saved as.
  public let artifact: Int
  public let title: String

  public init(artifact: Int, title: String) {
    self.artifact = artifact
    self.title = title
  }

  /// The tallest an inline page grows before it scrolls inside its frame. A page that grows with its frame stops here.
  public static let maxHeight: Double = 6000

  /// Harnesses name it `mcp__omni-render__html_render`, or with an underscore for the dash (Codex).
  public static func isRenderTool(_ name: String) -> Bool {
    name.range(of: #"^mcp__omni[-_]render__html_render$"#, options: .regularExpression) != nil
  }

  /// The page a call showed, or nil when the call is something else, still runs, or failed.
  public static func from(name: String, input: JSONValue, result: ToolResult?) -> RenderedPage? {
    from(name: name, input: input, text: result?.text, isError: result?.isError ?? true)
  }

  static func from(name: String, input: JSONValue, text: String?, isError: Bool) -> RenderedPage? {
    guard isRenderTool(name), let text, !isError,
      let r = text.range(of: #"\(artifact \d+\)"#, options: .regularExpression),
      let id = Int(text[r].dropFirst("(artifact ".count).dropLast())
    else { return nil }
    let title = input["title"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return RenderedPage(artifact: id, title: title.isEmpty ? "Page" : String(title.prefix(200)))
  }

  /// The pages a tool group's calls showed, sub-agents' calls included, in call order.
  public static func shown(in group: ToolGroup) -> [RenderedPage] {
    func visit(_ calls: [ToolCall]) -> [RenderedPage] {
      calls.flatMap { c in [from(name: c.name, input: c.use.input, result: c.result)].compactMap { $0 } + visit(c.children) }
    }
    return visit(group.calls)
  }
}
