import OmniKit
import SwiftUI

/// NextThreadCard.tsx: the follow-up thread the server proposed once the turn was done. Start runs it as a new thread
/// on this one's channel, harness, model and role; Do it here sends it as the next reply; Edit opens the new-thread
/// composer with it.
struct NextThreadCard: View {
  let model: AppModel
  let store: ThreadStore
  let thread: OmniThread
  let title: String
  let prompt: String
  @State private var busy: Action?
  @State private var error: String?

  enum Action { case start, here, dismiss }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("New thread")
        .font(.omni(size: 12, weight: .medium))
        .foregroundStyle(Tok.fg3)
        .padding(.horizontal, z(16))
        .padding(.vertical, z(8))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tok.surface2)
      HStack(alignment: .top, spacing: z(8)) {
        VStack(alignment: .leading, spacing: z(4)) {
          Text(title)
            .font(.omni(size: 14.5, weight: .semibold))
            .foregroundStyle(Tok.fg)
            .fixedSize(horizontal: false, vertical: true)
          Text(prompt)
            .font(.omni(size: 13))
            .lineSpacing(3)
            .foregroundStyle(Tok.fg3)
            .lineLimit(3)
            .fixedSize(horizontal: false, vertical: true)
            .help(prompt)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        Button { run(.dismiss) } label: {
          Label { Text("Dismiss") } icon: { OmniIcon(name: "x", size: 13) }
        }
        .buttonStyle(.icon(size: 26))
        .disabled(busy != nil)
      }
      .padding(.horizontal, z(16))
      .padding(.top, z(12))
      HStack(spacing: z(6)) {
        Button {
          model.openNewThread(.suggested(thread, prompt: prompt))
        } label: {
          Label { Text("Edit") } icon: { OmniIcon(name: "pencil", size: 13) }
            .labelStyle(.titleAndIcon)
        }
        .buttonStyle(.pill(.ghost, height: 28))
        .disabled(busy != nil)
        Spacer(minLength: 0)
        Button { run(.here) } label: { label("Do it here", busy: busy == .here) }
          .buttonStyle(.pill(.ghost, height: 28))
          .help("Send it as the next reply in this thread")
          .disabled(busy != nil)
        Button { run(.start) } label: { label("Start", busy: busy == .start) }
          .buttonStyle(.pill(.primary, height: 28))
          .help("Start it as a new thread with this thread's settings")
          .disabled(busy != nil)
      }
      .padding(.horizontal, z(12))
      .padding(.top, z(10))
      .padding(.bottom, z(12))
      if let error {
        ErrorNote(text: error)
          .padding(.horizontal, z(12))
          .padding(.bottom, z(12))
      }
    }
    .background(Tok.surface)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Tok.line))
    .frame(maxWidth: z(560), alignment: .leading)
    .padding(.top, z(8))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Suggested new thread")
  }

  private func label(_ text: String, busy: Bool) -> some View {
    HStack(spacing: z(6)) {
      if busy { Loader(size: 12) }
      Text(text)
    }
  }

  private func run(_ action: Action) {
    guard busy == nil else { return }
    busy = action
    error = nil
    let client = model.client
    Task {
      defer { busy = nil }
      do {
        switch action {
        case .start:
          let t = try await client.createThread(NewThread(continuing: thread, prompt: prompt))
          // Started: the card has done its job here. A failed dismiss only leaves it showing.
          if let d = try? await client.dismissNextThread(thread.id) { store.merge(d) }
          model.route = .thread(id: t.id)
        case .here:
          store.merge(try await client.reply(to: thread.id, prompt: prompt, mode: nil, files: []), isReply: true)
        case .dismiss:
          store.merge(try await client.dismissNextThread(thread.id))
        }
      } catch let e as OmniAPIError {
        error = e.message
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
