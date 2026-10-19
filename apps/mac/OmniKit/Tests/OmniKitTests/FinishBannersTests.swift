import Testing
import OmniKit

@Suite struct FinishBannersTests {
  func thread(_ status: String, id: String = "t1", title: String = "Fix cart") throws -> OmniThread {
    try decode(OmniThread.self, threadJSON(status: status).replacingOccurrences(of: "\"id\":\"t1\"", with: "\"id\":\"\(id)\"").replacingOccurrences(of: "Fix cart", with: title))
  }

  @Test func aRunningThreadThatEndsGetsABanner() throws {
    var tracker = FinishTracker()
    tracker.seed([try thread("running")])
    let done = tracker.observe(try thread("done"), viewing: nil, windowActive: true)
    #expect(done?.title == "Fix cart")
    #expect(done?.body == "Finished in #acme")

    tracker.seed([try thread("queued", id: "t2")])
    #expect(tracker.observe(try thread("failed", id: "t2"), viewing: nil, windowActive: true)?.body == "Failed in #acme")
    _ = tracker.observe(try thread("running", id: "t3"), viewing: nil, windowActive: true)
    #expect(tracker.observe(try thread("stopped", id: "t3", title: ""), viewing: nil, windowActive: true)?.title == "Untitled thread")
  }

  @Test func noBannerForAThreadNeverSeenActiveOrAnOtherChange() throws {
    var tracker = FinishTracker()
    #expect(tracker.observe(try thread("done"), viewing: nil, windowActive: true) == nil)
    _ = tracker.observe(try thread("running", id: "t2"), viewing: nil, windowActive: true)
    #expect(tracker.observe(try thread("running", id: "t2"), viewing: nil, windowActive: true) == nil)
    #expect(tracker.observe(try thread("imported", id: "t2"), viewing: nil, windowActive: true) == nil)
    // Done twice: the second is not a finish.
    #expect(tracker.observe(try thread("done", id: "t2"), viewing: nil, windowActive: true) == nil)
  }

  @Test func seedDoesNotOverwriteWhatTheFeedSaid() throws {
    var tracker = FinishTracker()
    _ = tracker.observe(try thread("running"), viewing: nil, windowActive: true)
    tracker.seed([try thread("done")])
    #expect(tracker.observe(try thread("done"), viewing: nil, windowActive: true) != nil)
  }

  @Test func theThreadOnScreenInTheFrontWindowGetsNone() throws {
    var tracker = FinishTracker()
    tracker.seed([try thread("running")])
    #expect(tracker.observe(try thread("done"), viewing: "t1", windowActive: true) == nil)
    tracker.seed([try thread("running", id: "t2")])
    #expect(tracker.observe(try thread("done", id: "t2"), viewing: "t2", windowActive: false) != nil)
  }
}
