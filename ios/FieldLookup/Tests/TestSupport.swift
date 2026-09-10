import Foundation
@testable import FieldLookup

enum Fixture {
    static func data(_ name: String) throws -> Data {
        let bundle = Bundle(for: BundleMarker.self)
        let url = bundle.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")
            ?? bundle.url(forResource: name, withExtension: "json")
        guard let url else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try Data(contentsOf: url)
    }
}

private final class BundleMarker {}

final class FixtureURLProtocol: URLProtocol {
    struct Response {
        let status: Int
        let data: Data
    }

    static var handler: ((URLRequest) throws -> Response)?

    override class func canInit(with _: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do {
            let fixture = try handler(request)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: fixture.status,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: fixture.data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

@MainActor
final class StaticSessionProvider: SessionAccessProviding {
    var session: OperatorSession
    var invalidationCount = 0

    init(
        userID: String = "operator-1",
        role: PrincipalRole = .administrator,
        accessToken: String = "fixture-token"
    ) {
        session = OperatorSession(
            userID: userID,
            email: "operator@example.com",
            accessToken: accessToken,
            expiresAt: Date(timeIntervalSince1970: 2_000_000_000),
            role: role
        )
    }

    func administratorSession(expectedUserID: String) async throws -> OperatorSession {
        guard session.userID == expectedUserID else {
            throw FieldLookupError.userChanged
        }
        guard session.role == .administrator else {
            throw FieldLookupError.accessDenied(session.role)
        }
        return session
    }

    func invalidateLocalSession() {
        invalidationCount += 1
    }
}

func fixtureURLSession() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [FixtureURLProtocol.self]
    return URLSession(configuration: configuration)
}

let testConfiguration = AppConfiguration(
    supabaseURL: URL(string: "https://example.supabase.co")!,
    publishableKey: "sb_publishable_fixture",
    redirectURL: URL(string: "com.tztcg.fieldlookup://auth-callback")!
)

func fixtureResult(cardID: Int = 101) -> CardLookupResult {
    CardLookupResult(
        card: CardIdentity(
            cardID: cardID,
            cardUID: nil,
            regionalName: "ピカチュウ",
            englishName: "Pikachu",
            setCode: "SV-P",
            cardNumber: "001/SV-P",
            variant: nil,
            imageURL: nil,
            language: "jp"
        ),
        entry: PriceSignal(
            price: 12_000,
            currency: "JPY",
            symbol: "¥",
            location: "Tokyo",
            region: "JP",
            normalizedUSD: 80,
            kind: .ask
        ),
        exit: PriceSignal(
            price: 120,
            currency: "USD",
            symbol: "$",
            location: "eBay",
            region: "NA",
            normalizedUSD: 120,
            kind: .sold
        ),
        roi: 0.5,
        summaryRefreshedAt: Date(timeIntervalSince1970: 1_788_888_600),
        inventory: .known(owned: 2, incoming: 1, consigned: 0, available: 2)
    )
}
