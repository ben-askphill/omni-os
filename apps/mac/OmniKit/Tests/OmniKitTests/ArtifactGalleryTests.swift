import Foundation
import Testing
import OmniKit

private let base = Date(timeIntervalSince1970: 1_790_582_400)

private func artifact(_ id: Int, thread: String = "t1", kind: String = "html", at minutes: Int) throws -> Artifact {
  let time = ISO8601DateFormatter().string(from: base.addingTimeInterval(Double(minutes) * 60))
  return try decode(Artifact.self, """
    {"id":\(id),"thread_id":"\(thread)","path":"/x/\(id)","name":"a\(id).html","kind":"\(kind)","size":10,
     "created_at":"\(time)","updated_at":"\(time)"}
    """)
}

private func gallery(_ items: [(Int, String, Int)]) throws -> ArtifactGallery {
  var g = ArtifactGallery()
  let rows = try items.map { id, thread, minutes in
    let a = try artifact(id, thread: thread, at: minutes)
    return try decode(GalleryArtifact.self, """
      {"id":\(id),"thread_id":"\(thread)","path":"/x/\(id)","name":"a\(id).html","kind":"html","size":10,
       "created_at":"\(ISO8601DateFormatter().string(from: a.createdAt))","updated_at":"\(ISO8601DateFormatter().string(from: a.updatedAt))",
       "thread_title":"Thread \(thread)","channel_id":"acme"}
      """)
  }
  g = ArtifactGallery(rows)
  return g
}

@Suite struct ArtifactGalleryTests {
  @Test func decodesTheRecordedList() throws {
    let list = try decodeFixture([GalleryArtifact].self, "artifacts.json")
    let first = try #require(list.first)
    #expect(first.artifact.name == "report.md")
    #expect(first.artifact.kind == "markdown")
    #expect(first.threadTitle == "Fix the cart and the tests")
    #expect(first.channelID == "acme")
  }

  @Test func filtersLikeTheWebUI() {
    #expect(ArtifactFilter.pages.matches("svg") && ArtifactFilter.pages.matches("html"))
    #expect(ArtifactFilter.docs.matches("pdf") && ArtifactFilter.docs.matches("markdown") && ArtifactFilter.docs.matches("text"))
    #expect(ArtifactFilter.data.matches("csv") && !ArtifactFilter.data.matches("text"))
    #expect(ArtifactFilter.images.matches("image") && !ArtifactFilter.images.matches("screenshot"))
    #expect(ArtifactFilter.all.matches("anything"))
  }

  @Test func ignoresScreenshots() throws {
    var g = try gallery([(1, "t1", 0)])
    #expect(try g.upsert(artifact(2, kind: "screenshot", at: 5)) == .ignored)
    #expect(g.items.map(\.id) == [1])
  }

  @Test func newArtifactOfAKnownThreadJoinsOnTop() throws {
    var g = try gallery([(1, "t1", 0), (2, "t2", -5)])
    #expect(try g.upsert(artifact(3, thread: "t2", at: 3)) == .applied)
    #expect(g.items.map(\.id) == [3, 1, 2])
    #expect(g.items[0].threadTitle == "Thread t2")
    #expect(g.items[0].channelID == "acme")
  }

  @Test func newArtifactOfAnUnknownThreadNeedsAReloadUnlessTheCallerKnowsIt() throws {
    var g = try gallery([(1, "t1", 0)])
    #expect(try g.upsert(artifact(2, thread: "t9", at: 1)) == .needsReload)
    #expect(g.items.map(\.id) == [1])
    let outcome = try g.upsert(artifact(2, thread: "t9", at: 1)) { $0 == "t9" ? ("Nine", "dev") : nil }
    #expect(outcome == .applied)
    #expect(g.items.first?.threadTitle == "Nine")
    #expect(g.items.first?.channelID == "dev")
  }

  @Test func rewrittenArtifactMovesUpAndAStaleCopyIsIgnored() throws {
    var g = try gallery([(1, "t1", 0), (2, "t1", -5)])
    #expect(try g.upsert(artifact(2, at: 4)) == .applied)
    #expect(g.items.map(\.id) == [2, 1])
    #expect(g.items.count == 2)
    #expect(try g.upsert(artifact(2, at: -20)) == .ignored)
    #expect(g.items.map(\.id) == [2, 1])
  }

  @Test func aTieGoesAboveTheOlderNeighbour() throws {
    var g = try gallery([(1, "t1", 0)])
    g.upsert(try artifact(2, at: 0))
    #expect(g.items.map(\.id) == [2, 1])
  }

  @Test func stopsAtTheLimit() throws {
    var g = try gallery((1...ArtifactGallery.limit).map { ($0, "t1", 100 - $0) })
    #expect(try g.upsert(artifact(500, at: -1000)) == .ignored)
    #expect(g.items.count == ArtifactGallery.limit)
    #expect(try g.upsert(artifact(501, at: 500)) == .applied)
    #expect(g.items.count == ArtifactGallery.limit)
    #expect(g.items.first?.id == 501)
    #expect(!g.items.contains { $0.id == ArtifactGallery.limit })
  }

  @Test func countsPerFilter() throws {
    var g = try gallery([(1, "t1", 0)])
    g.upsert(try artifact(2, kind: "image", at: 1))
    #expect(g.count(matching: .all) == 2)
    #expect(g.count(matching: .images) == 1)
    #expect(g.items(matching: .pages).map(\.id) == [1])
  }
}
