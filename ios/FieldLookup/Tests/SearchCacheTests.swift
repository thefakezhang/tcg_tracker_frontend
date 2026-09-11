import Foundation
import XCTest
@testable import FieldLookup

@MainActor
final class SearchCacheTests: XCTestCase {
    private var cacheURL: URL!

    override func setUp() {
        super.setUp()
        cacheURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("field-lookup-tests-\(UUID().uuidString)")
            .appendingPathComponent("cache.json")
    }

    override func tearDown() {
        if let cacheURL {
            try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent())
        }
        cacheURL = nil
        super.tearDown()
    }

    func testCacheRetainsOriginalFreshnessAndReportsFreshThenStale() throws {
        let store = FileSearchCacheStore(fileURL: cacheURL)
        let query = try SearchQuery("ピカチュウ 001")
        let savedAt = Date(timeIntervalSince1970: 1_788_892_200)
        let result = fixtureResult()
        store.save(results: [result], query: query, userID: "operator-1", now: savedAt)

        let fresh = store.load(
            query: try SearchQuery("ピカチュウ   001"),
            userID: "operator-1",
            now: savedAt.addingTimeInterval(60 * 60)
        )
        guard case let .hit(freshResults, freshSavedAt, freshIsStale) = fresh else {
            return XCTFail("Expected fresh hit")
        }
        XCTAssertEqual(freshSavedAt, savedAt)
        XCTAssertFalse(freshIsStale)
        XCTAssertEqual(freshResults.first?.summaryRefreshedAt, result.summaryRefreshedAt)

        let stale = store.load(
            query: query,
            userID: "operator-1",
            now: savedAt.addingTimeInterval(7 * 60 * 60)
        )
        guard case let .hit(_, staleSavedAt, staleIsStale) = stale else {
            return XCTFail("Expected stale hit")
        }
        XCTAssertEqual(staleSavedAt, savedAt)
        XCTAssertTrue(staleIsStale)
    }

    func testExpiredCacheIsNotReturnedAsCurrentData() throws {
        let store = FileSearchCacheStore(fileURL: cacheURL)
        let query = try SearchQuery("Pikachu")
        let savedAt = Date(timeIntervalSince1970: 1_788_892_200)
        store.save(results: [fixtureResult()], query: query, userID: "operator-1", now: savedAt)

        let lookup = store.load(
            query: query,
            userID: "operator-1",
            now: savedAt.addingTimeInterval(8 * 24 * 60 * 60)
        )

        XCTAssertEqual(lookup, .expired(savedAt: savedAt))
        XCTAssertEqual(store.load(query: query, userID: "operator-1", now: savedAt), .miss)
    }

    func testActivatingDifferentUserClearsPriorUsersCache() throws {
        let store = FileSearchCacheStore(fileURL: cacheURL)
        let query = try SearchQuery("Pikachu")
        let now = Date(timeIntervalSince1970: 1_788_892_200)
        store.save(results: [fixtureResult()], query: query, userID: "operator-1", now: now)

        store.activate(userID: "operator-2")

        XCTAssertEqual(store.load(query: query, userID: "operator-1", now: now), .miss)
        XCTAssertEqual(store.load(query: query, userID: "operator-2", now: now), .miss)
    }

    func testCacheIsBoundedBySearchAndResultCounts() throws {
        let store = FileSearchCacheStore(fileURL: cacheURL)
        let now = Date(timeIntervalSince1970: 1_788_892_200)
        let oversizedResults = (1 ... 50).map { fixtureResult(cardID: $0) }

        for index in 0 ..< 15 {
            store.save(
                results: oversizedResults,
                query: try SearchQuery("card \(index)"),
                userID: "operator-1",
                now: now.addingTimeInterval(Double(index))
            )
        }

        XCTAssertEqual(
            store.load(query: try SearchQuery("card 0"), userID: "operator-1", now: now),
            .miss
        )
        guard case let .hit(results, _, _) = store.load(
            query: try SearchQuery("card 14"),
            userID: "operator-1",
            now: now
        ) else {
            return XCTFail("Expected newest bounded entry")
        }
        XCTAssertEqual(results.count, 40)
    }

    func testClearAllRemovesSignOutData() throws {
        let store = FileSearchCacheStore(fileURL: cacheURL)
        let query = try SearchQuery("Pikachu")
        let now = Date(timeIntervalSince1970: 1_788_892_200)
        store.save(results: [fixtureResult()], query: query, userID: "operator-1", now: now)

        store.clearAll()

        XCTAssertEqual(store.load(query: query, userID: "operator-1", now: now), .miss)
    }
}
