import Foundation
import XCTest
@testable import FieldLookup

@MainActor
final class FieldLookupViewModelTests: XCTestCase {
    func testOfflineRecoveryUsesMatchingUserAndQueryCache() async throws {
        let now = Date(timeIntervalSince1970: 1_788_892_200)
        let query = try SearchQuery("ピカチュウ")
        let cache = MemoryCache()
        cache.save(results: [fixtureResult()], query: query, userID: "operator-1", now: now)
        let repository = SequenceRepository(outcomes: [.failure(.networkUnavailable)])
        let viewModel = FieldLookupViewModel(
            userID: "operator-1",
            repository: repository,
            cache: cache,
            queryText: "ピカチュウ",
            now: { now.addingTimeInterval(7 * 60 * 60) }
        )

        await viewModel.search()

        guard case let .loaded(results, provenance) = viewModel.state else {
            return XCTFail("Expected cached results")
        }
        XCTAssertEqual(results, [fixtureResult()])
        XCTAssertEqual(provenance, .cached(savedAt: now, stale: true))
    }

    func testRetryRunsSameQueryAndRecovers() async {
        let result = fixtureResult()
        let repository = SequenceRepository(outcomes: [
            .failure(.networkUnavailable),
            .success([result]),
        ])
        let cache = MemoryCache()
        let viewModel = FieldLookupViewModel(
            userID: "operator-1",
            repository: repository,
            cache: cache,
            queryText: "Pikachu",
            now: { Date(timeIntervalSince1970: 1_788_892_200) }
        )

        await viewModel.search()
        XCTAssertEqual(
            viewModel.state,
            .failure(message: "No network connection and no cached result for this search.")
        )
        XCTAssertTrue(viewModel.canRetry)

        viewModel.queryText = "A different draft"
        await viewModel.retry()

        guard case let .loaded(results, .live(_)) = viewModel.state else {
            return XCTFail("Expected live retry recovery")
        }
        XCTAssertEqual(results, [result])
        XCTAssertEqual(repository.searchedIdentities, ["pikachu", "pikachu"])
    }

    func testSessionExpiryClearsCacheAndSignalsCoordinator() async {
        let repository = SequenceRepository(outcomes: [.failure(.sessionExpired)])
        let cache = MemoryCache()
        var expiryCount = 0
        let viewModel = FieldLookupViewModel(
            userID: "operator-1",
            repository: repository,
            cache: cache,
            queryText: "Pikachu",
            onSessionExpired: { expiryCount += 1 }
        )

        await viewModel.search()

        XCTAssertEqual(viewModel.state, .sessionExpired)
        XCTAssertEqual(cache.clearCount, 1)
        XCTAssertEqual(expiryCount, 1)
    }

    func testUnknownStockSurvivesLiveResultWithoutBecomingZero() async {
        let result = CardLookupResult(
            card: fixtureResult().card,
            entry: fixtureResult().entry,
            exit: fixtureResult().exit,
            roi: fixtureResult().roi,
            summaryRefreshedAt: fixtureResult().summaryRefreshedAt,
            inventory: .unknown
        )
        let viewModel = FieldLookupViewModel(
            userID: "operator-1",
            repository: SequenceRepository(outcomes: [.success([result])]),
            cache: MemoryCache(),
            queryText: "Pikachu"
        )

        await viewModel.search()

        guard case let .loaded(results, _) = viewModel.state else {
            return XCTFail("Expected result")
        }
        XCTAssertEqual(results.first?.inventory, .unknown)
    }
}

@MainActor
final class SequenceRepository: FieldLookupRepositoryProtocol {
    enum Outcome {
        case success([CardLookupResult])
        case failure(FieldLookupError)
    }

    private var outcomes: [Outcome]
    private(set) var searchedIdentities: [String] = []

    init(outcomes: [Outcome]) {
        self.outcomes = outcomes
    }

    func search(_ query: SearchQuery, expectedUserID _: String) async throws -> [CardLookupResult] {
        searchedIdentities.append(query.normalizedIdentity)
        guard !outcomes.isEmpty else { return [] }
        switch outcomes.removeFirst() {
        case let .success(results):
            return results
        case let .failure(error):
            throw error
        }
    }
}

@MainActor
final class MemoryCache: SearchCacheStoring {
    private var entries: [String: (results: [CardLookupResult], savedAt: Date)] = [:]
    private(set) var clearCount = 0

    func activate(userID _: String) {}

    func load(query: SearchQuery, userID: String, now: Date) -> CacheLookup {
        guard let entry = entries["\(userID):\(query.normalizedIdentity)"] else { return .miss }
        return .hit(
            results: entry.results,
            savedAt: entry.savedAt,
            stale: now.timeIntervalSince(entry.savedAt) > FileSearchCacheStore.staleAfter
        )
    }

    func save(results: [CardLookupResult], query: SearchQuery, userID: String, now: Date) {
        entries["\(userID):\(query.normalizedIdentity)"] = (results, now)
    }

    func clearAll() {
        entries.removeAll()
        clearCount += 1
    }
}
