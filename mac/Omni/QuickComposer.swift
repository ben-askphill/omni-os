import OmniKit
import SwiftUI

/// Starts a thread from Home or a channel: a prompt, a channel and Send. The pickers for role, model and
/// effort are the new-thread composer's (#65); this stands in until Home and Channel take that one.
struct QuickComposer: View {
  let model: AppModel
  /// Fixes the channel, on a channel screen. Nil on Home, which shows a channel picker.
  var channelID: String?
  var big = false
  var placeholder: String?
  @State private var text = ""
  @State private var picked = SidebarSections.conductorID
  @State private var sending = false
  @State private var error: String?
  @FocusState private var focused: Bool

  private var channel: String { channelID ?? picked }
  private var canSend: Bool { !sending && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      VStack(spacing: 0) {
        TextEditor(text: $text)
          .font(.system(size: big ? 16 : 14.5))
          .scrollContentBackground(.hidden)
          .focused($focused)
          .frame(minHeight: big ? 96 : 60, maxHeight: 260)
          .padding(.horizontal, 12)
          .padding(.top, 8)
          .overlay(alignment: .topLeading) {
            if text.isEmpty {
              Text(placeholder ?? defaultPlaceholder)
                .font(.system(size: big ? 16 : 14.5))
                .foregroundStyle(.tertiary)
                .padding(.horizontal, 17)
                .padding(.top, 8)
                .allowsHitTesting(false)
            }
          }
        HStack(spacing: 10) {
          if channelID == nil { channelPicker }
          Spacer()
          Button(action: send) {
            if sending {
              ProgressView().controlSize(.small)
            } else {
              Label("Send", systemImage: "arrow.up")
                .labelStyle(.iconOnly)
            }
          }
          .buttonStyle(.borderedProminent)
          .buttonBorderShape(.circle)
          .disabled(!canSend)
          .keyboardShortcut(.return, modifiers: .command)
          .help("Send (⌘↩)")
        }
        .padding(.horizontal, 10)
        .padding(.bottom, 8)
        .padding(.top, 4)
      }
      .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 22))
      .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(focused ? Color.primary.opacity(0.25) : ThreadStyle.line))
      if let error { ErrorNote(text: error) }
    }
    .onAppear { focused = true }
    .onChange(of: model.shell.composerFocus) { focused = true }
  }

  private var defaultPlaceholder: String {
    channel == SidebarSections.conductorID ? "Ask the Conductor anything. It delegates to the crew." : "Describe the task"
  }

  private var channelPicker: some View {
    Picker("Channel", selection: $picked) {
      ForEach(model.store.channels) { c in
        Text(c.id == SidebarSections.conductorID ? "Conductor" : "#\(c.name)").tag(c.id)
      }
    }
    .pickerStyle(.menu)
    .labelsHidden()
    .fixedSize()
  }

  private func send() {
    let prompt = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !prompt.isEmpty, !sending else { return }
    sending = true
    error = nil
    let new = NewThread(channel: channel, prompt: prompt, role: channel == SidebarSections.conductorID ? "conductor" : nil)
    Task {
      do {
        let thread = try await model.client.createThread(new)
        text = ""
        model.route = .thread(id: thread.id)
      } catch {
        self.error = error.localizedDescription
      }
      sending = false
    }
  }
}
