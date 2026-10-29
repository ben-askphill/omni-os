#if DEBUG
import Foundation

/// A bad QA script. `message` names the step.
public struct QAScriptError: Error, Hashable, Sendable, CustomStringConvertible {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var description: String { message }
}

/// A window the QA harness can open besides the main one.
public enum QAWindow: String, Hashable, Sendable {
  case settings
}

public enum QAAppearance: String, Hashable, Sendable {
  case light, dark
}

/// Where a scroll step takes the open thread's transcript. `through` scrolls from the bottom to the top half
/// a screen per frame and reports how long the frames took.
public enum QAInspector: String, Hashable, Sendable {
  /// `turn`: the Changes tab on This turn.
  case open, close, artifacts, changes, turn, browser, web, terminal, actions, details
}

/// What an annotate step does in the Browser tab: press Annotate and wait for the screenshot, draw a rectangle (in fractions
/// of the shown screenshot, 0 to 1) and write the note, press Add to Message, or Cancel. The `live` steps drive live
/// Annotate on the page itself, in fractions of the shown page.
public enum QAAnnotate: Hashable, Sendable {
  case start
  /// Turns live Annotate on.
  case live
  /// Moves the pointer over the page, and waits for the inspector's answer.
  case hover(x: Double, y: Double)
  /// A click on the page, then the note; waits until the card is ready.
  case livePick(x: Double, y: Double, note: String)
  /// A drag across the page, then the note; waits until the card is ready.
  case liveDrag(x0: Double, y0: Double, x1: Double, y1: Double, note: String)
  /// Presses the card's Send.
  case send
  case drag(x0: Double, y0: Double, x1: Double, y1: Double, note: String)
  /// A tap at a fraction of the shown screenshot, which picks the element there; the note is written once it is picked.
  case tap(x: Double, y: Double, note: String)
  /// A shape (`rect`, `ellipse`, `arrow` or `line`) dragged between two fractions of the shown screenshot.
  case shape(tool: String, x0: Double, y0: Double, x1: Double, y1: Double)
  /// A pen stroke through fractions of the shown screenshot.
  case pen(points: [[Double]])
  /// Words set down at a fraction of the shown screenshot.
  case text(String, x: Double, y: Double)
  /// The color and line width the next marks take, or the selected mark takes.
  case style(color: String?, stroke: Int?)
  /// Takes hold of the mark under a fraction of the shown screenshot and drags it by a fraction of the shown size.
  case move(x: Double, y: Double, dx: Double, dy: Double)
  case undo
  case note(String)
  case add
  case cancel
}

public enum QAScroll: String, Hashable, Sendable {
  /// `nudge` goes to the bottom, then sends trackpad scroll events a few lines up, opens the tool groups so the
  /// content grows, and notes how far from the bottom the view is after each. `earlier` scrolls up until an earlier
  /// page of history starts loading, and notes the row at the top of the view then and once the page is in. `gap` centres
  /// the first gap between held pages, which a reveal leaves.
  case top, bottom, through, nudge, earlier, gap
}

/// What a channel step does to the channel `qa-channel`, through the same client calls as the settings form.
public enum QAChannelAction: String, Hashable, Sendable {
  case create, edit, archive, unarchive
}

/// A sidebar folder state to show, by folder and thread names: a folder made as the name field makes it, the inline
/// name field for a new folder or a rename,
/// the delete confirm, a thread dragged over a folder, a thread filed in one, a folder's right-click menu (shot
/// to `<shot>.png` while it is open), or none of these.
public enum QAFolderAction: Hashable, Sendable {
  case new(channel: String)
  case create(channel: String, name: String)
  case rename(folder: String)
  case delete(folder: String)
  /// New Thread Here: the channel's composer with the folder's chip.
  case here(folder: String)
  case drag(thread: String, over: String)
  case file(thread: String, into: String)
  case menu(folder: String, shot: String)
  case reset
}

/// What the Server menu does, without the confirmation Stop asks for.
/// The Quick Prompt panel: open with this text (Wispr Flow left off), send it, or close it.
public enum QAQuickPrompt: Hashable, Sendable {
  case open(String)
  case send
  case close
}

/// What a `{"deliveries": ...}` step does on the Automations page: scroll an automation's Deliveries into view, then open
/// its first delivery in a state (or with an id), and load the next page of older ones.
public struct QADeliveries: Hashable, Sendable {
  public let automation: String
  /// A delivery state (`failed`) or a delivery id.
  public let open: String?
  public let older: Bool

  public init(automation: String, open: String?, older: Bool) {
    self.automation = automation
    self.open = open
    self.older = older
  }
}

