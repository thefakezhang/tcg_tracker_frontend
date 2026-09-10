import Foundation
import XCTest
@testable import FieldLookup

final class AuthenticationTests: XCTestCase {
    func testJWTPrincipalDecoderDistinguishesEveryApplicationRole() {
        XCTAssertEqual(JWTPrincipalDecoder.role(from: token(role: "administrator")), .administrator)
        XCTAssertEqual(JWTPrincipalDecoder.role(from: token(role: "buyer")), .buyer)
        XCTAssertEqual(JWTPrincipalDecoder.role(from: token(role: "unmapped")), .unmapped)
        XCTAssertEqual(JWTPrincipalDecoder.role(from: token(role: "authenticated")), .authenticated)
        XCTAssertEqual(JWTPrincipalDecoder.role(from: token(role: "service_role")), .unknown)
        XCTAssertEqual(JWTPrincipalDecoder.role(from: "invalid"), .unknown)
    }

    private func token(role: String) -> String {
        let payload = try! JSONSerialization.data(withJSONObject: ["role": role])
        let encoded = payload.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "header.\(encoded).signature"
    }
}

@MainActor
final class AppCoordinatorTests: XCTestCase {
    func testAdministratorRestoresAuthorizedAndSignOutClearsCache() async {
        let auth = FakeAuthentication(session: makeSession(role: .administrator))
        let cache = MemoryCache()
        let coordinator = AppCoordinator(
            authentication: auth,
            repository: SequenceRepository(outcomes: []),
            cache: cache
        )

        await coordinator.restoreIfNeeded()
        guard case let .authorized(session) = coordinator.state else {
            return XCTFail("Expected administrator access")
        }
        XCTAssertEqual(session.role, .administrator)

        await coordinator.signOut()
        XCTAssertEqual(coordinator.state, .signedOut(message: nil))
        XCTAssertEqual(auth.signOutCount, 1)
        XCTAssertEqual(cache.clearCount, 1)
    }

    func testBuyerUnmappedAndGenericAuthenticatedAreDistinctDenials() async {
        for role in [PrincipalRole.buyer, .unmapped, .authenticated] {
            let auth = FakeAuthentication(session: makeSession(role: role))
            let coordinator = AppCoordinator(
                authentication: auth,
                repository: SequenceRepository(outcomes: []),
                cache: MemoryCache()
            )

            await coordinator.restoreIfNeeded()

            XCTAssertEqual(
                coordinator.state,
                .denied(role: role, email: "operator@example.com")
            )
        }
    }

    func testExpiredRestoreClearsCacheAndReturnsActionableSignInState() async {
        let auth = FakeAuthentication(session: nil, restoreError: .sessionExpired)
        let cache = MemoryCache()
        let coordinator = AppCoordinator(
            authentication: auth,
            repository: SequenceRepository(outcomes: []),
            cache: cache
        )

        await coordinator.restoreIfNeeded()

        XCTAssertEqual(
            coordinator.state,
            .signedOut(message: "Your session expired. Sign in again to continue.")
        )
        XCTAssertEqual(cache.clearCount, 1)
    }

    private func makeSession(role: PrincipalRole) -> OperatorSession {
        OperatorSession(
            userID: "operator-1",
            email: "operator@example.com",
            accessToken: "fixture",
            expiresAt: Date(timeIntervalSince1970: 2_000_000_000),
            role: role
        )
    }
}

@MainActor
final class FakeAuthentication: AuthenticationControlling {
    var session: OperatorSession?
    var restoreError: FieldLookupError?
    var signOutCount = 0
    var invalidateCount = 0

    init(session: OperatorSession?, restoreError: FieldLookupError? = nil) {
        self.session = session
        self.restoreError = restoreError
    }

    func restore() async throws -> OperatorSession? {
        if let restoreError { throw restoreError }
        return session
    }

    func signInWithGoogle() async throws -> OperatorSession {
        guard let session else { throw FieldLookupError.sessionExpired }
        return session
    }

    func signOut() async throws {
        signOutCount += 1
        session = nil
    }

    func administratorSession(expectedUserID: String) async throws -> OperatorSession {
        guard let session else { throw FieldLookupError.sessionExpired }
        guard session.userID == expectedUserID else { throw FieldLookupError.userChanged }
        guard session.role == .administrator else { throw FieldLookupError.accessDenied(session.role) }
        return session
    }

    func invalidateLocalSession() {
        invalidateCount += 1
        session = nil
    }

    func handleOpenURL(_: URL) {}
}
