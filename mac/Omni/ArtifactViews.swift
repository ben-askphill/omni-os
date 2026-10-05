import AppKit
import OmniKit
import PDFKit
import SwiftUI
import UniformTypeIdentifiers

func artifactSymbol(_ kind: String) -> String {
  switch kind {
  case "image", "screenshot": "photo"
  case "html", "svg": "globe"
  case "pdf": "doc.richtext"
  case "csv": "tablecells"
  default: "doc.text"
  }
}

/// The web's kindIcon: the OmniIcon for an artifact kind.
func artifactIcon(_ kind: String) -> String {
  switch kind {
  case "image", "screenshot": "image"
  case "html", "svg": "globe"
  default: "file"
  }
}

/// A file's header (name, kind, size, age, and the window and download buttons) over its rendering.
struct ArtifactViewer: View {
  let client: OmniClient
  let ref: ArtifactRef
  var windowed = false
  @Environment(\.openWindow) private var openWindow
  @Environment(\.openURL) private var openURL
  @State private var saveError: String?
  @State private var comments = CommentsAsk.idle

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 10) {
        OmniIcon(name: artifactIcon(ref.kind), size: 14)
          .foregroundStyle(Tok.fg3)
          .frame(width: 30, height: 30)
          .background(Tok.surface2, in: Circle())
        VStack(alignment: .leading, spacing: 1) {
          Text(ref.name).font(.system(size: 11.5, weight: .medium, design: .monospaced)).foregroundStyle(Tok.fg)
            .lineLimit(1).truncationMode(.middle)
          Text("\(ref.kind) · \(Format.bytes(ref.size)) · \(ref.url == nil ? "updated" : "published") \(Format.relTime(ref.updatedAt))")
            .font(.system(size: 11).monospacedDigit())
            .foregroundStyle(Tok.fg4)
            .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        if let url = ref.url, let threadID = ref.threadID {
          Button {
            Task { comments = .sending; comments = await CommentsAsk.run(client: client, threadID: threadID, url: url) }
          } label: {
            Label { Text("Check comments") } icon: { OmniIcon(name: comments == .sent ? "check" : "message", size: 15) }
          }
          .buttonStyle(.icon(size: 30))
          .disabled(comments == .sending || comments == .sent)
          .help(comments.help)
          if let link = URL(string: url) {
            Button { openURL(link) } label: {
              Label { Text("Open on claude.ai") } icon: { OmniIcon(name: "globe", size: 15) }
            }
            .buttonStyle(.icon(size: 30))
            .help("Open on claude.ai")
          }
        }
        if !windowed {
          Button {
            openWindow(id: "artifact", value: ref)
          } label: {
            Label("Open in its own window", systemImage: "arrow.up.forward.app")
          }
          .buttonStyle(.icon(size: 30))
          .help("Open in its own window")
        }
        Button {
          Task { saveError = await ArtifactSaver.save(client: client, ref: ref) }
        } label: {
          Label { Text("Download") } icon: { OmniIcon(name: "download", size: 15) }
        }
        .buttonStyle(.icon(size: 30))
        .help("Download")
      }
      .padding(.vertical, 8)
      .padding(.horizontal, 12)
      Hairline()
      if let saveError {
        ErrorNote(text: saveError).padding(8)
      }
      ArtifactBody(client: client, ref: ref)
    }
  }
}

/// Asking a thread to act on the comments on a page it published: the ask, then what came of it.
enum CommentsAsk: Equatable {
  case idle, sending, sent
  case failed(String)

  var help: String {
    switch self {
    case .sent: "Asked the thread to check comments. It runs after the current turn."
    case .failed(let message): message
    default: "Check comments on claude.ai"
    }
  }

  @MainActor
  static func run(client: OmniClient, threadID: String, url: String) async -> CommentsAsk {
    do {
      _ = try await client.checkComments(threadID: threadID, url: url)
      return .sent
    } catch {
      return .failed(error.message)
    }
  }
}

@MainActor
enum ArtifactSaver {
  /// Asks where to save, then writes the file. Returns an error line, or nil (also when cancelled).
  static func save(client: OmniClient, ref: ArtifactRef) async -> String? {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = ref.name
    panel.canCreateDirectories = true
    guard await panel.begin() == .OK, let url = panel.url else { return nil }
    do {
      try await client.artifactData(ref).write(to: url)
      return nil
    } catch let error as OmniAPIError {
      return error.message
    } catch {
      return "Could not save \(ref.name)."
    }
  }
}

/// The file itself, natively where it can be.
struct ArtifactBody: View {
  let client: OmniClient
  let ref: ArtifactRef
  @State private var phase = Phase.loading

  private enum Phase {
    case loading, loaded(Data), failed(String)
  }

