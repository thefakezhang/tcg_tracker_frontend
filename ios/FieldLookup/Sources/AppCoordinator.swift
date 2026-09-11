import Combine
import Foundation

enum AppAccessState: Equatable {
    case checking
    case signedOut(message: String?)
    case authorized(OperatorSession)
    case denied(role: PrincipalRole, email: String?)
    case configurationFailure(message: String)
}

@MainActor
final class AppCoordinator: ObservableObject {
    @Published private(set) var state: AppAccessState

    let repository: FieldLookupRepositoryProtocol?
    let cache: SearchCacheStoring
    private let authentication: AuthenticationControlling?
    private let now: () -> Date
    private var restored = false

    init(
        authentication: AuthenticationControlling,
        repository: FieldLookupRepositoryProtocol,
        cache: SearchCacheStoring,
        now: @escaping () -> Date = Date.init
    ) {
        self.authentication = authentication
        self.repository = repository
        self.cache = cache
        self.now = now
        state = .checking
    }

    init(configurationError: Error, cache: SearchCacheStoring) {
        authentication = nil
        repository = nil
        self.cache = cache
        now = Date.init
        state = .configurationFailure(message: configurationError.localizedDescription)
        restored = true
    }

    func restoreIfNeeded() async {
        guard !restored, let authentication else { return }
        restored = true
        state = .checking
        do {
            guard let session = try await authentication.restore() else {
                state = .signedOut(message: nil)
                return
            }
            apply(session)
        } catch FieldLookupError.sessionExpired {
            cache.clearAll()
            state = .signedOut(message: "Your session expired. Sign in again to continue.")
        } catch {
            state = .signedOut(message: "Could not restore your session. Check the network and sign in again.")
        }
    }

    func signIn() async {
        guard let authentication else { return }
        state = .checking
        do {
            apply(try await authentication.signInWithGoogle())
        } catch {
            state = .signedOut(message: "Google sign-in did not complete. Try again.")
        }
    }

    func signOut() async {
        cache.clearAll()
        if let authentication {
            try? await authentication.signOut()
        }
        state = .signedOut(message: nil)
    }

    func requireSignIn(message: String) {
        cache.clearAll()
        authentication?.invalidateLocalSession()
        state = .signedOut(message: message)
    }

    func handleOpenURL(_ url: URL) {
        authentication?.handleOpenURL(url)
    }

    func makeViewModel(for session: OperatorSession) -> FieldLookupViewModel? {
        guard let repository else { return nil }
        return FieldLookupViewModel(
            userID: session.userID,
            repository: repository,
            cache: cache,
            now: now,
            onSignInRequired: { [weak self] message in
                self?.requireSignIn(message: message)
            }
        )
    }

    private func apply(_ session: OperatorSession) {
        guard session.role == .administrator else {
            cache.clearAll()
            state = .denied(role: session.role, email: session.email)
            return
        }
        cache.activate(userID: session.userID)
        state = .authorized(session)
    }
}

@MainActor
enum FieldLookupComposition {
    static func makeCoordinator() -> AppCoordinator {
        let fallbackCacheURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("field-lookup-disabled-cache.json")
        let cache = (try? FileSearchCacheStore()) ?? FileSearchCacheStore(fileURL: fallbackCacheURL)

        do {
            let configuration = try AppConfiguration.load()
            let authentication = SupabaseSessionController(configuration: configuration)
            let repository = SupabaseFieldLookupRepository(
                configuration: configuration,
                sessionProvider: authentication
            )
            return AppCoordinator(
                authentication: authentication,
                repository: repository,
                cache: cache
            )
        } catch {
            return AppCoordinator(configurationError: error, cache: cache)
        }
    }
}
