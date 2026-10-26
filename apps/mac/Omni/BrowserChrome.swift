import AppKit
import OmniKit
import SwiftUI

// The Chrome-like frame both browsers share: the live view of the agent's Chrome (`LiveBrowserView`) and the Mac's own web
// view (`NativeBrowserView`). Each gives a `BrowserState` and takes the user's actions; the frame looks and acts the same.

/// Back, forward, reload, the address bar, Annotate and whatever the caller adds.
struct BrowserToolbar: View {
  let state: BrowserState
  let perform: (BrowserAction) -> Void
  var annotating: Annotating?
  /// Counts the page's Cmd-L, which moves focus to the address bar.
  var focusTick = 0
  var trailing: AnyView = AnyView(EmptyView())
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
        Image(systemName: s.url.hasPrefix("https://") ? "lock.fill" : s.url.isEmpty || s.url == "about:blank" ? "magnifyingglass" : "info.circle")
          .font(.omni(size: 10.5, weight: .semibold))
          .foregroundStyle(Tok.fg3)
        TextField("", text: editing ? $address : .constant(BrowserTabInfo.displayURL(address)), prompt: Text("Search Google or type a URL"))
          .textFieldStyle(.plain)
          .font(.omni(size: 13))
          .foregroundStyle(Tok.fg)
          .focused($editing)
          .onSubmit {
            guard !address.trimmingCharacters(in: .whitespaces).isEmpty else { return }
            perform(.navigate(address))
            editing = false
          }
          .onExitCommand {
            address = s.url == "about:blank" ? "" : s.url
            editing = false
          }
      }
      .padding(.horizontal, z(11))
      .frame(height: z(30))
      .background(editing ? Tok.bg : Tok.surface2, in: Capsule())
      .overlay(Capsule().strokeBorder(editing ? Tok.lineStrong : .clear, lineWidth: 2))
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
    .onChange(of: state.url, initial: true) { _, url in
      if !editing { address = url == "about:blank" ? "" : url }
    }
    .onChange(of: focusTick) { editing = true }
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
      HStack(alignment: .bottom, spacing: z(2)) {
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
          .font(.omni(size: 12))
          .foregroundStyle(on ? Tok.fg : Tok.fg3)
          .padding(.leading, z(11))
          .padding(.trailing, z(4))
          .frame(minWidth: z(60), maxWidth: z(208), minHeight: z(32))
          .background(on ? Tok.bg : .clear, in: UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12, style: .continuous))
          .contentShape(Rectangle())
          .onTapGesture { if !on, s.running { perform(.tab(tab.id)) } }
          .help(tab.url)
        }
        Button("New tab", systemImage: "plus") { perform(.newTab) }
          .labelStyle(.iconOnly)
          .buttonStyle(.icon(size: 26))
          .disabled(!s.running)
          .padding(.bottom, z(3))
      }
      .padding(.horizontal, z(8))
    }
    .frame(height: z(34))
  }
}

struct TabIcon: View {
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
