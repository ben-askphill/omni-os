import OmniKit
import SwiftUI

extension EnvironmentValues {
  /// Where an open tool row reads its saved output and live tail. Nil outside a transcript.
  @Entry var toolOutputAPI: (any ToolOutputAPI)?
}

/// The output under an open tool row (#225). A whole result shows as it came. A compact one shows its preview at once,
/// then the saved output a chunk at a time; a call that runs shows what it prints. It reads only while the row is open:
/// closing it cancels the task, which closes the tail and the chunk in flight, and drops the model with its text.
struct ToolOutputView: View {
  let call: ToolCall
  let running: Bool
  @Environment(\.threadStore) private var store
  @Environment(\.toolOutputAPI) private var api
  @State private var output = ToolOutputModel()

  var body: some View {
    let source = store.flatMap { ToolOutputSource(call, threadID: $0.id, running: running) }
    VStack(alignment: .leading, spacing: z(6)) {
      if let result = call.result {
        if result.output == nil { whole(result) } else { saved(result) }
      } else {
        let live = running ? output.live : nil
        if let live, !live.text.isEmpty { Pre(text: live.text).defaultScrollAnchor(.bottom) }
        Text((running ? "Waiting for result" : "No result recorded") + (live?.cut == true ? " · older output not shown" : ""))
          .font(.omni(size: ThreadStyle.mono))
          .foregroundStyle(Tok.fg4)
      }
    }
    .task(id: source) {
      guard let source, let api else { return }
      await output.run(source, api: api)
    }
    #if DEBUG
    // QA snapshots of a press, which a script cannot click: `-OmniQALoadMore YES` presses Load more once, after the
    // first chunk lands.
    .onChange(of: output.saved != nil) { _, held in
      guard held, !qaPressed, UserDefaults.standard.bool(forKey: "OmniQALoadMore") else { return }
      qaPressed = true
      output.more()
    }
    #endif
  }

  #if DEBUG
  @State private var qaPressed = false
  #endif

  private var tone: Pre.Tone { call.isFailed ? .bad : .plain }

  @ViewBuilder private func whole(_ result: ToolResult) -> some View {
    Pre(text: result.text.isEmpty ? "(no output)" : result.text, tone: tone)
    if let row = store?.clippedResults[call.callID] {
      ClippedNote(eventID: row)
    } else if result.truncated {
      Text("Output truncated").font(.omni(size: 11)).foregroundStyle(Tok.fg4)
    }
  }

  @ViewBuilder private func saved(_ result: ToolResult) -> some View {
    let held = output.saved
    Pre(text: held?.text ?? result.text, tone: tone)
    if let error = output.error {
      HStack(spacing: z(8)) {
        Text(error.message).font(.omni(size: 12)).foregroundStyle(Tok.fg3).lineLimit(2)
        more("Retry")
      }
    } else if let held, held.left > 0 {
      more("Load more (\(held.left.formatted(.number.locale(Locale(identifier: "en_US")))) characters left)")
    } else if output.loading {
      HStack(spacing: z(6)) {
        Loader(size: 11, color: Tok.fg3)
        Text("Loading output")
      }
      .font(.omni(size: 11.5))
      .foregroundStyle(Tok.fg4)
    } else if held?.next == nil, held?.truncated == true {
      Text("Output truncated").font(.omni(size: 11)).foregroundStyle(Tok.fg4)
    }
  }

  /// Reads the next chunk: Load more, or Retry after a failure. Busy while one is on the way.
  private func more(_ title: String) -> some View {
    Button { output.more() } label: {
      HStack(spacing: z(6)) {
        if output.loading { Loader(size: 11, color: Tok.fg3) }
        Text(title).monospacedDigit()
      }
      .font(.omni(size: 12, weight: .medium))
    }
    .buttonStyle(.pill(.ghost, height: 28))
    .disabled(output.loading)
  }
}
