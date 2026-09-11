import Foundation
import XCTest
@testable import FieldLookup

final class SearchQueryTests: XCTestCase {
    func testJapaneseAndPrintedNumberTokensComposeAsAndedOrGroups() throws {
        let query = try SearchQuery(" ピカチュウ, (001/SV-P) ")

        XCTAssertEqual(query.tokens, ["ピカチュウ", "001/SV-P"])
        XCTAssertEqual(query.normalizedIdentity, "ピカチュウ 001/sv-p")
        XCTAssertEqual(query.postgRESTFilters.count, 2)
        XCTAssertTrue(query.postgRESTFilters[0].value?.contains("english_name.ilike.%ピカチュウ%") == true)
        XCTAssertTrue(query.postgRESTFilters[1].value?.contains("card_number.ilike.%001/SV-P%") == true)
    }

    func testPostgRESTSyntaxCharactersCannotEscapeFilterGroup() throws {
        let query = try SearchQuery("Pika%chu,eq.*")

        XCTAssertEqual(query.tokens, ["Pika", "chu", "eq."])
        XCTAssertFalse(query.postgRESTFilters.contains { $0.value?.contains("*") == true })
        XCTAssertFalse(query.postgRESTFilters.contains { $0.value?.contains(",eq") == true })
    }

    func testOnlySyntaxCharactersIsRejected() {
        XCTAssertThrowsError(try SearchQuery("%,()*"))
    }
}