public enum QAServerAction: String, Hashable, Sendable {
  case start, stop, check
}

/// One step of a Debug QA run, from the JSON the app gets with `-OmniQAScript`:
/// `{"route": "#/c/acme"}`, `{"wait": {"for": "sidebarLoaded", "timeout": 10}}` (or `{"wait": "sidebarLoaded"}`),
/// `{"sleep": 1}`, `{"snapshot": "name"}`, `{"port": 4759}` (never 4747), `{"open": "settings"}`, `{"openThread": "<id>"}`,
/// `{"settings": "secrets"}` (or `connection`, `profile`, `sync`, `storage`, `notifications`, `appearance`), `{"server": "start"}` (or `stop`, `check`),
/// `{"appearance": "dark"}` (or `light`), `{"scroll": "top"}` (or `bottom`, `through`, `nudge`, `earlier`, `gap`), `{"expand": true}`, `{"meter": true}`, `{"modelPicker": true}` (or a search, `"cursor"`), `{"foldAll": true}`,
/// `{"imageZoom": 2}` (or `"fit"`), `{"nativeBrowser": "<url>"}`, `{"editPending": "text"}`, `{"webhookSecret": "<automation id>"}`, `{"searchHit": 0}`, `{"subagent": 0}`,
/// `{"deliveries": "<automation id>"}` (or `{"automation": "<id>", "open": "failed", "older": true}`),
/// `{"type": "text"}`, `{"send": "reply"}` (or `steer`, `queue`, `interrupt`), `{"inspector": "artifacts"}` (or
/// `changes`, `turn`, `browser`, `web`, `terminal`, `actions`, `details`, `open`, `close`), `{"webTitle": "BLOCKED"}`, `{"palette": "query"}` (or `false`), `{"channel": "create"}` (or `edit`, `archive`, `unarchive`),
/// `{"folder": {"new": "<channel id>"}}` (or `{"new": "<channel id>", "name": "<folder>"}` to make it, `{"rename": "<folder>"}`, `{"delete": "<folder>"}`, `{"here": "<folder>"}`,
/// `{"drag": "<thread title>", "over": "<folder>"}`, `{"file": "<thread title>", "into": "<folder>"}`,
/// `{"menu": "<folder>", "shot": "<name>"}`, or `"reset"`), `{"screen": "name"}`, `{"handoffMenu": "name"}`, `{"prMenu": "name"}`, `{"handOff": "<device id>"}`, `{"takeOver": "name"}`,
/// `{"quickPrompt": "text"}` (or `{"send": true}`, `false`), `{"selectLines": {"file": "<path>", "from": 1, "to": 3}}`,
/// `{"addContext": "note"}`, `{"selectTerminal": true}`, `{"addTerminal": "note"}`, `{"annotate": "start"}` (or `add`, `cancel`, `live`, `send`, or
/// `{"drag": [0.1, 0.2, 0.6, 0.5], "note": "text"}`, `{"tap": [0.4, 0.3], "note": "text"}`, `{"hover": [0.4, 0.3]}`, `{"livePick": [0.4, 0.3], "note": "text"}`,
/// `{"liveDrag": [0.1, 0.2, 0.6, 0.5], "note": "text"}`), `{"browserAddress": "example.com"}` (or `{"type": "example.com", "escape": true}`), `{"openContext": 0}`, `{"referenceThread": "open"}` (or `close`, `all`, `channel`, `{"search": "text"}`, `{"pick": 0}`), `{"quit": true}`.
/// What a `referenceThread` step does to the reply box's picker.
public enum QAReference: Hashable, Sendable {
  case open, close, all, channel
  case search(String)
  case pick(Int)

  init?(rawValue: String) {
    switch rawValue {
    case "open": self = .open
    case "close": self = .close
    case "all": self = .all
    case "channel": self = .channel
    default: return nil
    }
  }
}

