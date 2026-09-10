import Foundation
@testable import FieldLookup

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
    struct Key: Hashable {
        let userID: String
        let query: String
    }

    struct Entry {
        let results: [CardLookupResult]
        let savedAt: Date
    }

    private var entries: [Key: Entry] = [:]
    private(set) var clearCount = 0

    func activate(userID _: String) {}

    func load(query: SearchQuery, userID: String, now: Date) -> CacheLookup {
        guard let entry = entries[Key(userID: userID, query: query.normalizedIdentity)] else {
            return .miss
        }
        let age = now.timeIntervalSince(entry.savedAt)
        if age > FileSearchCacheStore.expiresAfter {
            return .expired(savedAt: entry.savedAt)
        }
        return .hit(
            results: entry.results,
            savedAt: entry.savedAt,
            stale: age > FileSearchCacheStore.staleAfter
        )
    }

    func save(results: [CardLookupResult], query: SearchQuery, userID: String, now: Date) {
        entries[Key(userID: userID, query: query.normalizedIdentity)] = Entry(
            results: results,
            savedAt: now
        )
    }

    func clearAll() {
        entries.removeAll()
        clearCount += 1
    }
}
