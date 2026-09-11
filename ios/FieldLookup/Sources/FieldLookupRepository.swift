import Foundation

@MainActor
protocol SessionAccessProviding: AnyObject {
    func administratorSession(expectedUserID: String) async throws -> OperatorSession
    func invalidateLocalSession()
}

@MainActor
protocol FieldLookupRepositoryProtocol: AnyObject {
    func search(_ query: SearchQuery, expectedUserID: String) async throws -> [CardLookupResult]
}

@MainActor
final class SupabaseFieldLookupRepository: FieldLookupRepositoryProtocol {
    private static let resultLimit = 40

    private let configuration: AppConfiguration
    private let sessionProvider: SessionAccessProviding
    private let urlSession: URLSession
    private let decoder: JSONDecoder

    init(
        configuration: AppConfiguration,
        sessionProvider: SessionAccessProviding,
        urlSession: URLSession = .shared
    ) {
        self.configuration = configuration
        self.sessionProvider = sessionProvider
        self.urlSession = urlSession
        decoder = JSONDecoder()
    }

    func search(_ query: SearchQuery, expectedUserID: String) async throws -> [CardLookupResult] {
        let session = try await sessionProvider.administratorSession(expectedUserID: expectedUserID)
        let cards: [CardDefinitionDTO] = try await request(
            table: "pokemon_card_definitions_operator_v",
            queryItems: definitionQueryItems(for: query),
            accessToken: session.accessToken
        )

        guard !cards.isEmpty else { return [] }

        let cardIDs = cards.map(\.cardID)
        async let summariesTask: [PriceSummaryDTO] = request(
            table: "pokemon_price_summaries_browser_v",
            queryItems: summaryQueryItems(cardIDs: cardIDs),
            accessToken: session.accessToken
        )
        async let inventoryTask = readInventory(cardIDs: cardIDs, accessToken: session.accessToken)
        let (summaries, inventory) = try await (summariesTask, inventoryTask)

        return FieldLookupMapper.map(
            cards: cards,
            summaries: summaries,
            inventory: inventory
        )
    }

    private func definitionQueryItems(for query: SearchQuery) -> [URLQueryItem] {
        [
            URLQueryItem(
                name: "select",
                value: "card_id,card_uid,regional_name,english_name,set_code,card_number,misc_info,image_url,language"
            ),
            URLQueryItem(name: "order", value: "regional_name.asc,card_id.asc"),
            URLQueryItem(name: "limit", value: String(Self.resultLimit)),
        ] + query.postgRESTFilters
    }

    private func summaryQueryItems(cardIDs: [Int]) -> [URLQueryItem] {
        [
            URLQueryItem(
                name: "select",
                value: "card_id,best_buy_price,best_buy_currency,best_buy_symbol,best_buy_location,best_buy_region,best_buy_normalized,best_buy_kind,best_sell_price,best_sell_currency,best_sell_symbol,best_sell_location,best_sell_region,best_sell_normalized,best_sell_kind,roi,updated_at"
            ),
            URLQueryItem(name: "card_id", value: "in.(\(idList(cardIDs)))"),
            URLQueryItem(name: "tier", value: "eq.1"),
            URLQueryItem(name: "psa_grade", value: "eq.0"),
        ]
    }

    private func inventoryQueryItems(cardIDs: [Int]) -> [URLQueryItem] {
        [
            URLQueryItem(
                name: "select",
                value: "card_id,qty_owned,qty_incoming,qty_consigned,qty_available"
            ),
            URLQueryItem(name: "game", value: "eq.pokemon"),
            URLQueryItem(name: "item_type", value: "eq.single"),
            URLQueryItem(name: "card_id", value: "in.(\(idList(cardIDs)))"),
        ]
    }

    private func idList(_ values: [Int]) -> String {
        values.map(String.init).joined(separator: ",")
    }

