import OmniKit
import SwiftUI

/// The reply box's thread reference button and the picker it opens, as `ThreadReferenceButton` in ThreadReference.tsx: a
/// search over thread titles and channels, this channel unless Ben switches to All channels. A pick adds a chip to the
/// draft. Nothing is sent to, started in or changed on the picked thread. The `@` menu for files is untouched.
struct ThreadReferenceButton: View {
  let disabled: Bool
  @State private var picker: ThreadReferencePicker
  @State private var open = false

  init(client: OmniClient, thread: OmniThread, draft: DraftContextModel, disabled: Bool) {
    self.disabled = disabled
    _picker = State(initialValue: ThreadReferencePicker(threadID: thread.id, channelID: thread.channelID, api: client, draft: draft))
  }

  var body: some View {
    Button {
      if !open { picker.reset() }
      open.toggle()
    } label: {
      OmniIcon(name: "message", size: 15)
    }
    .buttonStyle(.icon(size: 30))
    .disabled(disabled)
    .help("Reference another thread")
    .accessibilityLabel("Reference another thread")
    .popover(isPresented: $open, arrowEdge: .top) {
      ThreadReferencePanel(picker: picker) { open = false }
    }
    #if DEBUG
    .onAppear { ThreadReferenceProbe.open = { open = $0 } }
    .onDisappear { ThreadReferenceProbe.open = nil }
    #endif
  }
}

struct ThreadReferencePanel: View {
  @Bindable var picker: ThreadReferencePicker
  let picked: () -> Void
  @FocusState private var searching: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: z(8)) {
        OmniIcon(name: "search", size: 15).foregroundStyle(Tok.fg4)
        TextField("Search threads by title or channel", text: $picker.query)
          .textFieldStyle(.plain)
          .font(.omni(size: 13))
          .foregroundStyle(Tok.fg)
          .focused($searching)
          .accessibilityLabel("Search threads by title or channel")
      }
      .padding(.horizontal, z(12))
      .frame(height: z(36))
      .background(Tok.surface2, in: Capsule())
      .padding([.horizontal, .top], z(12))
      HStack(spacing: z(4)) {
        ForEach(ThreadReferenceScope.allCases, id: \.self) { s in
          Button(s.title) { picker.scope = s }
            .buttonStyle(.plain)
            .font(.omni(size: 12.5, weight: .medium))
            .foregroundStyle(picker.scope == s ? Tok.fg : Tok.fg3)
            .padding(.horizontal, z(12))
            .frame(height: z(26))
            .background(picker.scope == s ? Tok.surface2 : .clear, in: Capsule())
            .accessibilityAddTraits(picker.scope == s ? .isSelected : [])
        }
      }
      .padding(.horizontal, z(12))
      .padding(.top, z(8))
      if picker.scope == .all {
        Text("Picking a thread from another channel attaches it on purpose. Nothing else of that channel is shared.")
          .font(.omni(size: 11.5))
          .foregroundStyle(Tok.fg3)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, z(16))
          .padding(.top, z(8))
      }
      list
      if let problem = picker.problem {
        Text(problem).font(.omni(size: 12)).foregroundStyle(Tok.fg3).padding(.horizontal, z(16)).padding(.bottom, z(8))
      }
      Hairline()
      Text("Attaches a reference, not the thread's messages. The agent reads it only when it needs to, and the thread itself is not touched.")
        .font(.omni(size: 11.5))
        .foregroundStyle(Tok.fg3)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, z(16))
        .padding(.vertical, z(10))
    }
    .frame(width: z(360))
    .background(Tok.elev)
    .task(id: SearchKey(query: picker.query, scope: picker.scope)) {
      // A beat after the last keystroke; the first search at once.
      if picker.settled || !picker.rows.isEmpty { try? await Task.sleep(for: .milliseconds(120)) }
      if !Task.isCancelled { await picker.search() }
    }
    .onAppear { searching = true }
  }

  private struct SearchKey: Hashable {
    let query: String
    let scope: ThreadReferenceScope
  }

  @ViewBuilder private var list: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        if let e = picker.error {
          note("Could not search: \(e)")
        } else if picker.rows.isEmpty && picker.settled {
          note(picker.query.trimmingCharacters(in: .whitespaces).isEmpty ? "No other threads in this channel yet." : "No thread matches.")
        }
        ForEach(picker.rows) { c in
          row(c)
        }
      }
      .padding(.horizontal, z(6))
      .padding(.vertical, z(8))
    }
    .frame(minHeight: z(80), maxHeight: z(300))
  }

  private func note(_ text: String) -> some View {
    Text(text).font(.omni(size: 12.5)).foregroundStyle(Tok.fg3).padding(.horizontal, z(10)).padding(.vertical, z(8))
  }

  private func row(_ c: ThreadReferenceCandidate) -> some View {
    let on = picker.isAttached(c.id)
    let when = OmniJSON.parseDate(c.updatedAt).map { RelTime.label($0) } ?? ""
    return Button {
      if picker.attach(c) { picked() }
    } label: {
      HStack(spacing: z(10)) {
        StatusDot(status: ThreadStatus(rawValue: c.status))
        VStack(alignment: .leading, spacing: 1) {
          Text(c.title).font(.omni(size: 13, weight: .medium)).foregroundStyle(Tok.fg).lineLimit(1)
          Text("\(c.channelName) · \(c.shortID)\(when.isEmpty ? "" : " · \(when)")").font(.omni(size: 11.5)).foregroundStyle(Tok.fg4).lineLimit(1)
        }
        Spacer(minLength: z(4))
        if !c.sameChannel { ReferenceBadge(text: "other channel") }
        if c.archived { ReferenceBadge(text: "archived") }
        if on { OmniIcon(name: "check", size: 14).foregroundStyle(Tok.fg3) }
      }
      .padding(.horizontal, z(10))
      .frame(minHeight: z(44))
      .contentShape(RoundedRectangle(cornerRadius: z(16), style: .continuous))
    }
    .buttonStyle(.plain)
    .disabled(on)
    .opacity(on ? 0.5 : 1)
    .accessibilityLabel("\(c.title), \(c.channelName), \(c.shortID)\(c.sameChannel ? "" : ", other channel")")
  }
}

#if DEBUG
/// QA: the open reply box's thread reference popover.
@MainActor enum ThreadReferenceProbe {
  static var open: ((Bool) -> Void)?
}
#endif
