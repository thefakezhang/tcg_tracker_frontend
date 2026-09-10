import Foundation

enum CacheLookup: Equatable, Sendable {
    case hit(results: [CardLookupResult], savedAt: Date, stale: Bool)
    case expired(savedAt: Date)
    case miss
}

@MainActor
protocol SearchCacheStoring: AnyObject {
    func activate(userID: String)
    func load(query: SearchQuery, userID: String, now: Date) -> CacheLookup
    func save(results: [CardLookupResult], query: SearchQuery, userID: String, now: Date)
    func clearAll()
}

@MainActor
final class FileSearchCacheStore: SearchCacheStoring {
    static let maximumSearches = 12
    static let maximumResultsPerSearch = 40
    static let staleAfter: TimeInterval = 6 * 60 * 60
    static let expiresAfter: TimeInterval = 7 * 24 * 60 * 60

    private let fileURL: URL
    private let fileManager: FileManager

    init(fileURL: URL, fileManager: FileManager = .default) {
        self.fileURL = fileURL
        self.fileManager = fileManager
    }

    convenience init(fileManager: FileManager = .default) throws {
        let root = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        self.init(
            fileURL: root
                .appendingPathComponent("FieldLookup", isDirectory: true)
                .appendingPathComponent("search-cache-v1.json"),
            fileManager: fileManager
        )
    }

    func activate(userID: String) {
        guard let envelope = readEnvelope() else { return }
        if envelope.userID != userID {
            clearAll()
        }
    }

    func load(query: SearchQuery, userID: String, now: Date) -> CacheLookup {
        guard var envelope = readEnvelope() else { return .miss }
        guard envelope.userID == userID else {
            clearAll()
            return .miss
        }
        guard let index = envelope.searches.firstIndex(where: { $0.queryIdentity == query.normalizedIdentity }) else {
            return .miss
        }

        let entry = envelope.searches[index]
        let age = now.timeIntervalSince(entry.savedAt)
        if age > Self.expiresAfter {
            envelope.searches.remove(at: index)
            writeEnvelope(envelope)
            return .expired(savedAt: entry.savedAt)
        }
        return .hit(
            results: entry.results,
            savedAt: entry.savedAt,
            stale: age > Self.staleAfter
        )
    }

    func save(results: [CardLookupResult], query: SearchQuery, userID: String, now: Date) {
        var envelope = readEnvelope()
        if envelope?.userID != userID {
            envelope = CacheEnvelope(version: 1, userID: userID, searches: [])
        }
        guard var envelope else { return }

        envelope.searches.removeAll { $0.queryIdentity == query.normalizedIdentity }
        envelope.searches.insert(
            CachedSearch(
                queryIdentity: query.normalizedIdentity,
                originalQuery: query.original,
                savedAt: now,
                results: Array(results.prefix(Self.maximumResultsPerSearch))
            ),
            at: 0
        )
        envelope.searches = Array(envelope.searches.prefix(Self.maximumSearches))
        writeEnvelope(envelope)
    }

    func clearAll() {
        try? fileManager.removeItem(at: fileURL)
    }

    private func readEnvelope() -> CacheEnvelope? {
        guard
            let data = try? Data(contentsOf: fileURL),
            let envelope = try? JSONDecoder().decode(CacheEnvelope.self, from: data),
            envelope.version == 1
        else {
            return nil
        }
        return envelope
    }

    private func writeEnvelope(_ envelope: CacheEnvelope) {
        do {
            let directory = fileURL.deletingLastPathComponent()
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(envelope)
            try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUnlessOpen])
        } catch {
            return
        }
    }
}

private struct CacheEnvelope: Codable {
    let version: Int
    let userID: String
    var searches: [CachedSearch]
}

private struct CachedSearch: Codable {
    let queryIdentity: String
    let originalQuery: String
    let savedAt: Date
    let results: [CardLookupResult]
}
