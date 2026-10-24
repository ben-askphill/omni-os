import AuthenticationServices
import OmniKit
import SwiftUI

/// The Account tab, like the Account section of the web's Settings: who this Mac is signed in as with Google, or
/// that it uses the install token, and who may sign in.
struct AccountSettings: View {
  let model: AppModel

  var body: some View {
    let account = model.account
    SettingsPage {
      SettingsCard(
        title: "Account",
        note: "Signing in with Google gives this Mac its own session. Everything else keeps using the install token, so scripts and pairing still work."
      ) {
        switch account.state {
        case .signedIn(let user, let device):
          HStack(alignment: .center, spacing: z(12)) {
            VStack(alignment: .leading, spacing: z(3)) {
              Text("Signed in as \(user.email)").font(.omni(size: 13.5, weight: .medium)).foregroundStyle(Tok.fg)
              Text(device.name).font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
            }
            Spacer(minLength: 0)
            Button("Sign out") { Task { await account.signOut() } }
              .buttonStyle(.pill(.secondary, height: 32))
          }
        case .signedOut, .signingIn, .failed:
          Text("This Mac uses the install token.").font(.omni(size: 13.5)).foregroundStyle(Tok.fg)
          if account.google?.loopback == true {
            HStack { GoogleSignInButton(account: account) }
          }
          if case .failed(let message) = account.state { ErrorNote(text: message) }
        }
        if let google = account.google, google.loopback || google.broker {
          Text(google.whoMaySignIn)
            .font(.omni(size: 12.5))
            .foregroundStyle(Tok.fg3)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
    }
    .task(id: model.client.baseURL) { await account.refresh() }
  }
}

/// "Sign in with Google": a pill with Google's G on the left, a Loader in its place while the sheet is up.
struct GoogleSignInButton: View {
  let account: AccountModel
  var variant = PillButtonStyle.Variant.secondary
  var height: CGFloat = 34

  var body: some View {
    Button {
      Task { await account.signIn(open: GoogleSignInSheet.open) }
    } label: {
      HStack(spacing: z(8)) {
        if account.state == .signingIn { Loader(size: 14) } else { GoogleMark(size: 16) }
        Text("Sign in with Google")
      }
    }
    .buttonStyle(.pill(variant, height: height))
  }
}

/// The system's web sign-in sheet. Google, then the server, end it on `omni://signin?attempt=`. Closing it throws
/// `CancellationError`.
@MainActor
enum GoogleSignInSheet {
  /// The sheet must be kept alive while it shows.
  private static var current: ASWebAuthenticationSession?
  private static let anchor = Anchor()

  static func open(_ url: URL) async throws -> URL {
    #if DEBUG
      if let hint = UserDefaults.standard.string(forKey: "OmniQASignInHint"), !hint.isEmpty {
        return try await QASignIn.follow(url, hint: hint)
      }
    #endif
    defer { current = nil }
    return try await withCheckedThrowingContinuation { done in
      let session = ASWebAuthenticationSession(url: url, callback: .customScheme("omni")) { @Sendable callback, error in
        if let callback {
          done.resume(returning: callback)
        } else if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
          done.resume(throwing: CancellationError())
        } else {
          done.resume(throwing: error ?? CancellationError())
        }
      }
      session.presentationContextProvider = anchor
      session.prefersEphemeralWebBrowserSession = false
      current = session
      if !session.start() { done.resume(throwing: DidNotOpen()) }
    }
  }

  private struct DidNotOpen: LocalizedError {
    var errorDescription: String? { "The sign-in window did not open. Try again." }
  }

  private final class Anchor: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
      MainActor.assumeIsolated { NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first ?? ASPresentationAnchor() }
    }
  }
}
