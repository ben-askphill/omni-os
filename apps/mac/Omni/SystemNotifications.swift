import AppKit
import OmniKit
@preconcurrency import UserNotifications

/// Posts `AttentionCenter`'s alerts to Notification Center and opens the thread when Ben clicks one. OmniKit decides
/// which results alert; this only speaks to macOS.
@MainActor
final class SystemNotifications: NSObject, NotificationPoster, UNUserNotificationCenterDelegate {
  private let center = UNUserNotificationCenter.current()
  private weak var model: AppModel?

  init(model: AppModel) {
    self.model = model
    super.init()
    center.delegate = self
  }

  func permission() async -> NotificationPermission {
    Self.permission(await center.notificationSettings().authorizationStatus)
  }

  func requestPermission() async -> NotificationPermission {
    _ = try? await center.requestAuthorization(options: [.alert, .sound])
    return await permission()
  }

  func post(_ alert: AttentionAlert) {
    let content = UNMutableNotificationContent()
    content.title = alert.title
    content.subtitle = alert.subtitle
    content.body = alert.body
    content.threadIdentifier = alert.channelID
    content.userInfo = alert.userInfo
    if alert.status == .failed { content.sound = .default }
    center.add(UNNotificationRequest(identifier: alert.id, content: content, trigger: nil))
  }

  func withdraw(_ ids: [String]) {
    center.removeDeliveredNotifications(withIdentifiers: ids)
    center.removePendingNotificationRequests(withIdentifiers: ids)
  }

  private static func permission(_ status: UNAuthorizationStatus) -> NotificationPermission {
    switch status {
    case .authorized, .provisional, .ephemeral: .allowed
    case .denied: .denied
    default: .notAsked
    }
  }

  // MARK: UNUserNotificationCenterDelegate

  /// In front, the window's own banner already says it: the alert goes to Notification Center without a banner.
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.list]
  }

  /// A click: the main window comes forward on the thread, which reads the result as it does any result it shows.
  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    guard let route = Route(notification: response.notification.request.content.userInfo) else { return }
    await MainActor.run {
      guard let model else { return }
      model.show(route)
      NSApp.activate()
      NSApp.windows.first { $0.identifier?.rawValue.hasPrefix("main") == true }?.makeKeyAndOrderFront(nil)
    }
  }
}

/// Opens System Settings at Notifications, the only place a denial can be undone.
@MainActor func openNotificationSettings() {
  if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") {
    NSWorkspace.shared.open(url)
  }
}
