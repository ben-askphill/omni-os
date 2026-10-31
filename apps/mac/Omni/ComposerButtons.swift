import AppKit
import OmniKit
import SwiftUI
import UniformTypeIdentifiers

// The reply box's buttons and strip: Send, Stop, Steer and the staged attachments.

/// SendButton in Composer.tsx: Bencho's round "cmd" go button, quiet until there is something to send, then ink.
struct SendButton: View {
  var title = "Send"
  let armed: Bool
  let sending: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Group {
        if sending { Loader(size: 16) } else { OmniIcon(name: "send", size: 16, weight: 2) }
      }
      .foregroundStyle(Tok.onInk)
      .frame(width: z(34), height: z(34))
      .background(Tok.fg, in: Circle())
      .contentShape(Circle())
    }
    .buttonStyle(PressScale())
    .opacity(armed && !sending ? 1 : 0.25)
    .fixedSize()
    .layoutPriority(1)
    .disabled(!armed || sending)
    .animation(.easeOut(duration: 0.15), value: armed)
    .help(title)
    .accessibilityLabel(title)
  }
}

/// StopButton in Composer.tsx: Send's place while a turn runs and the box is empty. Esc and Cmd-period do the same.
/// It reads Stopping until the turn stops.
struct StopButton: View {
  let stopping: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Group {
        if stopping { Loader(size: 16) } else { OmniIcon(name: "stop", size: 16, weight: 2) }
      }
      .foregroundStyle(Tok.onInk)
      .frame(width: z(34), height: z(34))
      .background(Tok.fg, in: Circle())
      .contentShape(Circle())
    }
    .buttonStyle(PressScale())
    .opacity(stopping ? 0.6 : 1)
    .fixedSize()
    .layoutPriority(1)
    .disabled(stopping)
    .help("Stop the agent (Esc). Messages already sent still run.")
    .accessibilityLabel(stopping ? "Stopping" : "Stop")
  }
}

/// `active:scale-[.92]`.
private struct PressScale: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.92 : 1)
      .animation(Motion.settle, value: configuration.isPressed)
  }
}

/// The busy thread's send: Steer (Queue where the harness can't steer) and a menu of the other ways.
struct SteerButton: View {
  let canSteer: Bool
  let enabled: Bool
  let sending: Bool
  let send: (SendMode) -> Void

  private func symbol(_ mode: SendMode) -> String {
    switch mode {
    case .steer: "paperplane"
    case .queue: "clock"
    default: "stop.fill"
    }
  }

  var body: some View {
    HStack(spacing: 0) {
      Button {
        send(SendRules.primary(canSteer: canSteer))
      } label: {
        HStack(spacing: z(6)) {
          if sending {
            Loader(size: 16)
          } else {
            OmniIcon(name: canSteer ? "send" : "clock", size: 16, weight: 2)
          }
          Text(SendRules.buttonTitle(canSteer: canSteer)).font(.omni(size: 13, weight: .medium))
        }
        .padding(.leading, z(14))
        .padding(.trailing, z(10))
        .frame(height: z(34))
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      Rectangle().fill(Tok.onInk.opacity(0.25)).frame(width: 1, height: z(34))
      Menu {
        ForEach(SendRules.options(canSteer: canSteer), id: \.rawValue) { mode in
          Button {
            send(mode)
          } label: {
            Label(SendRules.title(mode), systemImage: symbol(mode))
          }
          .help(SendRules.hint(mode))
        }
      } label: {
        OmniIcon(name: "chevronDown", size: 13)
          .foregroundStyle(Tok.onInk)
          .frame(width: z(32), height: z(34))
          .contentShape(Rectangle())
      }
      .menuStyle(.button)
      .buttonStyle(.plain)
      .menuIndicator(.hidden)
      .fixedSize()
      .help("More ways to send")
      .accessibilityLabel("More ways to send")
    }
    .foregroundStyle(Tok.onInk)
    .background(Tok.fg, in: Capsule())
    .clipShape(Capsule())
    .opacity(enabled ? 1 : 0.25)
    .disabled(!enabled || sending)
  }
}

/// Staged files above the input, each removable until the message is sent.
struct AttachmentStrip: View {
  let files: [StagedFile]
  let remove: (StagedFile) -> Void

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: z(6)) {
        ForEach(files) { f in
          HStack(spacing: z(8)) {
            Thumb(file: f)
            VStack(alignment: .leading, spacing: 1) {
              Text(f.name).font(.omni(size: 12.5, weight: .medium)).foregroundStyle(Tok.fg2).lineLimit(1).truncationMode(.middle)
              Text(Format.bytes(f.size)).font(.omni(size: 10.5)).foregroundStyle(Tok.fg4).monospacedDigit()
            }
            .frame(maxWidth: z(170), alignment: .leading)
            Button {
              remove(f)
            } label: {
              OmniIcon(name: "x", size: 13)
            }
            .buttonStyle(.icon(size: 24))
            .help("Remove \(f.name)")
            .accessibilityLabel("Remove \(f.name)")
          }
          .padding(.leading, z(4))
          .padding(.trailing, z(4))
          .frame(height: z(44))
          .background(Tok.surface2, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
        }
      }
      .padding(.horizontal, z(12))
    }
    .padding(.top, z(12))
    .padding(.bottom, z(2))
  }
}

private struct Thumb: View {
  let file: StagedFile
  @State private var image: NSImage?

  var body: some View {
    Group {
      if let image {
        Image(nsImage: image).resizable().scaledToFill()
      } else {
        OmniIcon(name: "file", size: 15).foregroundStyle(Tok.fg3)
      }
    }
    .frame(width: z(36), height: z(36))
    .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(8), style: .continuous))
    .clipShape(RoundedRectangle(cornerRadius: z(8), style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: z(8), style: .continuous).strokeBorder(Tok.line))
    .task(id: file.url) {
      guard file.isImage else { return }
      let url = file.url
      image = await Task.detached { NSImage(contentsOf: url) }.value
    }
  }
}