  var body: some View {
    if ref.isWeb {
      ArtifactWebView(client: client, ref: ref)
    } else if !["pdf", "image", "screenshot", "markdown", "csv", "json", "text"].contains(ref.kind) {
      Text("No preview for this file type. Download it instead.")
        .font(.system(size: 13))
        .foregroundStyle(Tok.fg3)
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    } else {
      Group {
        switch phase {
        case .loading:
          LoadingNote().padding(.horizontal, 12).frame(maxHeight: .infinity, alignment: .top)
        case .failed(let message):
          VStack { ErrorNote(text: message) { phase = .loading; Task { await load() } }.padding(12); Spacer() }
        case .loaded(let data):
          NativeBody(ref: ref, data: data)
        }
      }
      .task(id: ref) { await load() }
    }
  }

  private func load() async {
    phase = .loading
    do {
      phase = .loaded(try await client.artifactData(ref))
    } catch {
      phase = .failed("Could not load \(ref.name) (\(error.message))")
    }
  }
}

private struct NativeBody: View {
  let ref: ArtifactRef
  let data: Data

  var body: some View {
    switch ref.kind {
    case "pdf":
      PDFArtifactView(data: data)
    case "image", "screenshot":
      if let image = NSImage(data: data) {
        ScrollView([.horizontal, .vertical]) {
          Image(nsImage: image)
            .resizable()
            .scaledToFit()
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
            .padding(12)
            .frame(maxWidth: .infinity)
        }
      } else {
        Text("This image could not be read.").font(.system(size: 13)).foregroundStyle(Tok.fg3).padding(16)
      }
    case "markdown":
      ScrollView {
        MarkdownView(document: MarkdownDocument(parsing: String(decoding: data, as: UTF8.self)))
          .padding(.horizontal, 20)
          .padding(.vertical, 16)
          .frame(maxWidth: .infinity, alignment: .leading)
          .textSelection(.enabled)
      }
    case "csv":
      CSVTableView(text: String(decoding: data, as: UTF8.self))
    default:
      PlainTextView(text: ref.kind == "json" ? Self.pretty(data) : String(decoding: data, as: UTF8.self))
    }
  }

  private static func pretty(_ data: Data) -> String {
    let text = String(decoding: data, as: UTF8.self)
    return ThreadDetails.prettyJSON(text) ?? text
  }
}

private struct PlainTextView: View {
  let text: String
  private static let limit = 400_000

  var body: some View {
    ScrollView([.vertical]) {
      VStack(alignment: .leading, spacing: 8) {
        Text(text.count > Self.limit ? String(text.prefix(Self.limit)) : text)
          .font(.system(size: 12, design: .monospaced))
          .foregroundStyle(Tok.fg2)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
        if text.count > Self.limit {
          Text("Showing the first \(Self.limit / 1000) KB. Download for the full file.")
            .font(.system(size: 11.5)).foregroundStyle(Tok.fg4)
        }
      }
      .padding(12)
    }
  }
}

private struct CSVTableView: View {
  let text: String
  @State private var table: CSV.Table?

  var body: some View {
    Group {
      if let table {
        if let head = table.rows.first {
          let width = head.count
          ScrollView([.horizontal, .vertical]) {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: .sectionHeaders) {
              Section {
                ForEach(Array(table.rows.dropFirst().enumerated()), id: \.offset) { _, row in
                  csvRow(row, width: width, header: false)
                }
              } header: {
                csvRow(head, width: width, header: true).background(Tok.surface)
              }
              if table.truncated {
                Text("Showing the first 500 rows. Download for the full file.")
                  .font(.system(size: 11.5)).foregroundStyle(Tok.fg4).padding(8)
              }
            }
          }
        } else {
          Text("Empty file").font(.system(size: 13)).foregroundStyle(Tok.fg3).padding(16)
        }
      } else {
        LoadingNote().padding(.horizontal, 12)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .task(id: text) { table = CSV.parse(text) }
  }

  private func csvRow(_ row: [String], width: Int, header: Bool) -> some View {
    HStack(alignment: .top, spacing: 0) {
      ForEach(0..<max(width, row.count), id: \.self) { i in
        Text(i < row.count ? row[i] : "")
          .font(.system(size: 12, weight: header ? .medium : .regular))
          .foregroundStyle(header ? Tok.fg3 : Tok.fg)
          .lineLimit(header ? 1 : 3)
          .frame(width: 180, alignment: .leading)
          .padding(.horizontal, 10)
          .padding(.vertical, header ? 7 : 5)
          .textSelection(.enabled)
      }
    }
    .overlay(alignment: .bottom) { Hairline() }
  }
}

private struct PDFArtifactView: NSViewRepresentable {
  let data: Data

  func makeNSView(context: Context) -> PDFView {
    let view = PDFView()
    view.autoScales = true
    view.document = PDFDocument(data: data)
    return view
  }

  func updateNSView(_ view: PDFView, context: Context) {}
}

/// The `Open in its own window` scene's content.
struct ArtifactWindowView: View {
  let model: AppModel
  let ref: ArtifactRef

  var body: some View {
    ArtifactViewer(client: model.client, ref: ref, windowed: true)
      .navigationTitle(ref.name)
      .frame(minWidth: 480, minHeight: 360)
  }
}
