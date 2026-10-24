import OmniKit
import SwiftUI

/// The thread header's Continue button, which opens `ContinueSheet`. Off for a thread whose files are not on this Mac.
struct ContinueButton: View {
  let model: AppModel
  let thread: OmniThread
  @State private var open = Self.firstOpen

  var body: some View {
    let refusal = ContinueRules.sourceRefusal(thread.harness)
    Button {
      open = true
    } label: {
      OmniIcon(name: "split", size: 15)
    }
    .buttonStyle(.icon(size: 28))
    .disabled(refusal != nil)
    .help(refusal ?? "Continue with another harness: a new thread that picks up from here")
    .accessibilityLabel("Continue with another harness")
    .sheet(isPresented: Binding(get: { open && refusal == nil }, set: { open = $0 })) {
      ContinueSheet(model: model, thread: thread)
    }
  }

  #if DEBUG
  // QA scripts pick a route only, so a launch argument opens the sheet on the open thread.
  private static var firstOpen: Bool { UserDefaults.standard.bool(forKey: "OmniContinueSheet") }
  #else
  private static let firstOpen = false
  #endif
}

/// Under the header's title: "Continued from <title> · <harness>" and a "Continued in" line per continuation, each
/// opening that thread. What the carryover gave the new thread is the help.
struct ContinueLinks: View {
  let model: AppModel
  let from: ContinueLink?
  let continuedIn: [ContinueLink]

  var body: some View {
    if from != nil || !continuedIn.isEmpty {
      VStack(alignment: .leading, spacing: 1) {
        if let from { line("Continued from", from) }
        ForEach(continuedIn) { line("Continued in", $0) }
      }
    }
  }

  private func line(_ lead: String, _ link: ContinueLink) -> some View {
    Button {
      model.route = .thread(id: link.id)
    } label: {
      HStack(spacing: z(5)) {
        OmniIcon(name: "split", size: 11)
          .foregroundStyle(Tok.fg4)
        Text(lead).foregroundStyle(Tok.fg4)
        Text(link.title).foregroundStyle(Tok.fg2).lineLimit(1).truncationMode(.tail)
        Text("· \(ThreadDetails.harnessName(link.harness))").foregroundStyle(Tok.fg3).fixedSize()
      }
      .font(.omni(size: 11.5))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .help(link.carried.map(ContinueRules.carriedText) ?? "Open \(link.title)")
  }
}

/// One linked thread in the inspector's details, as its Parent row: status, title and harness, and what the carryover
/// gave it under them when this Mac made it.
struct ContinueLinkRow: View {
  let model: AppModel
  let link: ContinueLink

  var body: some View {
    VStack(alignment: .leading, spacing: z(2)) {
      Button {
        model.route = .thread(id: link.id)
      } label: {
        HStack(spacing: z(6)) {
          StatusDot(status: link.status, size: 6)
          Text(link.title) + Text(" · \(ThreadDetails.harnessName(link.harness))").foregroundStyle(Tok.fg3)
        }
      }
      .buttonStyle(.plain)
      if let carried = link.carried {
        Text(ContinueRules.carriedText(carried)).foregroundStyle(Tok.fg3)
      }
    }
  }
}
