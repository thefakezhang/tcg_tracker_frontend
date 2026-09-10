import Combine
import Foundation

@MainActor
final class FieldLookupViewModel: ObservableObject {
    @Published var queryText: String
    @Published private(set) var state: LookupState

    private let userID: String
    private let repository: FieldLookupRepositoryProtocol
    private let cache: SearchCacheStoring
    private let now: () -> Date
    private let onSessionExpired: () -> Void
    private var lastSubmittedQuery: SearchQuery?

    init(
        userID: String,
        repository: FieldLookupRepositoryProtocol,
        cache: SearchCacheStoring,
        queryText: String = "",
        initialState: LookupState = .idle,
        retryQuery: SearchQuery? = nil,
        now: @escaping () -> Date = Date.init,
        onSessionExpired: @escaping () -> Void = {}
    ) {
        self.userID = userID
        self.repository = repository
        self.cache = cache
        self.queryText = queryText
        state = initialState
        lastSubmittedQuery = retryQuery
        self.now = now
        self.onSessionExpired = onSessionExpired
        cache.activate(userID: userID)
    }

    var canRetry: Bool {
        lastSubmittedQuery != nil
    }

    func search() async {
        let query: SearchQuery
        do {
            query = try SearchQuery(queryText)
        } catch {
            state = .failure(message: FieldLookupError.invalidSearch.localizedDescription)
            return
        }
        await submit(query)
    }

    func retry() async {
        guard let lastSubmittedQuery else { return }
        await submit(lastSubmittedQuery)
    }

    private func submit(_ query: SearchQuery) async {
        lastSubmittedQuery = query
        state = .loading

        do {
            let results = try await repository.search(query, expectedUserID: userID)
            if results.isEmpty {
                state = .empty
                return
            }
            let loadedAt = now()
            cache.save(results: results, query: query, userID: userID, now: loadedAt)
            state = .loaded(results: results, provenance: .live(loadedAt: loadedAt))
        } catch FieldLookupError.networkUnavailable {
            restoreCached(query)
        } catch FieldLookupError.sessionExpired {
            expireSession()
        } catch FieldLookupError.userChanged {
            expireSession()
        } catch let FieldLookupError.accessDenied(role) {
            cache.clearAll()
            state = .failure(message: role.accessMessage)
        } catch let error as LocalizedError {
            state = .failure(message: error.errorDescription ?? "Lookup failed. Try again.")
        } catch {
            state = .failure(message: "Lookup failed. Try again.")
        }
    }

    private func restoreCached(_ query: SearchQuery) {
        switch cache.load(query: query, userID: userID, now: now()) {
        case let .hit(results, savedAt, stale):
            state = .loaded(results: results, provenance: .cached(savedAt: savedAt, stale: stale))
        case let .expired(savedAt):
            state = .cacheExpired(savedAt: savedAt)
        case .miss:
            state = .failure(message: "No network connection and no cached result for this search.")
        }
    }

    private func expireSession() {
        cache.clearAll()
        state = .sessionExpired
        onSessionExpired()
    }
}
