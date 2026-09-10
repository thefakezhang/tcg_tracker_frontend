import Foundation
import XCTest
@testable import FieldLookup

@MainActor
final class FieldLookupRepositoryTests: XCTestCase {
    override func tearDown() {
        FixtureURLProtocol.handler = nil
        super.tearDown()
    }

    func testFixtureContractMapsDirectionKindsMissingQuotesAndKnownZero() async throws {
        let captured = CapturedRequests()
        FixtureURLProtocol.handler = { request in
            captured.append(request)
            switch request.url?.lastPathComponent {
            case "pokemon_card_definitions_operator_v":
                return .init(status: 200, data: try Fixture.data("cards"))
            case "pokemon_price_summaries_browser_v":
                return .init(status: 200, data: try Fixture.data("summaries"))
            case "owned_inventory_counts_v":
                return .init(status: 200, data: try Fixture.data("inventory"))
            default:
                return .init(status: 404, data: Data("[]".utf8))
            }
        }

        let session = StaticSessionProvider()
        let repository = SupabaseFieldLookupRepository(
            configuration: testConfiguration,
            sessionProvider: session,
            urlSession: fixtureURLSession()
        )
        let results = try await repository.search(
            SearchQuery("ピカチュウ 001"),
            expectedUserID: "operator-1"
        )

        XCTAssertEqual(results.count, 5)
        XCTAssertEqual(results[0].directionLabel, "JP → NA")
        XCTAssertEqual(results[0].exit?.kind, .sold)
        XCTAssertEqual(results[0].roi, 0.5)
        XCTAssertEqual(results[1].directionLabel, "NA → JP")
        XCTAssertEqual(results[1].exit?.kind, .bid)
        XCTAssertEqual(results[2].exit?.kind, .valuation)
        XCTAssertNil(results[3].exit)
        XCTAssertNil(results[3].roi)
        XCTAssertNil(results[4].entry)
        XCTAssertNil(results[4].exit)
        XCTAssertNil(results[4].summaryRefreshedAt)
        XCTAssertEqual(results[0].inventory, .known(owned: 2, incoming: 1, consigned: 1, available: 1))
        XCTAssertEqual(results[1].inventory, .known(owned: 0, incoming: 0, consigned: 0, available: 0))

        let definitionRequest = try XCTUnwrap(captured.requests.first {
            $0.url?.lastPathComponent == "pokemon_card_definitions_operator_v"
        })
        XCTAssertEqual(definitionRequest.value(forHTTPHeaderField: "apikey"), "sb_publishable_fixture")
        XCTAssertEqual(definitionRequest.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-token")
        let components = try XCTUnwrap(URLComponents(url: definitionRequest.url!, resolvingAgainstBaseURL: false))
        let filters = components.queryItems?.filter { $0.name == "or" } ?? []
        XCTAssertEqual(filters.count, 2)
        XCTAssertTrue(filters[0].value?.contains("regional_name.ilike.%ピカチュウ%") == true)
        XCTAssertTrue(filters[1].value?.contains("card_number.ilike.%001%") == true)
    }

    func testInventoryFailureIsUnknownRatherThanZero() async throws {
        FixtureURLProtocol.handler = { request in
            switch request.url?.lastPathComponent {
            case "pokemon_card_definitions_operator_v":
                return .init(status: 200, data: try Fixture.data("cards"))
            case "pokemon_price_summaries_browser_v":
                return .init(status: 200, data: try Fixture.data("summaries"))
            case "owned_inventory_counts_v":
                return .init(status: 503, data: Data("{}".utf8))
            default:
                return .init(status: 404, data: Data("[]".utf8))
            }
        }

        let repository = SupabaseFieldLookupRepository(
            configuration: testConfiguration,
            sessionProvider: StaticSessionProvider(),
            urlSession: fixtureURLSession()
        )
        let results = try await repository.search(SearchQuery("001"), expectedUserID: "operator-1")

        XCTAssertFalse(results.isEmpty)
        XCTAssertTrue(results.allSatisfy { $0.inventory == .unknown })
    }

    func testUnauthorizedResponseExpiresAndClearsLocalSession() async throws {
        FixtureURLProtocol.handler = { _ in
            .init(status: 401, data: Data("{}".utf8))
        }
        let session = StaticSessionProvider()
        let repository = SupabaseFieldLookupRepository(
            configuration: testConfiguration,
            sessionProvider: session,
            urlSession: fixtureURLSession()
        )

        do {
            _ = try await repository.search(SearchQuery("Pikachu"), expectedUserID: "operator-1")
            XCTFail("Expected session expiry")
        } catch {
            XCTAssertEqual(error as? FieldLookupError, .sessionExpired)
        }
        XCTAssertEqual(session.invalidationCount, 1)
    }

    func testSessionUserChangeStopsBeforeAnyRequest() async throws {
        var requestCount = 0
        FixtureURLProtocol.handler = { _ in
            requestCount += 1
            return .init(status: 200, data: Data("[]".utf8))
        }
        let repository = SupabaseFieldLookupRepository(
            configuration: testConfiguration,
            sessionProvider: StaticSessionProvider(userID: "new-user"),
            urlSession: fixtureURLSession()
        )

        do {
            _ = try await repository.search(SearchQuery("Pikachu"), expectedUserID: "old-user")
            XCTFail("Expected user change")
        } catch {
            XCTAssertEqual(error as? FieldLookupError, .userChanged)
        }
        XCTAssertEqual(requestCount, 0)
    }
}

private final class CapturedRequests: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [URLRequest] = []

    var requests: [URLRequest] {
        lock.withLock { storage }
    }

    func append(_ request: URLRequest) {
        lock.withLock { storage.append(request) }
    }
}
