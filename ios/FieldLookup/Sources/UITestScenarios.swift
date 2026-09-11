#if DEBUG
import Foundation
import SwiftUI
import UIKit

enum UITestScenario: String {
    case liveJapanese = "live-japanese"
    case offlineStale = "offline-stale"
    case retry
    case sessionExpired = "session-expired"
    case accessRevoked = "access-revoked"
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
        case .accessRevoked:
            UITestAccessRevokedHost()
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
        case .sessionExpired, .accessRevoked:
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
                now: { fixedNow },
                onSignInRequired: { _ in }
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

private struct UITestAccessRevokedHost: View {
    @StateObject private var coordinator: AppCoordinator

    init() {
        _coordinator = StateObject(
            wrappedValue: AppCoordinator(
                authentication: UITestAuthentication(session: UITestFixtures.operatorSession),
                repository: UITestAccessDeniedRepository(),
                cache: UITestCacheStore(),
                now: { UITestFixtures.now }
            )
        )
    }

    var body: some View {
        AppRootView(coordinator: coordinator)
            .task {
                await coordinator.restoreIfNeeded()
            }
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
private final class UITestAccessDeniedRepository: FieldLookupRepositoryProtocol {
    func search(_: SearchQuery, expectedUserID _: String) async throws -> [CardLookupResult] {
        throw FieldLookupError.accessDenied(.unknown)
    }
}

@MainActor
private final class UITestAuthentication: AuthenticationControlling {
    private var session: OperatorSession?

    init(session: OperatorSession) {
        self.session = session
    }

    func restore() async throws -> OperatorSession? { session }

    func signInWithGoogle() async throws -> OperatorSession {
        guard let session else { throw FieldLookupError.sessionExpired }
        return session
    }

    func signOut() async throws {
        session = nil
    }

    func administratorSession(expectedUserID: String) async throws -> OperatorSession {
        guard let session else { throw FieldLookupError.sessionExpired }
        guard session.userID == expectedUserID else { throw FieldLookupError.userChanged }
        guard session.role == .administrator else { throw FieldLookupError.accessDenied(session.role) }
        return session
    }

    func invalidateLocalSession() {
        session = nil
    }

    func handleOpenURL(_: URL) {}
}

@MainActor
private final class UITestCacheStore: SearchCacheStoring {
    func activate(userID _: String) {}
    func load(query _: SearchQuery, userID _: String, now _: Date) -> CacheLookup { .miss }
    func save(results _: [CardLookupResult], query _: SearchQuery, userID _: String, now _: Date) {}
    func clearAll() {}
}

@MainActor
enum UITestFixtures {
    static let now = Date(timeIntervalSince1970: 1_788_892_200)

    static let operatorSession = OperatorSession(
        userID: "ui-test-administrator",
        email: "field@example.com",
        accessToken: "fixture-token",
        expiresAt: Date(timeIntervalSince1970: 2_000_000_000),
        role: .administrator
    )

    static let pikachu = CardLookupResult(
        card: CardIdentity(
            cardID: 101,
            cardUID: "11111111-1111-1111-1111-111111111111",
            regionalName: "ピカチュウ",
            englishName: "Pikachu",
            setCode: "SV-P",
            cardNumber: "001/SV-P",
            variant: "プロモ",
            imageURL: fixtureImageURL,
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
        card: CardIdentity(
            cardID: pikachu.card.cardID,
            cardUID: pikachu.card.cardUID,
            regionalName: pikachu.card.regionalName,
            englishName: pikachu.card.englishName,
            setCode: pikachu.card.setCode,
            cardNumber: pikachu.card.cardNumber,
            variant: pikachu.card.variant,
            imageURL: invalidImageURL,
            language: pikachu.card.language
        ),
        entry: pikachu.entry,
        exit: pikachu.exit,
        roi: pikachu.roi,
        summaryRefreshedAt: pikachu.summaryRefreshedAt,
        inventory: .unknown
    )

    private static let fixtureImageURL: URL = {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: 360, height: 504),
            format: format
        )
        let data = renderer.pngData { context in
            UIColor.systemIndigo.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 360, height: 504))
            UIColor.systemYellow.setFill()
            UIBezierPath(
                roundedRect: CGRect(x: 28, y: 28, width: 304, height: 448),
                cornerRadius: 24
            ).fill()
            let text = "SV-P\n001"
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.boldSystemFont(ofSize: 58),
                .foregroundColor: UIColor.systemIndigo,
                .paragraphStyle: {
                    let style = NSMutableParagraphStyle()
                    style.alignment = .center
                    return style
                }(),
            ]
            text.draw(
                in: CGRect(x: 50, y: 185, width: 260, height: 150),
                withAttributes: attributes
            )
        }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("field-lookup-ui-card.png")
        try! data.write(to: url, options: .atomic)
        return url
    }()

    private static let invalidImageURL: URL = {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("field-lookup-ui-card-invalid.bin")
        try! Data("not an image".utf8).write(to: url, options: .atomic)
        return url
    }()
}
#endif
