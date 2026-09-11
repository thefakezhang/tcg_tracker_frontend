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
            now: { now.addingTimeInterval(7 * 60 * 60) },
            onSignInRequired: { _ in }
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
            now: { Date(timeIntervalSince1970: 1_788_892_200) },
            onSignInRequired: { _ in }
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

    func testSessionExpirySignalsRequiredSignInAndDisablesRetry() async {
        let repository = SequenceRepository(outcomes: [.failure(.sessionExpired)])
        let cache = MemoryCache()
        var signInMessage: String?
        let viewModel = FieldLookupViewModel(
            userID: "operator-1",
            repository: repository,
            cache: cache,
            queryText: "Pikachu",
            onSignInRequired: { signInMessage = $0 }
        )

        await viewModel.search()

        XCTAssertEqual(viewModel.state, .sessionExpired)
        XCTAssertEqual(cache.clearCount, 0)
        XCTAssertEqual(
            signInMessage,
            "Your session expired. Sign in again to continue."
        )
        XCTAssertFalse(viewModel.canRetry)
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
            queryText: "Pikachu",
            onSignInRequired: { _ in }
        )

        await viewModel.search()

        guard case let .loaded(results, _) = viewModel.state else {
            return XCTFail("Expected result")
        }
        XCTAssertEqual(results.first?.inventory, .unknown)
    }
}