public enum QAStep: Hashable, Sendable {
  case route(Route)
  case wait(QACondition, timeout: Duration)
  case sleep(Duration)
  /// Writes each of the app's visible windows to `<name>.png` in the out folder.
  case snapshot(String)
  /// Sets the server port, as the Settings window would.
  case port(Int)
  case open(QAWindow)
  /// Opens the Settings window on a tab.
  case settings(SettingsTab)
  /// Opens the thread in its own window, as Open in New Window does.
  case openThread(String)
  /// Start Server, Stop Server or Check Again. The step waits for it to finish.
  case server(QAServerAction)
  case appearance(QAAppearance)
  case scroll(QAScroll)
  /// Opens the open thread's tool groups, and the calls in them that failed or have sub-calls.
  case expand
  /// Opens the open thread's context meter panel.
  case meter
  /// Opens the new-thread composer's model list, with this in its search.
  case modelPicker(String)
  /// Presses the sidebar's collapse-all (or expand-all) button.
  case foldAll
  /// Opens the edit of the open thread's first editable unsent message, with this text in it.
  case editPending(String)
  /// Opens the Set secret form of the webhook automation with this id, on the Automations page.
  case webhookSecret(String)
  /// Shows an automation's deliveries on the Automations page, with a detail open or older ones loaded.
  case deliveries(QADeliveries)
  /// Opens the search screen's hit at this index, as a click on its row does.
  case searchHit(Int)
  /// Presses the Details tab's Running subagents row at this index, as a click does.
  case subagent(Int)
  /// Zooms the artifact image preview to this scale, or back to fit with nil.
  case imageZoom(Double?)
  /// Loads this address in the Web tab's own web view and waits for it to finish.
  case nativeBrowser(String)
  /// Puts text in the reply box, as if typed.
  case type(String)
  /// Sends the reply box: nil is a plain reply, else the mode of the split button.
  case send(SendMode?)
  /// Changes the next run through the same callback as the reply box pickers.
  case run(Run)
  /// Opens or closes the thread inspector, or picks its tab.
  case inspector(QAInspector)
  /// Waits until the inspector's web view has this document title, so a page can report what it could reach.
  case webTitle(String)
  /// Opens the Go to palette with this query, or closes it with nil.
  case palette(String?)
  /// Creates, edits, archives or unarchives the channel `qa-channel`.
  case channel(QAChannelAction)
  case folder(QAFolderAction)
  /// The main window to `<name>.png` with the app's windows over it drawn in, such as a sheet or an open menu.
  case screen(String)
  /// Clicks the open thread's Hand Off button and writes `<name>.png` while its menu is open.
  case handoffMenu(String)
  /// Clicks the reply box's PR button and writes `<name>.png` while its menu is open.
  case prMenu(String)
  /// Hands the open thread to this device, as picking it in Hand Off to does.
  case handOff(String)
  /// Presses the reply box's Take Over, writes `<name>.png` while its confirm shows, then presses Take Over in it.
  case takeOver(String)
  case quickPrompt(QAQuickPrompt)
  /// In the Changes tab, clicks the number of row `from` of the file at that path, then shift-clicks row `to`.
  case selectLines(file: String, from: Int, to: Int)
  /// Writes this note in the line selection's dock and presses Add to Message.
  case addContext(String)
  /// In the Terminal tab, selects everything the terminal shows.
  case selectTerminal
  /// Writes this note in the terminal selection's dock and presses Add to Message.
  case addTerminal(String)
  /// The Browser tab's Annotate flow.
  case annotate(QAAnnotate)
  /// Clicks the Browser tab's page, then its address bar, as the pointer does, types this key by key and presses Return
  /// (or Escape, with `escape`), and checks where the keys went.
  case browserAddress(String, escape: Bool)
  /// Clicks the reply box's context chip at this index, which opens or closes its inspector.
  case openContext(Int)
  /// The reply box's thread reference picker: open or close its popover, pick a scope, search, or attach the row at an index.
  case referenceThread(QAReference)
  case quit

  static let defaultTimeout = Duration.seconds(10)
}

/// What a wait step waits for.
public enum QACondition: Hashable, Sendable {
  /// The channel list has loaded.
  case sidebarLoaded
  /// `serverState:running`, or any other supervisor state by name.
  case serverState(String)
  /// `connection:open`, `connecting`, `reconnecting` or `closed`: the feed.
  case connection(String)
  /// `channel:<id>`: the sidebar lists that channel.
  case channel(String)
  /// `thread:<id>`: the thread's transcript is on screen, laid out.
  case thread(String)
  /// The Browser tab shows a frame of the page.
  case browserFrame

  static let serverStates: Set = ["unknown", "checking", "notRunning", "starting", "running", "remote", "failed", "stopping"]
  static let connectionStates: Set = ["connecting", "open", "reconnecting", "closed"]

  public init(_ text: String) throws(QAScriptError) {
    let parts = text.split(separator: ":", maxSplits: 1).map(String.init)
    switch (parts.first, parts.count > 1 ? parts[1] : nil) {
    case ("sidebarLoaded", nil): self = .sidebarLoaded
    case ("serverState", let s?) where Self.serverStates.contains(s): self = .serverState(s)
    case ("connection", let s?) where Self.connectionStates.contains(s): self = .connection(s)
    case ("channel", let id?) where !id.isEmpty: self = .channel(id)
    case ("thread", let id?) where !id.isEmpty: self = .thread(id)
    case ("browserFrame", nil): self = .browserFrame
    default: throw QAScriptError("unknown condition \(text)")
    }
  }

