import Foundation
import Supabase

@MainActor
protocol AuthenticationControlling: SessionAccessProviding {
    func restore() async throws -> OperatorSession?
    func signInWithGoogle() async throws -> OperatorSession
    func signOut() async throws
    func handleOpenURL(_ url: URL)
}

@MainActor
final class SupabaseSessionController: AuthenticationControlling {
    static let keychainService = "com.tztcg.fieldlookup.auth"
    static let storageKey = "field-lookup.supabase.session"

    private let client: SupabaseClient
    private let keychain: KeychainLocalStorage
    private let now: () -> Date

    init(configuration: AppConfiguration, now: @escaping () -> Date = Date.init) {
        let keychain = KeychainLocalStorage(service: Self.keychainService)
        self.keychain = keychain
        client = SupabaseClient(
            supabaseURL: configuration.supabaseURL,
            supabaseKey: configuration.publishableKey,
            options: SupabaseClientOptions(
                auth: .init(
                    storage: keychain,
                    redirectToURL: configuration.redirectURL,
                    storageKey: Self.storageKey,
                    flowType: .pkce,
                    autoRefreshToken: true,
                    emitLocalSessionAsInitialSession: true
                )
            )
        )
        self.now = now
    }

    func restore() async throws -> OperatorSession? {
        guard client.auth.currentSession != nil else { return nil }
        return try await currentValidatedSession()
    }

    func signInWithGoogle() async throws -> OperatorSession {
        let session = try await client.auth.signInWithOAuth(provider: .google)
        return try map(session)
    }

    func administratorSession(expectedUserID: String) async throws -> OperatorSession {
        let session = try await currentValidatedSession()
        guard session.userID == expectedUserID else {
            invalidateLocalSession()
            throw FieldLookupError.userChanged
        }
        guard session.role == .administrator else {
            invalidateLocalSession()
            throw FieldLookupError.accessDenied(session.role)
        }
        return session
    }

    func signOut() async throws {
        var signOutError: Error?
        do {
            try await client.auth.signOut(scope: .local)
        } catch {
            signOutError = error
        }
        invalidateLocalSession()
        if let signOutError {
            throw signOutError
        }
    }

    func invalidateLocalSession() {
        try? keychain.remove(key: Self.storageKey)
        try? keychain.remove(key: "\(Self.storageKey)-code-verifier")
    }

    func handleOpenURL(_ url: URL) {
        client.auth.handle(url)
    }

    private func currentValidatedSession() async throws -> OperatorSession {
        do {
            return try map(try await client.auth.session)
        } catch let error as FieldLookupError {
            throw error
        } catch {
            if client.auth.currentSession == nil || client.auth.currentSession?.isExpired == true {
                invalidateLocalSession()
                throw FieldLookupError.sessionExpired
            }
            throw FieldLookupError.networkUnavailable
        }
    }

    private func map(_ session: Session) throws -> OperatorSession {
        let expiresAt = Date(timeIntervalSince1970: session.expiresAt)
        guard expiresAt.timeIntervalSince(now()) > 30 else {
            invalidateLocalSession()
            throw FieldLookupError.sessionExpired
        }
        return OperatorSession(
            userID: session.user.id.uuidString.lowercased(),
            email: session.user.email,
            accessToken: session.accessToken,
            expiresAt: expiresAt,
            role: JWTPrincipalDecoder.role(from: session.accessToken)
        )
    }
}

enum JWTPrincipalDecoder {
    static func role(from token: String) -> PrincipalRole {
        let segments = token.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count == 3 else { return .unknown }

        var payload = String(segments[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = payload.count % 4
        if remainder != 0 {
            payload.append(String(repeating: "=", count: 4 - remainder))
        }

        guard
            let data = Data(base64Encoded: payload),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let rawRole = object["role"] as? String
        else {
            return .unknown
        }

        return PrincipalRole(rawValue: rawRole.lowercased()) ?? .unknown
    }
}
