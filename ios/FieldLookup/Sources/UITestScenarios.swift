#if DEBUG
import Foundation
import SwiftUI

enum UITestScenario: String {
    case liveJapanese = "live-japanese"
    case offlineStale = "offline-stale"
    case retry
    case sessionExpired = "session-expired"
    case loading

    static var current: UITestScenario? {
        let arguments = ProcessInfo.processInfo.arguments
        guard
            let flagIndex = arguments.firstIndex(of: "--ui-test-scenario"),
            arguments.indices.contains(flagIndex + 1)
        else {
            return nil
        }
        return UITestScenario(rawValue: arguments[flagIndex + 1])
    }
}

struct UITestScenarioView: View {
    let scenario: UITestScenario

    var body: some View {
        switch scenario {
        case .sessionExpired:
            SignInView(message: "Your session expired. Sign in again to continue.", onSignIn: {})
        case .liveJapanese, .offlineStale, .retry, .loading:
            UITestLookupHost(scenario: scenario)
        }
    }
}

private struct UITestLookupHost: View {
    @StateObject private var viewModel: FieldLookupViewModel

    init(scenario: UITestScenario) {
        let result = UITestFixtures.pikachu
        let repository = UITestRepository(results: [result])
        let cache = UITestCacheStore()
        let fixedNow = UITestFixtures.now
        let initialState: LookupState
        let retryQuery: SearchQuery?

        switch scenario {
        case .liveJapanese:
            initialState = .loaded(results: [result], provenance: .live(loadedAt: fixedNow))
            retryQuery = nil
        case .offlineStale:
            initialState = .loaded(
                results: [UITestFixtures.unknownStock],
                provenance: .cached(
                    savedAt: fixedNow.addingTimeInterval(-2 * 24 * 60 * 60),
                    stale: true
                )
            )
            retryQuery = nil
        case .retry:
            initialState = .failure(message: "No network connection and no cached result for this search.")
            retryQuery = try? SearchQuery("ピカチュウ 001")
        case .loading:
            initialState = .loading
            retryQuery = nil
        case .sessionExpired:
            initialState = .sessionExpired
            retryQuery = nil
        }

        _viewModel = StateObject(
            wrappedValue: FieldLookupViewModel(
                userID: "ui-test-administrator",
                repository: repository,
                cache: cache,
                queryText: "ピカチュウ 001",
                initialState: initialState,
                retryQuery: retryQuery,
                now: { fixedNow }
            )
        )
    }

    var body: some View {
        FieldLookupScreen(
            viewModel: viewModel,
            accountLabel: "field@example.com",
            onSignOut: {}
        )
    }
}

@MainActor
private final class UITestRepository: FieldLookupRepositoryProtocol {
    let results: [CardLookupResult]

    init(results: [CardLookupResult]) {
        self.results = results
    }

    func search(_: SearchQuery, expectedUserID _: String) async throws -> [CardLookupResult] {
        results
    }
}

@MainActor
private final class UITestCacheStore: SearchCacheStoring {
    func activate(userID _: String) {}
    func load(query _: SearchQuery, userID _: String, now _: Date) -> CacheLookup { .miss }
    func save(results _: [CardLookupResult], query _: SearchQuery, userID _: String, now _: Date) {}
    func clearAll() {}
}

enum UITestFixtures {
    static let now = Date(timeIntervalSince1970: 1_788_892_200)

    static let pikachu = CardLookupResult(
        card: CardIdentity(
            cardID: 101,
            cardUID: "11111111-1111-1111-1111-111111111111",
            regionalName: "ピカチュウ",
            englishName: "Pikachu",
            setCode: "SV-P",
            cardNumber: "001/SV-P",
            variant: "プロモ",
            imageURL: nil,
            language: "jp"
        ),
        entry: PriceSignal(
            price: 12_000,
            currency: "JPY",
            symbol: "¥",
            location: "Tokyo Card Shop",
            region: "JP",
            normalizedUSD: 80,
            kind: .ask
        ),
        exit: PriceSignal(
            price: 120,
            currency: "USD",
            symbol: "$",
            location: "eBay sold",
            region: "NA",
            normalizedUSD: 120,
            kind: .sold
        ),
        roi: 50,
        summaryRefreshedAt: Date(timeIntervalSince1970: 1_788_888_600),
        inventory: .known(owned: 2, incoming: 1, consigned: 1, available: 1)
    )

    static let unknownStock = CardLookupResult(
        card: pikachu.card,
        entry: pikachu.entry,
        exit: pikachu.exit,
        roi: pikachu.roi,
        summaryRefreshedAt: pikachu.summaryRefreshedAt,
        inventory: .unknown
    )
}
#endif
