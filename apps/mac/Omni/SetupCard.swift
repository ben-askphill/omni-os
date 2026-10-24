import OmniKit
import SwiftUI

/// SetupCard.tsx: a worktree thread whose worktree is not ready (apps/server/runner/setup.ts). Preparing while Omni makes
/// and checks it, then Setup failed with git's reason and Retry. Nothing runs until it is ready; the first message and
/// its files wait below, kept across restarts. Retry uses the same thread, branch and session.
struct SetupCard: View {
  let model: AppModel
  let store: ThreadStore
  let thread: OmniThread
  @State private var busy = false
  @State private var error: String?
  /// Where the branch starts. Resolved during setup (a remote default fetches first), so it is read again as setup moves.
  @State private var base: ThreadBaseView?

  var body: some View {
    let failed = thread.setup == .failed
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: z(12)) {
        ZStack {
          Circle().fill(failed ? Tok.needs.opacity(0.12) : Tok.surface2)
          if failed {
            OmniIcon(name: "alert", size: 15).foregroundStyle(Tok.needs)
          } else {
            Loader(size: 14, color: Tok.fg2)
          }
        }
        .frame(width: z(28), height: z(28))
        VStack(alignment: .leading, spacing: z(2)) {
          Text(failed ? "Setup failed" : "Preparing worktree")
            .font(.omni(size: 14, weight: .semibold))
            .foregroundStyle(Tok.fg)
          Text(failed
            ? "Nothing ran. Your message and files are kept and send once the worktree is ready."
            : "Making the thread its own checkout before anything runs.")
            .font(.omni(size: 12.5))
            .foregroundStyle(Tok.fg3)
            .fixedSize(horizontal: false, vertical: true)
          if let base {
            Text(base.line)
              .font(.omni(size: 12.5))
              .foregroundStyle(Tok.fg2)
              .fixedSize(horizontal: false, vertical: true)
              .padding(.top, z(4))
          }
          if failed, let reason = thread.setupError {
            Text(reason)
              .font(.omni(size: 11.5, design: .monospaced))
              .foregroundStyle(Tok.fg2)
              .textSelection(.enabled)
              .fixedSize(horizontal: false, vertical: true)
              .padding(.horizontal, z(10))
              .padding(.vertical, z(6))
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(Tok.surface2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
              .padding(.top, z(6))
          }
          if let branch = thread.branch {
            IconLabel(branch, icon: "branch", size: 12)
              .font(.omni(size: 11.5, design: .monospaced))
              .foregroundStyle(Tok.fg4)
              .lineLimit(1)
              .help(thread.cwd ?? branch)
              .padding(.top, z(6))
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        if failed {
          Button { retry() } label: {
            HStack(spacing: z(6)) {
              if busy { Loader(size: 12) } else { OmniIcon(name: "refresh", size: 13) }
              Text("Retry")
            }
          }
          .buttonStyle(.pill(.primary, height: 28))
          .help("Make the worktree again on the same branch, then send the waiting message")
          .disabled(busy)
        }
      }
      .padding(.horizontal, z(16))
      .padding(.vertical, z(12))
      if let error {
        ErrorNote(text: error)
          .padding(.horizontal, z(12))
          .padding(.bottom, z(12))
      }
    }
    .background(Tok.surface)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Tok.line))
    .padding(.top, z(8))
    .accessibilityElement(children: .contain)
    .accessibilityLabel(failed ? "Setup failed" : "Preparing worktree")
    .task(id: thread.setup) {
      if let view = try? await model.client.threadBase(thread.id) { base = view }
    }
  }

  private func retry() {
    guard !busy else { return }
    busy = true
    error = nil
    let client = model.client
    let id = thread.id
    Task {
      defer { busy = false }
      do {
        store.apply(recovery: try await client.retrySetup(in: id))
      } catch let e as OmniAPIError {
        error = e.message
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