    private func readInventory(cardIDs: [Int], accessToken: String) async throws -> InventoryRead {
        do {
            let rows: [InventoryDTO] = try await request(
                table: "owned_inventory_counts_v",
                queryItems: inventoryQueryItems(cardIDs: cardIDs),
                accessToken: accessToken
            )
            return .known(rows)
        } catch FieldLookupError.sessionExpired {
            throw FieldLookupError.sessionExpired
        } catch let FieldLookupError.accessDenied(role) {
            throw FieldLookupError.accessDenied(role)
        } catch FieldLookupError.userChanged {
            throw FieldLookupError.userChanged
        } catch {
            return .unavailable
        }
    }

    private func request<Response: Decodable>(
        table: String,
        queryItems: [URLQueryItem],
        accessToken: String
    ) async throws -> Response {
        var components = URLComponents(
            url: configuration.supabaseURL
                .appendingPathComponent("rest")
                .appendingPathComponent("v1")
                .appendingPathComponent(table),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = queryItems
        guard let url = components?.url else {
            throw FieldLookupError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await urlSession.data(for: request)
        } catch let error as URLError where Self.isOffline(error) {
            throw FieldLookupError.networkUnavailable
        } catch {
            throw FieldLookupError.networkUnavailable
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw FieldLookupError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200 ..< 300:
            break
        case 401:
            sessionProvider.invalidateLocalSession()
            throw FieldLookupError.sessionExpired
        case 403:
            sessionProvider.invalidateLocalSession()
            throw FieldLookupError.accessDenied(.unknown)
        default:
            throw FieldLookupError.server(status: httpResponse.statusCode)
        }

        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw FieldLookupError.invalidResponse
        }
    }

    private static func isOffline(_ error: URLError) -> Bool {
        switch error.code {
        case .notConnectedToInternet,
             .networkConnectionLost,
             .cannotConnectToHost,
             .cannotFindHost,
             .dnsLookupFailed,
             .timedOut,
             .internationalRoamingOff,
             .dataNotAllowed:
            return true
        default:
            return false
        }
    }
}

enum InventoryRead: Sendable {
    case known([InventoryDTO])
    case unavailable
}

struct CardDefinitionDTO: Decodable, Sendable {
    let cardID: Int
    let cardUID: String?
    let regionalName: String
    let englishName: String?
    let setCode: String
    let cardNumber: String?
    let miscInfo: String?
    let imageURL: URL?
    let language: String?

    enum CodingKeys: String, CodingKey {
        case cardID = "card_id"
        case cardUID = "card_uid"
        case regionalName = "regional_name"
        case englishName = "english_name"
        case setCode = "set_code"
        case cardNumber = "card_number"
        case miscInfo = "misc_info"
        case imageURL = "image_url"
        case language
    }
}

struct PriceSummaryDTO: Decodable, Sendable {
    let cardID: Int
    let bestBuyPrice: Double?
    let bestBuyCurrency: String?
    let bestBuySymbol: String?
    let bestBuyLocation: String?
    let bestBuyRegion: String?
    let bestBuyNormalized: Double?
    let bestBuyKind: String?
    let bestSellPrice: Double?
    let bestSellCurrency: String?
    let bestSellSymbol: String?
    let bestSellLocation: String?
    let bestSellRegion: String?
    let bestSellNormalized: Double?
    let bestSellKind: String?
    let roi: Double?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case cardID = "card_id"
        case bestBuyPrice = "best_buy_price"
        case bestBuyCurrency = "best_buy_currency"
        case bestBuySymbol = "best_buy_symbol"
        case bestBuyLocation = "best_buy_location"
        case bestBuyRegion = "best_buy_region"
        case bestBuyNormalized = "best_buy_normalized"
        case bestBuyKind = "best_buy_kind"
        case bestSellPrice = "best_sell_price"
        case bestSellCurrency = "best_sell_currency"
        case bestSellSymbol = "best_sell_symbol"
        case bestSellLocation = "best_sell_location"
        case bestSellRegion = "best_sell_region"
        case bestSellNormalized = "best_sell_normalized"
        case bestSellKind = "best_sell_kind"
        case roi
        case updatedAt = "updated_at"
    }
}