  public func holds(in facts: QAFacts) -> Bool {
    switch self {
    case .sidebarLoaded: facts.sidebarLoaded
    case .serverState(let s): facts.serverState == s
    case .connection(let s): facts.connection == s
    case .channel(let id): facts.channels.contains(id)
    case .thread(let id): facts.shownThread == id
    case .browserFrame: facts.browserFrame
    }
  }
}

/// What conditions are checked against, read from the app model.
public struct QAFacts: Hashable, Sendable {
  public var serverState: String
  public var connection: String
  public var sidebarLoaded: Bool
  public var channels: Set<String>
  /// The thread whose transcript is on screen, once it is laid out.
  public var shownThread: String?
  /// The Browser tab has a frame of the page on screen.
  public var browserFrame: Bool

  public init(serverState: String, connection: String, sidebarLoaded: Bool, channels: Set<String>, shownThread: String? = nil, browserFrame: Bool = false) {
    self.browserFrame = browserFrame
    self.serverState = serverState
    self.connection = connection
    self.sidebarLoaded = sidebarLoaded
    self.channels = channels
    self.shownThread = shownThread
  }
}

public struct QAScript: Hashable, Sendable {
  public let steps: [QAStep]

  /// A list of steps, or an object with the list under `steps`.
  public init(json: Data) throws(QAScriptError) {
    let root: Any
    do {
      root = try JSONSerialization.jsonObject(with: json)
    } catch {
      throw QAScriptError("the script is not JSON: \(error.localizedDescription)")
    }
    guard let list = root as? [Any] ?? (root as? [String: Any])?["steps"] as? [Any] else {
      throw QAScriptError("the script must be a list of steps, or an object with a steps list")
    }
    var steps: [QAStep] = []
    for (i, raw) in list.enumerated() {
      do throws(QAScriptError) {
        steps.append(try Self.step(raw))
      } catch {
        throw QAScriptError("step \(i + 1): \(error.message)")
      }
    }
    self.steps = steps
  }

  private static let kinds = ["route", "wait", "sleep", "snapshot", "port", "open", "openThread", "settings", "server", "appearance", "scroll", "expand", "meter", "modelPicker", "foldAll", "editPending", "webhookSecret", "deliveries", "searchHit", "subagent", "imageZoom", "nativeBrowser", "type", "run", "send", "inspector", "webTitle", "palette", "channel", "folder", "screen", "handoffMenu", "prMenu", "handOff", "takeOver", "quickPrompt", "selectLines", "addContext", "selectTerminal", "addTerminal", "annotate", "browserAddress", "openContext", "referenceThread", "quit"]

