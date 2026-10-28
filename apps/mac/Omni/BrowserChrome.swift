import OmniKit
import SwiftUI

// The Chrome-like frame both browsers share: the Browser tab's live view of the agent's Chrome (`LiveBrowserView`) and the
// Web tab's own web view (`NativeBrowserView`). Each gives a `BrowserState` and takes the user's actions; the frame looks
// and acts the same.

/// Back, forward, reload, the address bar, Annotate and whatever the caller adds.
struct BrowserToolbar: View {
  let state: BrowserState
  let perform: (BrowserAction) -> Void
  var annotating: Annotating?
  var trailing: AnyView = AnyView(EmptyView())
  /// A new value puts the keys in the address bar: the page's Cmd-L.
  var focusAddress = 0
  /// Hands the keys back to the page: Return or Escape in the address bar, as in Chrome.
  let leave: () -> Void
  @State private var address = ""
  @FocusState private var editing: Bool

  var body: some View {
    let s = state
    HStack(spacing: z(2)) {
      Button("Back", systemImage: "chevron.left") { perform(.back) }
        .disabled(!s.canBack)
        .help("Back (⌘[)")
      Button("Forward", systemImage: "chevron.right") { perform(.forward) }
        .disabled(!s.canForward)
        .help("Forward (⌘])")
      if s.loading {
        Button("Stop loading", systemImage: "xmark") { perform(.stop) }
      } else {
        Button("Reload", systemImage: "arrow.clockwise") { perform(.reload) }
          .disabled(!s.running)
          .help("Reload (⌘R)")
      }
      HStack(spacing: z(7)) {
        // Nothing on the field itself changes with focus: a new alignment while it edits ends the edit, so a click
        // focused the bar and dropped the focus at once. The address at rest and the placeholder are drawn over it.
        TextField("", text: $address)
          .textFieldStyle(.plain)
          .font(.omni(size: 13))
          .foregroundStyle(editing ? Tok.fg : .clear)
          .overlay(alignment: editing ? .leading : .center) {
            Group {
              if editing {
                if address.isEmpty { Text("Search Google or type a URL").foregroundStyle(Tok.fg4) }
              } else if case let (host, path) = BrowserTabInfo.splitAddress(BrowserTabInfo.displayURL(address)), !host.isEmpty {
                Text(host).foregroundStyle(Tok.fg) + Text(path).foregroundStyle(Tok.fg4)
              } else {
                Text("Search Google or type a URL").foregroundStyle(Tok.fg4)
              }
            }
            .font(.omni(size: 13)).lineLimit(1).truncationMode(.tail).allowsHitTesting(false)
          }
          .focused($editing)
          .onSubmit {
            guard !address.trimmingCharacters(in: .whitespaces).isEmpty else { return }
            perform(.navigate(address))
            editing = false
            leave()
          }
          .onExitCommand {
            address = s.url == "about:blank" ? "" : s.url
            editing = false
            leave()
          }
      }
      .padding(.horizontal, z(11))
      .frame(height: z(34))
      #if DEBUG
      .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { BrowserAnnotateProbe.address = $0 }
      #endif
      .background(Tok.bg, in: Capsule())
      .overlay(Capsule().strokeBorder(editing ? Tok.lineStrong : Tok.line, lineWidth: editing ? 2 : 1))
      .contentShape(Capsule())
      .onTapGesture { editing = true }
      .padding(.leading, z(4))
      if let annotating {
        Button("Annotate", systemImage: "viewfinder") { Task { await annotating.model.start() } }
          .disabled(!s.running || !s.url.lowercased().hasPrefix("http") || annotating.model.isActive)
          .help("Annotate this page")
      }
      trailing
    }
    .labelStyle(.iconOnly)
    .buttonStyle(.icon(size: 28))
    .padding(.horizontal, z(6))
    .padding(.vertical, z(6))
    .onChange(of: s.url, initial: true) { _, url in
      if !editing { address = url == "about:blank" ? "" : url }
    }
    .onChange(of: focusAddress) { editing = true }
  }
}

/// Chrome's tab strip: every tab with its icon, the active one joined to the toolbar under it.
struct BrowserTabStrip: View {
  let state: BrowserState
  let perform: (BrowserAction) -> Void

  var body: some View {
    let s = state
    let tabs = s.tabs.isEmpty ? [BrowserTabInfo(id: "blank", url: "", title: s.running ? "New Tab" : "Starting")] : s.tabs
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(alignment: .center, spacing: z(4)) {
        ForEach(tabs) { tab in
          let on = tab.id == s.active || tabs.count == 1
          HStack(spacing: z(7)) {
            TabIcon(tab: tab, loading: on && s.loading)
            Text(tab.label)
              .lineLimit(1)
              .frame(maxWidth: .infinity, alignment: .leading)
            if s.running, tab.id != "blank" {
              Button("Close tab", systemImage: "xmark") { perform(.closeTab(tab.id)) }
                .labelStyle(.iconOnly)
                .buttonStyle(.icon(size: 18))
            }
          }
          .font(.omni(size: 13))
          .foregroundStyle(on ? Tok.fg : Tok.fg3)
          .padding(.leading, z(11))
          .padding(.trailing, z(4))
          .frame(minWidth: z(60), maxWidth: z(208), minHeight: z(32))
          .background(on ? Tok.surface3 : .clear, in: RoundedRectangle(cornerRadius: z(12), style: .continuous))
          .contentShape(Rectangle())
          .onTapGesture { if !on, s.running { perform(.tab(tab.id)) } }
          .help(tab.url)
        }
        Button("New tab", systemImage: "plus") { perform(.newTab) }
          .labelStyle(.iconOnly)
          .buttonStyle(.icon(size: 26))
          .disabled(!s.running)
      }
      .padding(.horizontal, z(8))
    }
    .frame(height: z(34))
  }
}

private struct TabIcon: View {
  let tab: BrowserTabInfo
  let loading: Bool

  var body: some View {
    Group {
      if loading {
        ProgressView().controlSize(.mini)
      } else if let icon = tab.favicon, let url = URL(string: icon) {
        AsyncImage(url: url) { phase in
          if let image = phase.image { image.resizable().interpolation(.high).scaledToFit() } else { globe }
        }
      } else {
        globe
      }
    }
    .frame(width: z(15), height: z(15))
  }

  private var globe: some View {
    Image(systemName: "globe").font(.omni(size: 12)).foregroundStyle(Tok.fg4)
  }
}

/// The hairline under the toolbar, with a sliver sweeping along it while the page loads.
struct BrowserLoadingRule: View {
  let loading: Bool

  var body: some View {
    ZStack(alignment: .leading) {
      Tok.line.frame(height: 1)
      if loading { LoadingBar() }
    }
    .frame(height: 1)
    .clipped()
  }
}

/// A sliver sweeping under the address bar while the page loads.
private struct LoadingBar: View {
  @State private var sweep = false

  var body: some View {
    GeometryReader { geo in
      Capsule()
        .fill(Tok.fg3)
        .frame(width: geo.size.width * 0.35)
        .offset(x: sweep ? geo.size.width : -geo.size.width * 0.35)
    }
    .onAppear {
      withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: false)) { sweep = true }
    }
  }
}
