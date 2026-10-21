import Foundation

/// The Home greeting, as `greeting` in apps/web/src/greeting.ts: the hour's word, with the name from the
/// profile when Settings has one.
public enum Greeting {
  public static func text(hour: Int, name: String?) -> String {
    let base = hour < 5 ? "Late one" : hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening"
    guard let name, !name.isEmpty else { return base }
    return "\(base), \(name)"
  }
}