struct InventoryDTO: Decodable, Sendable {
    let cardID: Int
    let quantityOwned: Int
    let quantityIncoming: Int
    let quantityConsigned: Int
    let quantityAvailable: Int

    enum CodingKeys: String, CodingKey {
        case cardID = "card_id"
        case quantityOwned = "qty_owned"
        case quantityIncoming = "qty_incoming"
        case quantityConsigned = "qty_consigned"
        case quantityAvailable = "qty_available"
    }
}

enum FieldLookupMapper {
    static func map(
        cards: [CardDefinitionDTO],
        summaries: [PriceSummaryDTO],
        inventory: InventoryRead
    ) -> [CardLookupResult] {
        let summariesByCard = Dictionary(uniqueKeysWithValues: summaries.map { ($0.cardID, $0) })
        let inventoryByCard: [Int: InventoryDTO]
        switch inventory {
        case let .known(rows):
            inventoryByCard = Dictionary(uniqueKeysWithValues: rows.map { ($0.cardID, $0) })
        case .unavailable:
            inventoryByCard = [:]
        }

        return cards.map { card in
            let summary = summariesByCard[card.cardID]
            let entry = summary.flatMap(entrySignal)
            let exit = summary.flatMap(exitSignal)
            let stock: InventoryAvailability

            switch inventory {
            case .unavailable:
                stock = .unknown
            case .known:
                if let row = inventoryByCard[card.cardID] {
                    stock = .known(
                        owned: row.quantityOwned,
                        incoming: row.quantityIncoming,
                        consigned: row.quantityConsigned,
                        available: row.quantityAvailable
                    )
                } else {
                    stock = .known(owned: 0, incoming: 0, consigned: 0, available: 0)
                }
            }

            return CardLookupResult(
                card: CardIdentity(
                    cardID: card.cardID,
                    cardUID: card.cardUID,
                    regionalName: card.regionalName,
                    englishName: card.englishName,
                    setCode: card.setCode,
                    cardNumber: card.cardNumber,
                    variant: normalizedVariant(card.miscInfo),
                    imageURL: card.imageURL,
                    language: card.language
                ),
                entry: entry,
                exit: exit,
                roi: entry != nil && exit != nil ? summary?.roi : nil,
                summaryRefreshedAt: FieldLookupDate.parse(summary?.updatedAt),
                inventory: stock
            )
        }
    }

    private static func entrySignal(_ row: PriceSummaryDTO) -> PriceSignal? {
        signal(
            price: row.bestSellPrice,
            currency: row.bestSellCurrency,
            symbol: row.bestSellSymbol,
            location: row.bestSellLocation,
            region: row.bestSellRegion,
            normalized: row.bestSellNormalized,
            kind: row.bestSellKind
        )
    }

    private static func exitSignal(_ row: PriceSummaryDTO) -> PriceSignal? {
        signal(
            price: row.bestBuyPrice,
            currency: row.bestBuyCurrency,
            symbol: row.bestBuySymbol,
            location: row.bestBuyLocation,
            region: row.bestBuyRegion,
            normalized: row.bestBuyNormalized,
            kind: row.bestBuyKind
        )
    }

    private static func signal(
        price: Double?,
        currency: String?,
        symbol: String?,
        location: String?,
        region: String?,
        normalized: Double?,
        kind: String?
    ) -> PriceSignal? {
        guard price != nil || normalized != nil else { return nil }
        return PriceSignal(
            price: price,
            currency: currency,
            symbol: symbol,
            location: location,
            region: region,
            normalizedUSD: normalized,
            kind: PriceKind(rawValue: kind ?? "") ?? .unknown
        )
    }

    private static func normalizedVariant(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.uppercased() != "UNKNOWN" else { return nil }
        return trimmed
    }
}