  private static func step(_ raw: Any) throws(QAScriptError) -> QAStep {
    guard let dict = raw as? [String: Any] else { throw QAScriptError("a step must be an object") }
    let found = kinds.filter { dict[$0] != nil }
    guard found.count == 1, let kind = found.first, let value = dict[kind] else {
      throw QAScriptError("a step needs one of \(kinds.joined(separator: ", ")), got \(dict.keys.sorted().joined(separator: ", "))")
    }
    switch kind {
    case "route":
      guard let hash = value as? String else { throw QAScriptError("route takes a hash like #/c/acme") }
      return .route(Route(hash: hash))
    case "wait":
      if let text = value as? String { return .wait(try QACondition(text), timeout: QAStep.defaultTimeout) }
      guard let w = value as? [String: Any], let text = w["for"] as? String else {
        throw QAScriptError(#"wait takes a condition, or {"for": condition, "timeout": seconds}"#)
      }
      let timeout = try w["timeout"].map { v throws(QAScriptError) in try seconds(v, "timeout") } ?? QAStep.defaultTimeout
      return .wait(try QACondition(text), timeout: timeout)
    case "sleep":
      return .sleep(try seconds(value, "sleep"))
    case "snapshot":
      guard let name = value as? String, validName(name) else {
        throw QAScriptError("snapshot takes a file name of letters, digits, dots, dashes and underscores")
      }
      return .snapshot(name)
    case "port":
      guard let n = value as? Int, (1...65535).contains(n) else { throw QAScriptError("port takes a number from 1 to 65535") }
      guard n != ServerSettings.defaultPort else { throw QAScriptError("port \(n) is the live server") }
      return .port(n)
    case "open":
      guard let name = value as? String, let window = QAWindow(rawValue: name) else {
        throw QAScriptError("open takes settings")
      }
      return .open(window)
    case "settings":
      guard let name = value as? String, let tab = SettingsTab(rawValue: name) else {
        throw QAScriptError("settings takes connection, profile, secrets, sync, storage, notifications, appearance or quickPrompt")
      }
      return .settings(tab)
    case "openThread":
      guard let id = value as? String, !id.isEmpty else { throw QAScriptError("openThread takes a thread id") }
      return .openThread(id)
    case "server":
      guard let name = value as? String, let action = QAServerAction(rawValue: name) else {
        throw QAScriptError("server takes start, stop or check")
      }
      return .server(action)
    case "appearance":
      guard let name = value as? String, let a = QAAppearance(rawValue: name) else { throw QAScriptError("appearance takes light or dark") }
      return .appearance(a)
    case "scroll":
      guard let name = value as? String, let to = QAScroll(rawValue: name) else { throw QAScriptError("scroll takes top, bottom, through, nudge, earlier or gap") }
      return .scroll(to)
    case "expand":
      return .expand
    case "meter":
      return .meter
    case "modelPicker":
      if let query = value as? String { return .modelPicker(query) }
      guard value as? Bool == true else { throw QAScriptError("modelPicker takes true or the text to search for") }
      return .modelPicker("")
    case "foldAll":
      return .foldAll
    case "editPending":
      guard let text = value as? String else { throw QAScriptError("editPending takes the text to put in the edit") }
      return .editPending(text)
    case "webhookSecret":
      guard let id = value as? String, !id.isEmpty else { throw QAScriptError("webhookSecret takes the automation id") }
      return .webhookSecret(id)
    case "deliveries":
      if let id = value as? String, !id.isEmpty { return .deliveries(QADeliveries(automation: id, open: nil, older: false)) }
      let usage = #"deliveries takes an automation id, or {"automation": id, "open": state or delivery id, "older": true}"#
      guard let d = value as? [String: Any], let id = d["automation"] as? String, !id.isEmpty,
        Set(d.keys).isSubset(of: ["automation", "open", "older"]) else { throw QAScriptError(usage) }
      if let open = d["open"], !(open is String) { throw QAScriptError(usage) }
      if let older = d["older"], !(older is Bool) { throw QAScriptError(usage) }
      return .deliveries(QADeliveries(automation: id, open: d["open"] as? String, older: d["older"] as? Bool ?? false))
    case "searchHit":
      guard let i = value as? Int, i >= 0 else { throw QAScriptError("searchHit takes the index of a result") }
      return .searchHit(i)
    case "subagent":
      guard let i = value as? Int, i >= 0 else { throw QAScriptError("subagent takes the index of a Running subagents row") }
      return .subagent(i)
    case "quickPrompt":
      if let text = value as? String { return .quickPrompt(.open(text)) }
      if let on = value as? Bool, !on { return .quickPrompt(.close) }
      if let d = value as? [String: Any], d["send"] as? Bool == true { return .quickPrompt(.send) }
      throw QAScriptError(#"quickPrompt takes the text to open it with, {"send": true}, or false"#)
    case "imageZoom":
      if let name = value as? String, name == "fit" { return .imageZoom(nil) }
      guard let scale = value as? Double, scale > 0 else { throw QAScriptError(#"imageZoom takes a scale like 2, or "fit""#) }
      return .imageZoom(scale)
    case "nativeBrowser":
      guard let address = value as? String, !address.isEmpty else { throw QAScriptError("nativeBrowser takes the address to load") }
      return .nativeBrowser(address)
    case "type":
      guard let text = value as? String else { throw QAScriptError("type takes the text for the reply box") }
      return .type(text)
    case "run":
      guard let d = value as? [String: Any], let harness = d["harness"] as? String, !harness.isEmpty,
        let model = d["model"] as? String else { throw QAScriptError("run takes harness, model and optional effort") }
      return .run(Run(harness: HarnessID(rawValue: harness), model: model, effort: d["effort"] as? String ?? ""))
    case "send":
      guard let name = value as? String, ["reply", "steer", "queue", "interrupt"].contains(name) else {
        throw QAScriptError("send takes reply, steer, queue or interrupt")
      }
      return .send(name == "reply" ? nil : SendMode(rawValue: name))
    case "inspector":
      guard let name = value as? String, let to = QAInspector(rawValue: name) else {
        throw QAScriptError("inspector takes open, close, artifacts, changes, turn, browser, web, terminal, actions or details")
      }
      return .inspector(to)
    case "webTitle":
      guard let title = value as? String, !title.isEmpty else { throw QAScriptError("webTitle takes the title to wait for") }
      return .webTitle(title)
    case "palette":
      if let query = value as? String { return .palette(query) }
      if let open = value as? Bool, !open { return .palette(nil) }
      throw QAScriptError("palette takes a query, or false to close it")
    case "channel":
      guard let name = value as? String, let action = QAChannelAction(rawValue: name) else {
        throw QAScriptError("channel takes create, edit, archive or unarchive")
      }
      return .channel(action)
    case "folder":
      return .folder(try folderAction(value))
    case "screen":
      guard let name = value as? String, validName(name) else {
        throw QAScriptError("screen takes a file name of letters, digits, dots, dashes and underscores")
      }
      return .screen(name)
    case "handoffMenu":
      guard let name = value as? String, validName(name) else {
        throw QAScriptError("handoffMenu takes a file name of letters, digits, dots, dashes and underscores")
      }
      return .handoffMenu(name)
    case "prMenu":
      guard let name = value as? String, validName(name) else {
        throw QAScriptError("prMenu takes a file name of letters, digits, dots, dashes and underscores")
      }
      return .prMenu(name)
    case "handOff":
      guard let id = value as? String, !id.isEmpty else { throw QAScriptError("handOff takes a device id") }
      return .handOff(id)
    case "takeOver":
      guard let name = value as? String, validName(name) else {
        throw QAScriptError("takeOver takes a file name of letters, digits, dots, dashes and underscores")
      }
      return .takeOver(name)
    case "selectLines":
      guard let d = value as? [String: Any], let file = d["file"] as? String, !file.isEmpty, let from = d["from"] as? Int, let to = d["to"] as? Int,
        from >= 0, to >= 0
      else { throw QAScriptError(#"selectLines takes {"file": path, "from": row, "to": row}, rows counted from 0"#) }
      return .selectLines(file: file, from: from, to: to)
    case "addContext":
      guard let note = value as? String else { throw QAScriptError("addContext takes the note, which may be empty") }
      return .addContext(note)
    case "selectTerminal":
      guard value as? Bool == true else { throw QAScriptError("selectTerminal takes true") }
      return .selectTerminal
    case "addTerminal":
      guard let note = value as? String else { throw QAScriptError("addTerminal takes the note, which may be empty") }
      return .addTerminal(note)
    case "annotate":
      return .annotate(try annotate(value))
    case "browserAddress":
      if let text = value as? String, !text.isEmpty { return .browserAddress(text, escape: false) }
      guard let o = value as? [String: Any], let text = o["type"] as? String, !text.isEmpty, o["escape"] == nil || o["escape"] is Bool else {
        throw QAScriptError(#"browserAddress takes the text to type, or {"type": text, "escape": true}"#)
      }
      return .browserAddress(text, escape: o["escape"] as? Bool ?? false)
    case "openContext":
      guard let i = value as? Int, i >= 0 else { throw QAScriptError("openContext takes the chip's index, from 0") }
      return .openContext(i)
    case "referenceThread":
      switch value {
      case let name as String:
        guard let action = QAReference(rawValue: name) else { throw QAScriptError("referenceThread takes open, close, all, channel, {\"search\": text} or {\"pick\": index}") }
        return .referenceThread(action)
      case let o as [String: Any]:
        if let q = o["search"] as? String { return .referenceThread(.search(q)) }
        if let i = o["pick"] as? Int, i >= 0 { return .referenceThread(.pick(i)) }
        throw QAScriptError("referenceThread takes {\"search\": text} or {\"pick\": index}")
      default:
        throw QAScriptError("referenceThread takes open, close, all, channel, {\"search\": text} or {\"pick\": index}")
      }
    default:
      return .quit
    }
  }

  private static func annotate(_ value: Any) throws(QAScriptError) -> QAAnnotate {
    let usage = QAScriptError(#"annotate takes start, add, cancel, undo, live, send, {"drag": [x0, y0, x1, y1], "note": text}, {"tap": [x, y], "note": text}, {"hover": [x, y]}, {"livePick": [x, y], "note": text}, {"liveDrag": [x0, y0, x1, y1], "note": text}, {"shape": rect|ellipse|arrow|line, "from": [x, y], "to": [x, y]}, {"pen": [[x, y], ...]}, {"text": words, "at": [x, y]}, {"color": hex, "stroke": px}, {"move": [x, y], "by": [dx, dy]} or {"note": text} with fractions from 0 to 1"#)
    switch value as? String {
    case "start": return .start
    case "live": return .live
    case "send": return .send
    case "add": return .add
    case "cancel": return .cancel
    case "undo": return .undo
    case nil: break
    default: throw usage
    }
    guard let d = value as? [String: Any] else { throw usage }
    func fractions(_ any: Any?, _ count: Int) throws(QAScriptError) -> [Double] {
      guard let list = any as? [Any], list.count == count else { throw usage }
      let n = list.compactMap { ($0 as? NSNumber).flatMap { $0 === kCFBooleanTrue || $0 === kCFBooleanFalse ? nil : $0.doubleValue } }
      guard n.count == count, n.allSatisfy({ (0...1).contains($0) }) else { throw usage }
      return n
    }
    if let tool = d["shape"] as? String {
      guard ["rect", "ellipse", "arrow", "line"].contains(tool) else { throw usage }
      let a = try fractions(d["from"], 2), b = try fractions(d["to"], 2)
      return .shape(tool: tool, x0: a[0], y0: a[1], x1: b[0], y1: b[1])
    }
    if let list = d["pen"] as? [Any] {
      let points = try list.map { p throws(QAScriptError) in try fractions(p, 2) }
      guard points.count >= 2 else { throw usage }
      return .pen(points: points)
    }
    if let words = d["text"] as? String {
      let at = try fractions(d["at"], 2)
      return .text(words, x: at[0], y: at[1])
    }
    if d["color"] != nil || d["stroke"] != nil {
      guard (d["color"] == nil || d["color"] is String), (d["stroke"] == nil || d["stroke"] is Int) else { throw usage }
      return .style(color: d["color"] as? String, stroke: d["stroke"] as? Int)
    }
    if let at = d["move"] {
      let from = try fractions(at, 2), by = try fractions(d["by"], 2)
      return .move(x: from[0], y: from[1], dx: by[0], dy: by[1])
    }
    if d.count == 1, let at = d["hover"] {
      let p = try fractions(at, 2)
      return .hover(x: p[0], y: p[1])
    }
    if d.count == 1, let words = d["note"] as? String { return .note(words) }
    let note = d["note"] ?? ""
    guard let note = note as? String else { throw usage }
    if d["livePick"] != nil {
      let at = try fractions(d["livePick"], 2)
      return .livePick(x: at[0], y: at[1], note: note)
    }
    if d["liveDrag"] != nil {
      let n = try fractions(d["liveDrag"], 4)
      return .liveDrag(x0: n[0], y0: n[1], x1: n[2], y1: n[3], note: note)
    }
    if d["tap"] != nil {
      let at = try fractions(d["tap"], 2)
      return .tap(x: at[0], y: at[1], note: note)
    }
    let n = try fractions(d["drag"], 4)
    return .drag(x0: n[0], y0: n[1], x1: n[2], y1: n[3], note: note)
  }

  private static func folderAction(_ value: Any) throws(QAScriptError) -> QAFolderAction {
    if value as? String == "reset" { return .reset }
    if let d = value as? [String: String], d.count == 1, let f = d["here"] { return .here(folder: f) }
    let usage = #"folder takes {"new": channel}, {"new": channel, "name": name}, {"rename"|"delete"|"here": folder}, {"drag": thread, "over": folder}, {"file": thread, "into": folder}, {"menu": folder, "shot": name} or "reset""#
    guard let d = value as? [String: String] else { throw QAScriptError(usage) }
    switch (d["new"], d["rename"], d["delete"], d["drag"], d["file"], d["menu"]) {
    case (let c?, nil, nil, nil, nil, nil) where d.count == 1: return .new(channel: c)
    case (nil, let f?, nil, nil, nil, nil) where d.count == 1: return .rename(folder: f)
    case (nil, nil, let f?, nil, nil, nil) where d.count == 1: return .delete(folder: f)
    case (nil, nil, nil, let t?, nil, nil) where d.count == 2:
      guard let f = d["over"] else { throw QAScriptError(usage) }
      return .drag(thread: t, over: f)
    case (nil, nil, nil, nil, let t?, nil) where d.count == 2:
      guard let f = d["into"] else { throw QAScriptError(usage) }
      return .file(thread: t, into: f)
    case (let c?, nil, nil, nil, nil, nil) where d.count == 2:
      guard let name = d["name"] else { throw QAScriptError(usage) }
      return .create(channel: c, name: name)
    case (nil, nil, nil, nil, nil, let f?) where d.count == 2:
      guard let shot = d["shot"], validName(shot) else { throw QAScriptError(usage) }
      return .menu(folder: f, shot: shot)
    default: throw QAScriptError(usage)
    }
  }

  private static func seconds(_ value: Any, _ what: String) throws(QAScriptError) -> Duration {
    guard let n = (value as? NSNumber)?.doubleValue, n >= 0, n.isFinite else {
      throw QAScriptError("\(what) takes seconds, 0 or more")
    }
    return .milliseconds(Int((n * 1000).rounded()))
  }

  private static func validName(_ name: String) -> Bool {
    let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
    return !name.isEmpty && !name.hasPrefix(".") && name.unicodeScalars.allSatisfy(allowed.contains)
  }
}

/// The QA run's launch check, made on the raw arguments before the app model exists.
public enum QALaunch {
  /// The port `-serverPort` sets. Every `-serverPort` must be a port other than 4747, since a value the
  /// settings can't use falls back to the saved port.
  public static func serverPort(in arguments: [String]) throws(QAScriptError) -> Int {
    let refused = QAScriptError("QA runs need -serverPort set to a port other than \(ServerSettings.defaultPort).")
    let flag = "-\(ServerSettings.Key.port)"
    let values = arguments.indices.filter { arguments[$0] == flag }.map { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : "" }
    var port: Int?
    for v in values {
      guard let n = Int(v.trimmingCharacters(in: .whitespaces)), (1...65535).contains(n), n != ServerSettings.defaultPort else { throw refused }
      port = n
    }
    guard let port else { throw refused }
    return port
  }
}

/// A server that a QA run starts keeps its state in the run's out folder and runs the fake CLIs, so a
/// `{"server": "start"}` step never touches the repo's data, the brain folder or a real harness.
public enum QAServer {
  public static func environment(out: URL, repo: URL) -> [String: String] {
    let fixtures = repo.appending(path: "packages/test-fixtures")
    return [
      "OMNI_DATA_DIR": out.appending(path: "data").path,
      "OMNI_BRAIN_DIR": out.appending(path: "brain").path,
      "OMNI_CLAUDE_BIN": fixtures.appending(path: "fake-claude.mjs").path,
      "OMNI_CODEX_BIN": fixtures.appending(path: "fake-codex.mjs").path,
      "OMNI_CURSOR_BIN": fixtures.appending(path: "fake-cursor.mjs").path,
      "OMNI_BROWSER": "0",
    ]
  }
}

/// How long the frames of a scroll step took, from one display refresh to the next.
public struct QAFrameStats: Hashable, Sendable {
  /// Longer than two 60 Hz frames: one was missed.
  public static let slowMs = 33.0

  public let frames: Int
  public let mean: Double
  public let worst: Double
  public let slow: Int

  public init(gaps: [Double]) {
    frames = gaps.count
    mean = gaps.isEmpty ? 0 : gaps.reduce(0, +) / Double(gaps.count)
    worst = gaps.max() ?? 0
    slow = gaps.count { $0 > Self.slowMs }
  }

  public var summary: String {
    guard frames > 0 else { return "0 frames" }
    let ms = { (v: Double) in String(format: "%.1f ms", v) }
    return "\(frames) frames, mean \(ms(mean)), worst \(ms(worst)), \(slow) over \(Int(Self.slowMs)) ms"
  }
}

public enum QASnapshot {
  /// A capture that came out as one flat color, or nearly: nothing was drawn.
  public static func looksBlank(pixels: some Collection<UInt32>) -> Bool {
    guard !pixels.isEmpty else { return true }
    var counts: [UInt32: Int] = [:]
    for p in pixels { counts[p, default: 0] += 1 }
    let top = counts.values.max() ?? 0
    return counts.count < 2 || Double(top) / Double(pixels.count) > 0.999
  }
}

extension ServerSupervisor.State {
  /// The case name, as QA conditions spell it.
  public var name: String {
    switch self {
    case .unknown: "unknown"
    case .checking: "checking"
    case .notRunning: "notRunning"
    case .starting: "starting"
    case .running: "running"
    case .remote: "remote"
    case .failed: "failed"
    case .stopping: "stopping"
    }
  }
}

extension ConnectionState {
  public var name: String {
    switch self {
    case .connecting: "connecting"
    case .open: "open"
    case .reconnecting: "reconnecting"
    case .closed: "closed"
    }
  }
}

extension AppModel {
  public var qaFacts: QAFacts {
    QAFacts(
      serverState: supervisor.state.name, connection: store.connection.name, sidebarLoaded: store.loadState == .loaded,
      channels: Set(store.channels.map(\.id))
    )
  }
}
#endif
