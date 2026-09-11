import UIKit
import XCTest
@testable import FieldLookup

@MainActor
final class CardImageLoaderTests: XCTestCase {
    override func tearDown() {
        FixtureURLProtocol.handler = nil
        super.tearDown()
    }

    func testValidImageBytesBecomeLoaded() async {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: 12, height: 18),
            format: format
        )
        let data = renderer.pngData { context in
            UIColor.systemIndigo.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 12, height: 18))
        }
        FixtureURLProtocol.handler = { _ in
            .init(status: 200, data: data)
        }
        let loader = CardImageLoader(
            url: URL(string: "https://example.com/card.png"),
            urlSession: fixtureURLSession()
        )

        await loader.load()

        guard case let .loaded(image) = loader.state else {
            return XCTFail("Expected a decoded image")
        }
        XCTAssertEqual(image.size.width, 12)
        XCTAssertEqual(image.size.height, 18)
    }

    func testNilURLIsUnavailableWithoutStartingARequest() async {
        var requestCount = 0
        FixtureURLProtocol.handler = { _ in
            requestCount += 1
            return .init(status: 200, data: Data())
        }
        let loader = CardImageLoader(url: nil, urlSession: fixtureURLSession())

        await loader.load()

        assertUnavailable(loader.state)
        XCTAssertEqual(requestCount, 0)
    }

    func testHTTPFailureAndInvalidBytesBecomeUnavailable() async {
        FixtureURLProtocol.handler = { _ in
            .init(status: 503, data: Data())
        }
        let failedHTTP = CardImageLoader(
            url: URL(string: "https://example.com/unavailable.png"),
            urlSession: fixtureURLSession()
        )
        await failedHTTP.load()
        assertUnavailable(failedHTTP.state)

        FixtureURLProtocol.handler = { _ in
            .init(status: 200, data: Data("not an image".utf8))
        }
        let invalidBytes = CardImageLoader(
            url: URL(string: "https://example.com/invalid.png"),
            urlSession: fixtureURLSession()
        )
        await invalidBytes.load()
        assertUnavailable(invalidBytes.state)
    }

    private func assertUnavailable(
        _ state: CardImageLoadState,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case .unavailable = state else {
            return XCTFail("Expected unavailable image state", file: file, line: line)
        }
    }
}
